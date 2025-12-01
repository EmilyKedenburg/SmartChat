import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.16.0';
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
import type { Part } from 'https://esm.sh/@google/generative-ai@0.16.0';

// PDF.js imports for Deno
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.3.136/build/pdf.mjs";
// Set workerSrc to a dummy data URL to satisfy pdfjs-dist's requirement without loading an external worker.
pdfjsLib.GlobalWorkerOptions.workerSrc = `data:application/javascript;base64,${btoa('self.onmessage = () => {};')}`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to extract text from PDF ArrayBuffer
async function extractPdfContentFromBuffer(arrayBuffer: ArrayBuffer): Promise<string | null> {
  try {
    const uint8 = new Uint8Array(arrayBuffer);
    const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise;
    let extractedText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(" ");
      extractedText += pageText + "\n\n";
    }
    return extractedText.replace(/\s+/g, ' ').trim();
  } catch (error) {
    console.error("Error extracting PDF content:", error);
    return null;
  }
}

// Function to fetch and extract text content from a URL, now handling PDFs
async function fetchAndExtractUrlContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Failed to fetch URL ${url}: ${response.statusText}`);
      return null;
    }

    const contentType = response.headers.get("Content-Type");

    if (contentType?.includes("application/pdf") || url.toLowerCase().endsWith(".pdf")) {
      const arrayBuffer = await response.arrayBuffer();
      return await extractPdfContentFromBuffer(arrayBuffer);
    } else if (contentType?.includes("text/html")) {
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
    } else if (contentType?.includes("text/plain") || contentType?.includes("text/csv")) {
      return await response.text();
    } else {
      console.warn(`Unsupported content type for URL ${url}: ${contentType}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching or parsing URL ${url}:`, error);
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
        let content = source.content; // Assume content is pre-extracted for files or fetched for URLs

        if (source.type === 'url') {
          if (!content) { // If content not already extracted, fetch and extract it
            content = await fetchAndExtractUrlContent(source.name);
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
        } else if (source.storage_path) { // For file types (txt, csv, docx)
          // For file types, content should ideally be pre-extracted by dedicated functions (e.g., extract-docx)
          // or read client-side (for text files). If not, it's a fallback.
          if (!content) {
            // This block is primarily for simple text files if content wasn't read client-side
            // or if extract-docx failed to update content.
            // For PDFs, they are now handled as 'url' type.
            if (source.type.startsWith('text/') || source.name.endsWith('.txt') || source.name.endsWith('.csv')) {
              // If content is still missing for a simple text file, try to download and process
              try {
                const { data: fileData, error: downloadError } = await supabaseClient.storage.from('chat-files').download(source.storage_path);
                if (downloadError) throw downloadError;
                if (fileData) {
                  content = await fileData.text();
                  const { error: updateContentError } = await supabaseClient
                    .from('sources')
                    .update({ content: content })
                    .eq('id', source.id);
                  if (updateContentError) console.error(`Error updating source ${source.id} with text content:`, updateContentError);
                }
              } catch (downloadOrReadError) {
                console.error(`ask-llm: Error processing text file ${source.storage_path}:`, downloadOrReadError);
              }
            } else {
              console.warn(`ask-llm: File ${source.name} (${source.type}) content not found in DB and no specific fallback for this type.`);
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