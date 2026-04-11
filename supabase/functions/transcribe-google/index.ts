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
    // Anti-hallucination configuration:
    // - NO priming prompt (prompts like "Robert speaking English" make Whisper
    //   invent English speech on silence to match the expected pattern)
    // - temperature=0 (deterministic, no creative completion)
    // - response_format=verbose_json (so we get per-segment no_speech_prob and
    //   avg_logprob, which let us detect and drop hallucinated silence server-side)
    const formData = new FormData();
    formData.append('file', audioBlob, `chunk.${ext}`);
    formData.append('model', 'whisper-1');
    if (language) formData.append('language', language);
    formData.append('temperature', '0');
    formData.append('response_format', 'verbose_json');

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

    const data = await res.json() as {
      text?: string;
      segments?: Array<{
        no_speech_prob?: number;
        avg_logprob?: number;
        compression_ratio?: number;
        text?: string;
      }>;
    };

    const rawTranscript = (data.text ?? '').trim();

    // ── Server-side hallucination detection ──
    // Three layers of defense:
    //   1. Single-word hallucination blacklist (most aggressive — Whisper tends
    //      to invent single filler words on silence/noise with high confidence)
    //   2. Per-segment confidence checks (no_speech_prob, avg_logprob, compression)
    //   3. If every segment fails, drop the whole transcript
    //
    // The blacklist is intentionally narrow — it only triggers on single-word
    // transcripts, so "Hi Naavi" (wake), "thanks" (submit), "goodbye" (exit)
    // and any real voice command of 2+ words still pass through.
    const SINGLE_WORD_HALLUCINATIONS = new Set([
      'you', 'the', 'and', 'to', 'a', 'i', 'is', 'of', 'in', 'it',
      'that', 'this', 'for', 'on', 'with', 'as', 'at', 'by', 'from',
      'so', 'oh', 'um', 'uh', 'yeah', 'okay', 'ok', 'hmm', 'mm',
      'hi', 'no', 'yes', 'what', 'huh', 'ah', 'eh', 'bye',
      'well', 'now', 'just', 'like', 'go', 'see', 'me', 'my',
    ]);

    const segments = data.segments ?? [];
    let transcript = rawTranscript;
    let droppedReason: string | null = null;

    const words = rawTranscript.toLowerCase().replace(/[.,!?;:]/g, '').split(/\s+/).filter(w => w);

    // Compute worst-case segment confidence (for Layer 1 suspicion check)
    const maxNoSpeechProb = segments.reduce((max, seg) => {
      const ns = seg.no_speech_prob ?? 0;
      return ns > max ? ns : max;
    }, 0);

    // Layer 1: single-word blacklist — only drop if segment ALSO looks suspicious.
    // This protects real short responses (confident "Hi") while still catching
    // hallucinated "you" / "the" / "oh" from silence.
    const isBlacklistedSingleWord =
      words.length === 1 && SINGLE_WORD_HALLUCINATIONS.has(words[0]);

    if (isBlacklistedSingleWord && maxNoSpeechProb > 0.3) {
      droppedReason = `suspicious single-word: "${words[0]}" (no_speech_prob=${maxNoSpeechProb.toFixed(2)})`;
      transcript = '';
    }
    // Layer 2+3: per-segment confidence check
    else if (segments.length > 0) {
      const allHallucinated = segments.every(seg => {
        const noSpeech = seg.no_speech_prob ?? 0;
        const logprob = seg.avg_logprob ?? 0;
        const compression = seg.compression_ratio ?? 0;
        return noSpeech > 0.6 || logprob < -1.0 || compression > 2.4;
      });
      if (allHallucinated) {
        droppedReason = `all ${segments.length} segments failed confidence checks`;
        transcript = '';
      }
    }

    if (droppedReason) {
      console.log(`[transcribe-google] Dropped hallucination (${droppedReason}): "${rawTranscript.slice(0, 80)}"`);
    } else {
      console.log(`[transcribe-google] Transcribed: "${transcript.slice(0, 80)}${transcript.length > 80 ? '...' : ''}"`);
    }

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
