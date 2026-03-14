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
      return extractedText.replace(/\s+/g, ' ').trim();
    }
    return null;
  } catch (error) {
    console.error(`[ask-llm] Error fetching or parsing URL ${url}:`, error);
    return null;
  }
}

async function processTextFileContent(supabaseClient: any, filePath: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseClient.storage.from('chat-files').download(filePath);
    if (error) {
      console.error(`[ask-llm] Error downloading file ${filePath}:`, error);
      return null;
    }
    if (!data) return null;
    return await data.text();
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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { question, sourceIds, messages: conversationHistory } = await req.json();

    if (!question && (!sourceIds || sourceIds.length === 0)) {
      return new Response(JSON.stringify({ error: 'Question or sources are required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const LLM_API_KEY = Deno.env.get('LLM_API_KEY');
    if (!LLM_API_KEY) {
      return new Response(JSON.stringify({ error: 'LLM_API_KEY not set.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const genAI = new GoogleGenerativeAI(LLM_API_KEY);
    // Using gemini-2.5-flash as requested
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const parts: Part[] = [];

    if (conversationHistory && conversationHistory.length > 0) {
      parts.push({ text: "--- Conversation History ---\n" });
      conversationHistory.forEach((msg: { role: string; content: string }) => {
        parts.push({ text: `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n` });
      });
      parts.push({ text: "----------------------------\n" });
    }

    if (sourceIds && sourceIds.length > 0) {
      const { data: sources, error: fetchSourcesError } = await supabaseClient
        .from('sources')
        .select('*')
        .in('id', sourceIds);

      if (fetchSourcesError) {
        console.error("[ask-llm] Error fetching sources:", fetchSourcesError);
      }

      parts.push({ text: "\n--- Provided Context ---\n" });
      for (const source of sources || []) {
        if (source.type === 'url') {
          let content = source.content;
          if (!content) {
            content = await fetchUrlContent(source.name);
            if (content) {
              await supabaseClient.from('sources').update({ content: content }).eq('id', source.id);
            }
          }
          if (content) parts.push({ text: `Source (URL): ${source.name}\nContent: ${content}\n` });
        } else if (source.storage_path) {
          let content = source.content;
          if (!content) {
            if (source.type.startsWith('text/') || source.name.endsWith('.txt') || source.name.endsWith('.csv')) {
              content = await processTextFileContent(supabaseClient, source.storage_path);
            }
          }
          if (content) parts.push({ text: `Source (File): ${source.name}\nContent: ${content}\n` });
        }
      }
      parts.push({ text: "-------------------------\n" });
    }

    parts.push({ text: `Question: ${question}` });
    parts.push({ text: `\nPlease provide a concise and helpful answer based on the context provided above. Cite sources if possible.` });

    const result = await model.generateContent({ contents: [{ role: "user", parts }] });
    const response = await result.response;
    const assistantResponse = response.text();

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