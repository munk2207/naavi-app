/**
 * poll-conversation Edge Function
 *
 * Checks the status of an AssemblyAI transcription job via direct REST call.
 * Returns status + speaker-labeled utterances when complete.
 *
 * 2026-08-15 — rewritten off the `assemblyai` npm SDK for the same reason as
 * upload-conversation/index.ts: the SDK's main entry point bundles realtime
 * WebSocket support (`ws`), which crashes on module load in Supabase's Deno
 * edge runtime (Node-only modules / native addons unavailable). See that
 * file's header comment for the full root-cause writeup.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('ASSEMBLYAI_API_KEY');
    if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not set');

    const { transcript_id } = await req.json();
    if (!transcript_id) throw new Error('No transcript_id provided');

    const pollRes = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcript_id}`, {
      headers: { authorization: apiKey },
    });
    if (!pollRes.ok) {
      throw new Error(`AssemblyAI poll failed (${pollRes.status}): ${await pollRes.text()}`);
    }
    const transcript = await pollRes.json();

    console.log('[poll-conversation] transcript_id:', transcript_id, 'status:', transcript.status);

    if (transcript.status === 'error') {
      throw new Error(`AssemblyAI transcription error: ${transcript.error}`);
    }

    if (transcript.status !== 'completed') {
      return new Response(
        JSON.stringify({ status: transcript.status }),
        { headers: { ...corsHeaders, 'content-type': 'application/json' } },
      );
    }

    const utterances = (transcript.utterances ?? []).map((u) => ({
      speaker: u.speaker,
      text: u.text,
      start: u.start,
      end: u.end,
    }));

    const speakers = [...new Set(utterances.map((u) => u.speaker))];

    console.log('[poll-conversation] Completed. Speakers:', speakers, 'Utterances:', utterances.length);

    return new Response(
      JSON.stringify({ status: 'completed', utterances, speakers, full_text: transcript.text }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[poll-conversation] Error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }
});
