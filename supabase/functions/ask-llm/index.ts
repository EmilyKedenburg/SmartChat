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

    // Parse the request body
    const { question, urls, filePaths } = await req.json();

    if (!question && (!urls || urls.length === 0) && (!filePaths || filePaths.length === 0)) {
      return new Response(JSON.stringify({ error: 'Question, URLs, or files are required' }), {
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

    // Fetch content from URLs
    if (urls && urls.length > 0) {
      const urlContents = await Promise.all(urls.map(fetchUrlContent));
      const validUrlContents = urlContents.filter(content => content !== null) as string[];
      if (validUrlContents.length > 0) {
        context += `\n\n--- Context from URLs ---\n`;
        validUrlContents.forEach((content, index) => {
          context += `\nURL ${urls[index]}:\n${content}\n`;
        });
        context += `\n-------------------------\n`;
      }
    }

    // Fetch content from uploaded files
    if (filePaths && filePaths.length > 0) {
      const fileContents = await Promise.all(filePaths.map(filePath => downloadFileContent(supabaseClient, filePath)));
      const validFileContents = fileContents.filter(content => content !== null) as string[];
      if (validFileContents.length > 0) {
        context += `\n\n--- Context from Uploaded Files ---\n`;
        validFileContents.forEach((content, index) => {
          context += `\nFile ${filePaths[index]}:\n${content}\n`;
        });
        context += `\n-------------------------\n`;
      } else {
        context += `\n\n--- Uploaded Files ---\n`;
        context += `The user has provided the following files (by path): ${filePaths.join(', ')}. Their content could not be retrieved or was empty.\n`;
        context += `\n-------------------------\n`;
      }
    }

    const prompt = `You are a helpful assistant that answers questions based on provided context.
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