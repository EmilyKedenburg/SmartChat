import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.16.0';
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
import type { Part } from 'https://esm.sh/@google/generative-ai@0.16.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function fetchUrlContent(url: string): Promise<string | null> {
  try {
    console.log(`[ask-llm] Fetching URL content: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[ask-llm] Failed to fetch URL ${url}: ${response.statusText}`);
      return null;
    }
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    if (doc) {
      const contentElements = doc.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, span");
      let extractedText = "";
      if (contentElements.length > 0) {
        extractedText = Array.from(contentElements).map(el => el.textContent).join("\n");
      } else {
        extractedText = doc.body?.textContent || "";
      }
      const cleaned = extractedText.replace(/\s+/g, ' ').trim();
      console.log(`[ask-llm] Extracted ${cleaned.length} characters from URL.`);
      return cleaned;
    }
    return null;
  } catch (error) {
    console.error(`[ask-llm] Error fetching or parsing URL ${url}:`, error);
    return null;
  }
}

async function processTextFileContent(supabaseClient: any, filePath: string): Promise<string | null> {
  try {
    console.log(`[ask-llm] Downloading text file: ${filePath}`);
    const { data, error } = await supabaseClient.storage.from('chat-files').download(filePath);
    if (error) {
      console.error(`[ask-llm] Error downloading file ${filePath}:`, error);
      return null;
    }
    if (!data) return null;
    const text = await data.text();
    console.log(`[ask-llm] Extracted ${text.length} characters from file.`);
    return text;
  } catch (error) {
    console.error(`[ask-llm] Error processing text file ${filePath}:`, error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[ask-llm] Function invoked.");
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { question, sourceIds, messages: conversationHistory } = await req.json();
    console.log(`[ask-llm] Received question: "${question}"`);
    console.log(`[ask-llm] Received ${sourceIds?.length || 0} source IDs.`);

    if (!question && (!sourceIds || sourceIds.length === 0)) {
      return new Response(JSON.stringify({ error: 'Question or sources are required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const LLM_API_KEY = Deno.env.get('LLM_API_KEY');
    if (!LLM_API_KEY) {
      console.error("[ask-llm] LLM_API_KEY is missing.");
      return new Response(JSON.stringify({ error: 'LLM_API_KEY not set.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const genAI = new GoogleGenerativeAI(LLM_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const parts: Part[] = [];

    // Add system instructions
    parts.push({ text: "You are a helpful AI assistant. Use the provided context (files and URLs) to answer the user's question. If the answer is not in the context, say so, but try to be as helpful as possible using the information you have. Always cite your sources by name.\n\n" });

    if (conversationHistory && conversationHistory.length > 0) {
      console.log(`[ask-llm] Adding ${conversationHistory.length} messages from history.`);
      parts.push({ text: "--- Conversation History ---\n" });
      conversationHistory.forEach((msg: { role: string; content: string }) => {
        parts.push({ text: `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n` });
      });
      parts.push({ text: "----------------------------\n\n" });
    }

    if (sourceIds && sourceIds.length > 0) {
      console.log("[ask-llm] Fetching sources from database...");
      const { data: sources, error: fetchSourcesError } = await supabaseClient
        .from('sources')
        .select('*')
        .in('id', sourceIds);

      if (fetchSourcesError) {
        console.error("[ask-llm] Error fetching sources:", fetchSourcesError);
      } else {
        console.log(`[ask-llm] Found ${sources?.length || 0} sources in database.`);
      }

      parts.push({ text: "--- Provided Context (Sources) ---\n" });
      for (const source of sources || []) {
        console.log(`[ask-llm] Processing source: ${source.name} (Type: ${source.type})`);
        let content = source.content;
        
        if (!content) {
          if (source.type === 'url') {
            content = await fetchUrlContent(source.name);
            if (content) {
              await supabaseClient.from('sources').update({ content: content }).eq('id', source.id);
            }
          } else if (source.storage_path) {
            // Check if it's a text-based file
            const isText = source.type.startsWith('text/') || 
                           source.name.endsWith('.txt') || 
                           source.name.endsWith('.csv') || 
                           source.name.endsWith('.md') ||
                           source.name.endsWith('.json');
            
            if (isText) {
              content = await processTextFileContent(supabaseClient, source.storage_path);
              if (content) {
                await supabaseClient.from('sources').update({ content: content }).eq('id', source.id);
              }
            } else {
              console.log(`[ask-llm] Skipping content extraction for non-text file: ${source.name}`);
            }
          }
        } else {
          console.log(`[ask-llm] Using existing content for source: ${source.name}`);
        }

        if (content) {
          parts.push({ text: `Source Name: ${source.name}\nContent:\n${content}\n\n` });
        } else {
          console.warn(`[ask-llm] No content available for source: ${source.name}`);
        }
      }
      parts.push({ text: "----------------------------------\n\n" });
    }

    parts.push({ text: `User Question: ${question}` });

    console.log("[ask-llm] Sending request to Gemini...");
    const result = await model.generateContent({ contents: [{ role: "user", parts }] });
    const response = await result.response;
    const assistantResponse = response.text();
    console.log("[ask-llm] Received response from Gemini.");

    return new Response(JSON.stringify({ response: assistantResponse }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('[ask-llm] Edge Function error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});