/**
 * transcribe-google Edge Function
 *
 * Receives base64-encoded audio from the app (hands-free mode),
 * sends it to OpenAI Whisper for transcription.
 *
 * Originally used Google Cloud STT but switched to Whisper because
 * Google was returning empty transcripts for AMR-WB audio from Samsung S23.
 * Whisper handles the same audio correctly (proven via tap-to-talk).
 *
 * Returns { transcript: string } — empty string for silence.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { audio, mimeType, language } = await req.json() as {
      audio: string;
      mimeType?: string;
      language?: string;
    };

    if (!audio) {
      return new Response(JSON.stringify({ error: 'Missing audio' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Clean base64 (mobile may include newlines)
    const cleanAudio = audio.replace(/\s/g, '');
    console.log(`[transcribe-google] Received: mimeType=${mimeType}, audio length=${cleanAudio.length} chars`);

    // Decode base64 to binary
    const audioBytes = Uint8Array.from(atob(cleanAudio), c => c.charCodeAt(0));
    const resolvedMime = (mimeType ?? 'audio/amr-wb').toLowerCase();
    const audioBlob = new Blob([audioBytes], { type: resolvedMime });

    // Map MIME type to file extension for Whisper
    const extMap: Record<string, string> = {
      'audio/amr-wb': '3gp',
      'audio/amr': '3gp',
      'audio/3gpp': '3gp',
      'audio/webm': 'webm',
      'audio/m4a': 'm4a',
      'audio/mp4': 'mp4',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
    };
    const ext = extMap[resolvedMime] ?? '3gp';

    // Build multipart form for Whisper
    const formData = new FormData();
    formData.append('file', audioBlob, `chunk.${ext}`);
    formData.append('model', 'whisper-1');
    if (language) formData.append('language', language);
    formData.append('prompt', 'Voice command from Robert speaking English.');

    const res = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[transcribe-google] Whisper error:', err);
      return new Response(JSON.stringify({ error: `Whisper failed: ${err}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json();
    const transcript = (data.text ?? '').trim();

    console.log(`[transcribe-google] Transcribed: "${transcript.slice(0, 80)}${transcript.length > 80 ? '...' : ''}"`);

    return new Response(JSON.stringify({ transcript }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[transcribe-google] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
