import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.16.0';
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
import type { Part } from 'https://esm.sh/@google/generative-ai@0.16.0'; // Import Part type for clarity

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

// Function to process text-based file content
async function processTextFileContent(supabaseClient: any, filePath: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseClient.storage.from('chat-files').download(filePath);
    if (error) {
      console.error(`Error downloading file ${filePath}:`, error);
      return null;
    }
    if (!data) {
      return null;
    }
    return await data.text();
  } catch (error) {
    console.error(`ask-llm: Error processing text file ${filePath}:`, error);
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

    const parts: Part[] = [];

    // Add conversation history to parts
    if (conversationHistory && conversationHistory.length > 0) {
      parts.push({ text: "--- Conversation History ---" });
      conversationHistory.forEach((msg: { role: string; content: string }) => {
        parts.push({ text: `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}` });
      });
      parts.push({ text: "----------------------------" });
    }

    // Process sources
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

      parts.push({ text: "\n--- Provided Context ---" });
      for (const source of sources || []) {
        if (source.type === 'application/pdf' && source.storage_path) {
          // For PDFs, provide the public URL directly to Gemini
          const { data: publicUrlData } = supabaseClient.storage
            .from('chat-files')
            .getPublicUrl(source.storage_path);
          
          if (publicUrlData?.publicUrl) {
            parts.push({ text: `Source (PDF): ${source.name}` });
            parts.push({
              fileData: {
                mimeType: "application/pdf",
                fileUri: publicUrlData.publicUrl,
              },
            });
            console.log(`ask-llm: Added PDF fileData for ${source.name} with URL: ${publicUrlData.publicUrl}`);
          } else {
            console.warn(`ask-llm: Could not get public URL for PDF source ${source.id} at ${source.storage_path}.`);
            parts.push({ text: `Warning: Could not access PDF source ${source.name}.` });
          }
        } else if (source.type === 'url') {
          let content = source.content;
          if (!content) { // If content not already extracted, fetch it
            content = await fetchUrlContent(source.name);
            if (content) {
              const { error: updateSourceError } = await supabaseClient
                .from('sources')
                .update({ content: content })
                .eq('id', source.id);
              if (updateSourceError) console.error(`Error updating source ${source.id} with URL content:`, updateSourceError);
            }
          }
          if (content) {
            parts.push({ text: `Source (URL): ${source.name}\n${content}` });
          } else {
            console.warn(`Could not get readable content for URL source ${source.id} (${source.name}).`);
            parts.push({ text: `Warning: Could not access URL source ${source.name}.` });
          }
        } else if (source.storage_path) { // For other file types (txt, csv, docx)
          let content = source.content;
          if (!content) { // If content not already extracted, process it
            // DOCX files are handled by 'extract-docx' and should have content pre-filled
            // For other text files, process directly
            if (source.type.startsWith('text/') || source.name.endsWith('.txt') || source.name.endsWith('.csv')) {
              content = await processTextFileContent(supabaseClient, source.storage_path);
            } else if (source.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
              // This case should ideally not be hit if extract-docx successfully pre-fills content
              console.warn(`ask-llm: DOCX file ${source.name} content not found in DB. It should have been extracted by 'extract-docx'.`);
              parts.push({ text: `Warning: DOCX file ${source.name} content could not be retrieved.` });
            }
          }
          if (content) {
            parts.push({ text: `Source (File): ${source.name}\n${content}` });
          } else {
            console.warn(`Could not get readable content for file source ${source.id} (${source.name}).`);
            parts.push({ text: `Warning: Could not access file source ${source.name}.` });
          }
        }
      }
      parts.push({ text: "-------------------------" });
    } else {
      parts.push({ text: "\n--- Provided Context ---" });
      parts.push({ text: "No readable content was extracted from the provided sources." });
      parts.push({ text: "-------------------------" });
    }

    // Add the user's current question
    parts.push({ text: `Question: ${question}` });
    parts.push({ text: `Please provide a concise and helpful answer. If you directly reference information from the provided URLs or files, try to cite the source in your response.` });

    const result = await model.generateContent({ contents: [{ role: "user", parts }] });
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