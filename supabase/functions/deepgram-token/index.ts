/**
 * deepgram-token Edge Function
 *
 * Issues a short-lived Deepgram JWT so the mobile app can open a
 * WebSocket directly to Deepgram for streaming transcription —
 * keeping the API key server-side at all times.
 *
 * The token only needs to be valid at WebSocket connection time.
 * Once connected, the socket stays open regardless of token expiry.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('DEEPGRAM_API_KEY');
    if (!apiKey) throw new Error('DEEPGRAM_API_KEY not set');

    const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl_seconds: 30 }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Deepgram token error (${res.status}): ${text}`);
    }

    const data = await res.json();
    const token = data.access_token ?? data.token;
    if (!token) throw new Error('No token in Deepgram response');

    console.log('[deepgram-token] Token issued successfully');

    return new Response(
      JSON.stringify({ token }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[deepgram-token] Error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
