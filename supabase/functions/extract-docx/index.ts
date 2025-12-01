import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import mammoth from 'https://esm.sh/mammoth@1.7.0'; // Library to extract text from .docx files

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("extract-docx: Function started.");

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
      console.log("extract-docx: Unauthorized access - no user session.");
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }
    console.log(`extract-docx: User authenticated: ${user.id}`);

    const { sourceId } = await req.json();
    console.log(`extract-docx: Received sourceId: ${sourceId}`);

    if (!sourceId) {
      console.log("extract-docx: Missing sourceId in request body.");
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
      console.error(`extract-docx: Error fetching source ${sourceId}:`, fetchSourceError);
      return new Response(JSON.stringify({ error: 'Source not found or failed to fetch.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      });
    }
    console.log(`extract-docx: Source fetched: ${JSON.stringify(source)}`);

    const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (source.type !== DOCX_MIME_TYPE || !source.storage_path) {
      console.log(`extract-docx: Source ${sourceId} is not a DOCX or missing storage path. Type: ${source.type}, Path: ${source.storage_path}`);
      return new Response(JSON.stringify({ error: 'Source is not a DOCX file or missing storage path.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Download the DOCX file from Supabase Storage
    const { data: fileData, error: downloadError } = await supabaseClient.storage
      .from('chat-files')
      .download(source.storage_path);

    if (downloadError || !fileData) {
      console.error(`extract-docx: Error downloading DOCX file ${source.storage_path}:`, downloadError);
      return new Response(JSON.stringify({ error: 'Failed to download DOCX file.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }
    console.log(`extract-docx: DOCX file downloaded successfully from ${source.storage_path}. File size: ${fileData.size} bytes.`);

    // Extract text using mammoth.js
    const arrayBuffer = await fileData.arrayBuffer();
    console.log("extract-docx: Starting DOCX text extraction...");
    const { value: extractedText, messages } = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });

    if (messages.length > 0) {
      messages.forEach((msg: any) => console.warn(`extract-docx: Mammoth message: ${msg.message} (Type: ${msg.type})`));
    }

    console.log(`extract-docx: Text extraction complete. Extracted text length: ${extractedText.length}`);
    // console.log(`extract-docx: Extracted text preview: ${extractedText.substring(0, 200)}...`); // Log a preview

    // Return the extracted text to the client
    return new Response(JSON.stringify({ message: 'DOCX content extracted successfully.', sourceId, extractedContent: extractedText }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('extract-docx: Uncaught Edge Function error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  } finally {
    console.log("extract-docx: Function finished.");
  }
});