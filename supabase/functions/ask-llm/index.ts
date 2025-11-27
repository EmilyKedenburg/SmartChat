import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.16.0';
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
import { RecursiveCharacterTextSplitter } from "npm:langchain/text_splitter";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  console.log(`[DEBUG] Received request: ${req.method} ${req.url}`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { question, sourceIds } = await req.json();
    console.log(`[DEBUG] Question: "${question}", Source IDs: ${JSON.stringify(sourceIds)}`);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Fetch sources from the database
    let context = "";
    if (sourceIds && sourceIds.length > 0) {
      console.log("[DEBUG] Fetching sources from database...");
      const { data: sources, error: sourcesError } = await supabaseClient
        .from("sources")
        .select("id, type, name, content, storage_path")
        .in("id", sourceIds);

      if (sourcesError) {
        console.error("[DEBUG] Error fetching sources:", sourcesError);
        throw new Error(`Failed to fetch sources: ${sourcesError.message}`);
      }

      console.log(`[DEBUG] Found ${sources.length} sources.`);

      for (const source of sources) {
        let sourceContent = source.content;

        if (source.type === "url" && !sourceContent) {
          console.log(`[DEBUG] Scraping URL: ${source.name}`);
          try {
            const response = await fetch(source.name);
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            sourceContent = doc?.body?.textContent || "";
            // Update the source content in the database
            await supabaseClient.from("sources").update({ content: sourceContent }).eq("id", source.id);
            console.log(`[DEBUG] Successfully scraped and updated content for URL: ${source.name}`);
          } catch (scrapeError: any) {
            console.error(`[DEBUG] Error scraping URL ${source.name}:`, scrapeError);
            sourceContent = `Failed to scrape content from ${source.name}.`;
          }
        } else if (source.storage_path && !sourceContent) {
          console.log(`[DEBUG] Fetching file content from storage: ${source.storage_path}`);
          try {
            const { data: fileData, error: downloadError } = await supabaseClient.storage
              .from("chat-files")
              .download(source.storage_path);

            if (downloadError) throw downloadError;

            sourceContent = await fileData.text();
            // Update the source content in the database
            await supabaseClient.from("sources").update({ content: sourceContent }).eq("id", source.id);
            console.log(`[DEBUG] Successfully fetched and updated content for file: ${source.name}`);
          } catch (fileError: any) {
            console.error(`[DEBUG] Error downloading file ${source.name}:`, fileError);
            sourceContent = `Failed to download content from file ${source.name}.`;
          }
        }

        if (sourceContent) {
          context += `Source (${source.name}):\n${sourceContent.substring(0, 1000)}...\n\n`; // Limit context length
        }
      }
    }

    console.log("[DEBUG] Initializing Google Generative AI...");
    const genAI = new GoogleGenerativeAI(Deno.env.get('LLM_API_KEY')!);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    let prompt = `You are a helpful AI assistant. Answer the following question.`;
    if (context) {
      prompt += ` Use the following context to answer the question:\n\n${context}\n\n`;
    }
    prompt += `Question: ${question}`;

    console.log("[DEBUG] Sending prompt to LLM...");
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    console.log("[DEBUG] LLM Response received.");

    return new Response(JSON.stringify({ response: text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('[DEBUG] Edge Function error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});