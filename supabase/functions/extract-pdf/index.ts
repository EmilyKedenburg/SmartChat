import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
// Import pdfjs-dist and its types from esm.sh
import * as pdfjsLib from 'https://esm.sh/pdfjs-dist@4.4.168';
import { TextItem } from 'https://esm.sh/pdfjs-dist@4.4.168/types/src/display/api'; // Import TextItem type

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// IMPORTANT: Disable web workers for pdfjs-dist in Deno environment
// This forces PDF.js to run in the main thread, avoiding worker module loading issues.
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

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

    const { sourceId } = await req.json();

    if (!sourceId) {
      return new Response(JSON.stringify({ error: 'sourceId is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Fetch the source record
    const { data: source, error: fetchSourceError } = await supabaseClient
      .from('sources')
      .select('*')
      .eq('id', sourceId)
      .single();

    if (fetchSourceError || !source) {
      console.error(`Error fetching source ${sourceId}:`, fetchSourceError);
      return new Response(JSON.stringify({ error: 'Source not found or failed to fetch.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      });
    }

    if (source.type !== 'application/pdf' || !source.storage_path) {
      return new Response(JSON.stringify({ error: 'Source is not a PDF file or missing storage path.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Download the PDF file from Supabase Storage
    const { data: fileData, error: downloadError } = await supabaseClient.storage
      .from('chat-files')
      .download(source.storage_path);

    if (downloadError || !fileData) {
      console.error(`Error downloading PDF file ${source.storage_path}:`, downloadError);
      return new Response(JSON.stringify({ error: 'Failed to download PDF file.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    // Extract text using pdfjs-dist
    const arrayBuffer = await fileData.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdfDocument = await loadingTask.promise;
    let extractedText = "";

    for (let i = 1; i <= pdfDocument.numPages; i++) {
      const page = await pdfDocument.getPage(i);
      const textContent = await page.getTextContent();
      extractedText += textContent.items.map((item: TextItem) => item.str).join(' ') + '\n';
    }
    extractedText = extractedText.replace(/\s+/g, ' ').trim();

    // Update the source record in the database with the extracted content
    const { error: updateSourceError } = await supabaseClient
      .from('sources')
      .update({ content: extractedText })
      .eq('id', sourceId);

    if (updateSourceError) {
      console.error(`Error updating source ${sourceId} with extracted content:`, updateSourceError);
      return new Response(JSON.stringify({ error: 'Failed to update source with extracted content.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    return new Response(JSON.stringify({ message: 'PDF content extracted and saved successfully.', sourceId }), {
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