import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.16.0';
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Function to fetch and extract text content from a URL
async function fetchUrlContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Failed to fetch URL ${url}: ${response.statusText}`);
      return null;
    }
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    if (doc) {
      // Extract text from common content elements, or fallback to body text
      const contentElements = doc.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, span");
      let extractedText = "";
      if (contentElements.length > 0) {
        extractedText = Array.from(contentElements).map(el => el.textContent).join("\n");
      } else {
        extractedText = doc.body?.textContent || "";
      }
      // Basic cleanup: remove excessive whitespace and newlines
      return extractedText.replace(/\s+/g, ' ').trim();
    }
    return null;
  } catch (error) {
    console.error(`Error fetching or parsing URL ${url}:`, error);
    return null;
  }
}

// Function to download file content from Supabase Storage
async function downloadFileContent(supabaseClient: any, filePath: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseClient.storage.from('chat-files').download(filePath);
    if (error) {
      console.error(`Error downloading file ${filePath}:`, error);
      return null;
    }
    if (data) {
      // Assuming text files, read as text
      return await data.text();
    }
    return null;
  } catch (error) {
    console.error(`Error processing downloaded file ${filePath}:`, error);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with the user's auth token
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Verify user authentication
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    // Parse the request body, now including 'messages' for conversational memory
    const { question, sourceIds, messages: conversationHistory } = await req.json();

    if (!question && (!sourceIds || sourceIds.length === 0)) {
      return new Response(JSON.stringify({ error: 'Question or sources are required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // --- LLM API call using Google Gemini ---
    const LLM_API_KEY = Deno.env.get('LLM_API_KEY');
    if (!LLM_API_KEY) {
      return new Response(JSON.stringify({ error: 'LLM_API_KEY not set in Supabase secrets.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const genAI = new GoogleGenerativeAI(LLM_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    let context = "";
    const extractedContents: { id: string; content: string; name: string; type: string }[] = [];

    if (sourceIds && sourceIds.length > 0) {
      const { data: sources, error: fetchSourcesError } = await supabaseClient
        .from('sources')
        .select('*')
        .in('id', sourceIds);

      if (fetchSourcesError) {
        console.error("Error fetching sources:", fetchSourcesError);
        return new Response(JSON.stringify({ error: 'Failed to retrieve source information.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        });
      }

      for (const source of sources || []) {
        let content: string | null = null;
        if (source.type === 'url') {
          content = await fetchUrlContent(source.name);
        } else if (source.storage_path) { // Assuming files have storage_path
          content = await downloadFileContent(supabaseClient, source.storage_path);
        }

        if (content) {
          extractedContents.push({ id: source.id, content, name: source.name, type: source.type });
          // Update the source record in the database with the extracted content
          const { error: updateSourceError } = await supabaseClient
            .from('sources')
            .update({ content: content })
            .eq('id', source.id);

          if (updateSourceError) {
            console.error(`Error updating source ${source.id} with content:`, updateSourceError);
          }
        } else {
          console.warn(`Could not extract content for source ${source.id} (type: ${source.type}, name: ${source.name})`);
        }
      }

      if (extractedContents.length > 0) {
        context += `\n\n--- Provided Context ---\n`;
        extractedContents.forEach((item) => {
          context += `\nSource (${item.type === 'url' ? 'URL' : 'File'}): ${item.name}\n${item.content}\n`;
        });
        context += `\n-------------------------\n`;
      } else {
        context += `\n\n--- Provided Context ---\n`;
        context += `No readable content was extracted from the provided sources.\n`;
        context += `\n-------------------------\n`;
      }
    }

    let chatHistory = "";
    if (conversationHistory && conversationHistory.length > 0) {
      chatHistory += "\n\n--- Conversation History ---\n";
      conversationHistory.forEach((msg: { role: string; content: string }) => {
        chatHistory += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
      });
      chatHistory += "----------------------------\n";
    }

    const prompt = `You are a helpful assistant that answers questions based on provided context and conversation history.
    ${chatHistory}
    ${context}
    
    Question: ${question}
    
    Please provide a concise and helpful answer. If you directly reference information from the provided URLs or files, try to cite the source in your response.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const assistantResponse = response.text();

    return new Response(JSON.stringify({ response: assistantResponse }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('Edge Function error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});