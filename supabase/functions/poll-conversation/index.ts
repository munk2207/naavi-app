/**
 * poll-conversation Edge Function
 *
 * Checks the status of an AssemblyAI transcription job using the SDK.
 * Returns status + speaker-labeled utterances when complete.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { AssemblyAI } from 'https://esm.sh/assemblyai@4';

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

    const { transcript_id } = await req.json();
    if (!transcript_id) throw new Error('No transcript_id provided');

    const client = new AssemblyAI({ apiKey });
    const transcript = await client.transcripts.get(transcript_id);

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
