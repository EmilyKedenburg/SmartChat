import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.3.136/build/pdf.mjs";

// Explicitly set workerSrc to an empty string to satisfy pdfjs-dist in Deno environment.
// The .mjs build is designed to be worker-free, but it still checks this option.
pdfjsLib.GlobalWorkerOptions.workerSrc = "";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("extract-pdf: Function started.");

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

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      console.log("extract-pdf: Unauthorized access - no user session.");
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }
    console.log(`extract-pdf: User authenticated: ${user.id}`);

    const { sourceId } = await req.json();
    console.log(`extract-pdf: Received sourceId: ${sourceId}`);

    if (!sourceId) {
      console.log("extract-pdf: Missing sourceId in request body.");
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
      console.error(`extract-pdf: Error fetching source ${sourceId}:`, fetchSourceError);
      return new Response(JSON.stringify({ error: 'Source not found or failed to fetch.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      });
    }
    console.log(`extract-pdf: Source fetched: ${JSON.stringify(source)}`);

    const PDF_MIME_TYPE = 'application/pdf';
    if (source.type !== PDF_MIME_TYPE || !source.storage_path) {
      console.log(`extract-pdf: Source ${sourceId} is not a PDF or missing storage path. Type: ${source.type}, Path: ${source.storage_path}`);
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
      console.error(`extract-pdf: Error downloading PDF file ${source.storage_path}:`, downloadError);
      return new Response(JSON.stringify({ error: 'Failed to download PDF file.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }
    console.log(`extract-pdf: PDF file downloaded successfully from ${source.storage_path}. File size: ${fileData.size} bytes.`);

    // Extract text using pdfjs-dist
    const arrayBuffer = await fileData.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    console.log("extract-pdf: Starting PDF text extraction...");
    const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise;

    let extractedText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(" ");
      extractedText += pageText + "\n\n";
    }

    console.log(`extract-pdf: Text extraction complete. Extracted text length: ${extractedText.length}`);

    // Update the source with the extracted content
    const { error: updateContentError } = await supabaseClient
      .from("sources")
      .update({ content: extractedText })
      .eq("id", source.id);

    if (updateContentError) {
      console.error(`extract-pdf: Error updating source ${source.id} with extracted content:`, updateContentError);
      return new Response(JSON.stringify({ error: 'Failed to save extracted content.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }
    console.log(`extract-pdf: Source ${source.id} updated with extracted PDF content.`);

    // Return the extracted text to the client (though client mostly just needs confirmation)
    return new Response(JSON.stringify({ message: 'PDF content extracted and saved successfully.', sourceId, extractedContent: extractedText }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('extract-pdf: Uncaught Edge Function error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  } finally {
    console.log("extract-pdf: Function finished.");
  }
});