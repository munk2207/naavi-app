/**
 * upload-conversation Edge Function
 *
 * Receives base64 audio, uploads to AssemblyAI with speaker diarization,
 * returns transcript_id for polling.
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

    const { audio, mimeType = 'audio/webm', language } = await req.json();
    if (!audio) throw new Error('No audio provided');

    const client = new AssemblyAI({ apiKey });

    // Decode base64 → binary buffer
    const binaryStr = atob(audio);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Step 1 — upload audio file
    console.log('[upload-conversation] Uploading audio, size:', bytes.length);
    const uploadUrl = await client.files.upload(bytes, {
      fileName: 'conversation.webm',
      mimeType,
    });
    console.log('[upload-conversation] Upload URL:', uploadUrl);

    // Step 2 — submit transcription with speaker diarization
    // language_detection: true lets AssemblyAI identify the language automatically
    // (supports Arabic, French, English, and 99 other languages)
    const transcript = await client.transcripts.submit({
      audio_url: uploadUrl,
      speaker_labels: true,
      speakers_expected: 2,
      speech_models: ['universal-2'] as never,
      ...(language ? { language_code: language } : { language_detection: true }),
    } as never);

    console.log('[upload-conversation] Transcript job:', transcript.id, 'status:', transcript.status);

    return new Response(
      JSON.stringify({ transcript_id: transcript.id, status: transcript.status }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[upload-conversation] Error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }
});
