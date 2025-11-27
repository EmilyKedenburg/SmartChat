import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// Temporarily remove complex imports to isolate the issue
// import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
// import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.16.0';
// import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
// import { RecursiveCharacterTextSplitter } from "npm:langchain/text_splitter";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  console.log(`[DEBUG] Received request: ${req.method} ${req.url}`); // Added for debugging

  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Temporarily return a simple success response
    const { question } = await req.json();
    console.log(`[DEBUG] Processing question: ${question}`);

    return new Response(JSON.stringify({ response: `Hello from Edge Function! You asked: "${question}"` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('[DEBUG] Edge Function error during simplified execution:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error (Simplified)' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});