import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.16.0';
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
// Import a Deno-compatible PDF parser. pdf-parse is Node.js specific.
// We will use pdfjs-dist 3.x directly here, configured for worker-less mode.
import * as pdfjsLib from 'https://esm.sh/pdfjs-dist@3.10.111/build/pdf.mjs';
import type { TextItem } from 'https://esm.sh/pdfjs-dist@3.10.111/types/src/display/api';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configure pdfjs-dist for worker-less mode, essential for Deno Edge Functions
pdfjsLib.GlobalWorkerOptions.workerSrc = '';
console.log("ask-llm: pdfjsLib.GlobalWorkerOptions.workerSrc set to empty string for pdfjs-dist 3.x.");


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

// Function to process file content, now including PDF extraction
async function processFileContent(supabaseClient: any, filePath: string, fileType: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseClient.storage.from('chat-files').download(filePath);
    if (error) {
      console.error(`Error downloading file ${filePath}:`, error);
      return null;
    }
    if (!data) {
      return null;
    }

    if (fileType === 'application/pdf') {
      console.log(`ask-llm: Starting PDF text extraction for ${filePath}...`);
      const arrayBuffer = await data.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdfDocument = await loadingTask.promise;
      let extractedText = "";

      for (let i = 1; i <= pdfDocument.numPages; i++) {
        const page = await pdfDocument.getPage(i);
        const textContent = await page.getTextContent();
        extractedText += textContent.items.map((item: TextItem) => item.str).join(' ') + '\n';
      }
      extractedText = extractedText.replace(/\s+/g, ' ').trim();
      console.log(`ask-llm: PDF text extraction complete for ${filePath}. Length: ${extractedText.length}`);
      return extractedText;
    } else if (fileType.startsWith('text/') || fileType === 'application/json' || filePath.endsWith('.txt') || filePath.endsWith('.csv')) {
      return await data.text();
    } else {
      console.warn(`ask-llm: Unsupported file type for direct content extraction: ${fileType} for file ${filePath}.`);
      return null;
    }
  } catch (error) {
    console.error(`ask-llm: Error processing file ${filePath} (${fileType}):`, error);
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
        // Prioritize already extracted content from the database
        if (source.content) {
          content = source.content;
        } else if (source.type === 'url') {
          content = await fetchUrlContent(source.name);
          // If content was fetched from URL and not already in DB, update it
          if (content && !source.content) {
            const { error: updateSourceError } = await supabaseClient
              .from('sources')
              .update({ content: content })
              .eq('id', source.id);

            if (updateSourceError) {
              console.error(`Error updating source ${source.id} with URL content:`, updateSourceError);
            }
          }
        } else if (source.storage_path) { // Handle all files with storage_path here
          if (!source.content) {
            content = await processFileContent(supabaseClient, source.storage_path, source.type);
            // If content was processed from file and not already in DB, update it
            if (content) {
              const { error: updateSourceError } = await supabaseClient
                .from('sources')
                .update({ content: content })
                .eq('id', source.id);

              if (updateSourceError) {
                console.error(`Error updating source ${source.id} with file content:`, updateSourceError);
              }
            }
          } else {
            content = source.content; // Use existing content if available
          }
        }

        if (content) {
          extractedContents.push({ id: source.id, content, name: source.name, type: source.type });
        } else {
          console.warn(`Could not get readable content for source ${source.id} (type: ${source.type}, name: ${source.name}).`);
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