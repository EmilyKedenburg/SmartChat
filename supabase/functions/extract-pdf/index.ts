import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getDocument, GlobalWorkerOptions } from 'https://esm.sh/pdfjs-dist@4.4.168/build/pdf.mjs';
import type { TextItem } from 'https://esm.sh/pdfjs-dist@4.4.168/types/src/display/api';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// IMPORTANT: Explicitly set the workerSrc to the pdf.worker.mjs URL.
// This resolves the "No GlobalWorkerOptions.workerSrc specified" error
// by providing the worker script that pdfjs-dist expects.
GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.4.168/build/pdf.worker.mjs';
console.log("extract-pdf: GlobalWorkerOptions.workerSrc set to pdf.worker.mjs URL.");

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("extract-pdf: Function started.");
  console.log("extract-pdf: pdfjs-dist modules imported.");

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

    if (source.type !== 'application/pdf' || !source.storage_path) {
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
    console.log("extract-pdf: Starting PDF text extraction...");
    const loadingTask = getDocument({ data: arrayBuffer }); // Use getDocument directly
    console.log("extract-pdf: PDF loading task created.");
    const pdfDocument = await loadingTask.promise;
    console.log(`extract-pdf: PDF document loaded. Has ${pdfDocument.numPages} pages.`);
    let extractedText = "";

    for (let i = 1; i <= pdfDocument.numPages; i++) {
      const page = await pdfDocument.getPage(i);
      const textContent = await page.getTextContent();
      extractedText += textContent.items.map((item: TextItem) => item.str).join(' ') + '\n';
    }
    extractedText = extractedText.replace(/\s+/g, ' ').trim();
    console.log(`extract-pdf: Text extraction complete. Extracted text length: ${extractedText.length}`);
    // console.log(`extract-pdf: Extracted text preview: ${extractedText.substring(0, 200)}...`); // Log a preview

    // Return the extracted text to the client
    return new Response(JSON.stringify({ message: 'PDF content extracted successfully.', sourceId, extractedContent: extractedText }), {
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