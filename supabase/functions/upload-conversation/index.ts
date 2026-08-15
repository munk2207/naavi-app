/**
 * upload-conversation Edge Function
 *
 * Receives base64 audio, uploads to AssemblyAI with speaker diarization,
 * returns transcript_id for polling.
 *
 * 2026-08-15 — rewritten to call AssemblyAI's REST API directly via fetch()
 * instead of the `assemblyai` npm SDK. The SDK's main entry point bundles
 * its real-time WebSocket streaming support (the `ws` package), which pulls
 * in Node-only modules (`node:url`) and native binary addons
 * (`utf-8-validate`, `bufferutil`) that don't exist in Supabase's Deno edge
 * runtime — this crashed the function on module load, before any of our
 * code ran, for every request regardless of payload (confirmed via
 * Supabase's function logs: "module 'node:url' not found" / "module
 * '/utf-8-validate@6.0.6/denonext/package.json' not found"). We only ever
 * used the REST endpoints (upload + submit + poll), never realtime, so
 * calling them directly removes the whole dependency class.
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

    const { audio, mimeType = 'audio/webm', language } = await req.json();
    if (!audio) throw new Error('No audio provided');

    // Decode base64 → binary buffer
    const binaryStr = atob(audio);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Step 1 — upload audio file (raw binary POST body).
    console.log('[upload-conversation] Uploading audio, size:', bytes.length);
    const uploadRes = await fetch(`${ASSEMBLYAI_BASE}/upload`, {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': mimeType },
      body: bytes,
    });
    if (!uploadRes.ok) {
      throw new Error(`AssemblyAI upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
    }
    const { upload_url: uploadUrl } = await uploadRes.json();
    console.log('[upload-conversation] Upload URL:', uploadUrl);

    // Step 2 — submit transcription with speaker diarization.
    // language_detection: true lets AssemblyAI identify the language automatically
    // (supports Arabic, French, English, and 99 other languages)
    const submitRes = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: uploadUrl,
        speaker_labels: true,
        speakers_expected: 2,
        ...(language ? { language_code: language } : { language_detection: true }),
      }),
    });
    if (!submitRes.ok) {
      throw new Error(`AssemblyAI transcript submit failed (${submitRes.status}): ${await submitRes.text()}`);
    }
    const transcript = await submitRes.json();

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
