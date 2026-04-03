/**
 * transcribe-memo Edge Function
 *
 * Receives a base64-encoded audio recording from the app,
 * sends it to OpenAI Whisper, and returns the transcript.
 *
 * Auth: RLS-based. verify_jwt = false in config.toml.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders,
    });
  }

  const body = await req.json();
  const { audio, mimeType, language } = body; // audio = base64 string; language optional e.g. 'en', 'ar'

  if (!audio) {
    return new Response(JSON.stringify({ error: 'Missing audio' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Decode base64 → binary (strip whitespace first — mobile base64 may include newlines)
    const cleanAudio = audio.replace(/\s/g, '');
    const audioBytes = Uint8Array.from(atob(cleanAudio), c => c.charCodeAt(0));
    const resolvedMime = mimeType ?? 'audio/webm';
    const audioBlob = new Blob([audioBytes], { type: resolvedMime });

    // Pick the correct file extension so Whisper detects the format correctly
    const extMap: Record<string, string> = {
      'audio/webm': 'webm',
      'audio/m4a': 'm4a',
      'audio/mp4': 'mp4',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
    };
    const ext = extMap[resolvedMime] ?? 'webm';

    // Build multipart form for Whisper
    const formData = new FormData();
    formData.append('file', audioBlob, `memo.${ext}`);
    formData.append('model', 'whisper-1');
    // Use caller-supplied language if provided, otherwise Whisper auto-detects
    if (language) formData.append('language', language);

    const res = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[transcribe-memo] Whisper error:', err);
      return new Response(JSON.stringify({ error: `Whisper failed: ${err}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json();
    const transcript = data.text ?? '';

    console.log(`[transcribe-memo] Transcribed: "${transcript.slice(0, 80)}..."`);

    return new Response(JSON.stringify({ transcript }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[transcribe-memo] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
