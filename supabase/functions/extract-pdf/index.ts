import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
// Temporarily comment out pdfjs-dist imports to isolate the issue
// import { getDocument, GlobalWorkerOptions } from 'https://esm.sh/pdfjs-dist@4.4.168/build/pdf.mjs';
// import type { TextItem } from 'https://esm.sh/pdfjs-dist@4.4.168/types/src/display/api';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// GlobalWorkerOptions.workerSrc = ''; // Comment out as pdfjs-dist is not used yet

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("extract-pdf: Function started.");

  try {
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

    // --- TEMPORARY: Return dummy response to isolate PDF processing issue ---
    console.log("extract-pdf: Returning dummy response to test function invocation.");
    return new Response(JSON.stringify({ message: 'Dummy PDF content extracted successfully.', sourceId, extractedContent: 'This is dummy content from the PDF extractor.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
    // --- END TEMPORARY ---

    // The original PDF processing code is commented out for now.

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