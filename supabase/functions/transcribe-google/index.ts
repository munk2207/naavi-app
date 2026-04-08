/**
 * transcribe-google Edge Function
 *
 * Receives base64-encoded audio from the app,
 * sends it to Google Cloud Speech-to-Text v1, and returns the transcript.
 *
 * Key advantage over Whisper: silence returns empty string (no hallucinations).
 *
 * Required Supabase secret:
 *   GOOGLE_CLOUD_STT_KEY  — Google Cloud API key with Speech-to-Text enabled
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { audio, mimeType, language } = await req.json() as {
      audio: string;       // base64-encoded audio
      mimeType?: string;   // e.g. 'audio/m4a', 'audio/webm'
      language?: string;   // e.g. 'en', 'en-US'
    };

    if (!audio) {
      return new Response(JSON.stringify({ error: 'Missing audio' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('GOOGLE_CLOUD_STT_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GOOGLE_CLOUD_STT_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Clean base64 (mobile may include newlines)
    const cleanAudio = audio.replace(/\s/g, '');

    // Map MIME type to Google Cloud STT encoding
    const resolvedMime = (mimeType ?? 'audio/m4a').toLowerCase();
    let encoding = 'AMR_WB';      // default fallback
    let sampleRate = 16000;

    if (resolvedMime.includes('m4a') || resolvedMime.includes('mp4') || resolvedMime.includes('aac')) {
      // M4A/AAC — Google STT doesn't support directly, but MP4 container with AAC works
      // We need to use the OGG_OPUS or send as-is and let Google detect
      // Actually Google Cloud STT v1 supports: FLAC, LINEAR16, MULAW, AMR, AMR_WB, OGG_OPUS, WEBM_OPUS, MP3
      // For M4A (AAC in MP4 container): not directly supported by v1
      // Solution: use v1p1beta1 which has AUTO encoding detection
      encoding = 'MP3';  // will use v1p1beta1 with auto-detect instead
    } else if (resolvedMime.includes('webm') || resolvedMime.includes('opus')) {
      encoding = 'WEBM_OPUS';
    } else if (resolvedMime.includes('wav')) {
      encoding = 'LINEAR16';
    } else if (resolvedMime.includes('mp3') || resolvedMime.includes('mpeg')) {
      encoding = 'MP3';
    } else if (resolvedMime.includes('ogg')) {
      encoding = 'OGG_OPUS';
    } else if (resolvedMime.includes('flac')) {
      encoding = 'FLAC';
    }

    // Resolve language code
    const langCode = language?.includes('-') ? language : `${language ?? 'en'}-US`;

    // Use v1p1beta1 for auto encoding detection (handles M4A/AAC)
    const apiUrl = `https://speech.googleapis.com/v1p1beta1/speech:recognize?key=${apiKey}`;

    const requestBody: Record<string, unknown> = {
      config: {
        languageCode: langCode,
        sampleRateHertz: sampleRate,
        audioChannelCount: 1,
        enableAutomaticPunctuation: true,
        model: 'default',
      },
      audio: {
        content: cleanAudio,
      },
    };

    // Only set encoding for formats Google recognizes directly
    // For M4A/AAC, omit encoding and let Google auto-detect
    if (resolvedMime.includes('m4a') || resolvedMime.includes('mp4') || resolvedMime.includes('aac')) {
      // Omit encoding — v1p1beta1 auto-detects
    } else {
      (requestBody.config as Record<string, unknown>).encoding = encoding;
    }

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[transcribe-google] Google STT error:', JSON.stringify(data));
      return new Response(JSON.stringify({ error: data.error?.message ?? 'Google STT failed' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract transcript — empty results array means silence (no hallucination!)
    const results = data.results ?? [];
    const transcript = results
      .map((r: { alternatives?: { transcript?: string }[] }) => r.alternatives?.[0]?.transcript ?? '')
      .join(' ')
      .trim();

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
