/**
 * get-realtime-token Edge Function
 *
 * Issues a short-lived AssemblyAI token for the browser to open a
 * real-time WebSocket transcription session directly — keeping the
 * API key server-side at all times.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('ASSEMBLYAI_API_KEY');
    if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not set');

    // Request a temporary token valid for 1 hour
    const res = await fetch('https://api.assemblyai.com/v2/realtime/token', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expires_in: 3600 }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AssemblyAI token error (${res.status}): ${text}`);
    }

    const { token } = await res.json();
    console.log('[get-realtime-token] Token issued successfully');

    return new Response(
      JSON.stringify({ token }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[get-realtime-token] Error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }
});
