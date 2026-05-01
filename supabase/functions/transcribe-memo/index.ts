/**
 * transcribe-memo Edge Function
 *
 * V57.9.5: switched STT from OpenAI Whisper to Deepgram nova-3.
 *   Whisper short-clip latency was 5-15 seconds (Wael 2026-04-30:
 *   ~14 s of post-upload time on a 1-2 second utterance). Deepgram
 *   nova-3 typically transcribes the same audio in 1-3 seconds and
 *   the voice-server has been using it successfully via the
 *   streaming WebSocket API for months. We reuse DEEPGRAM_API_KEY
 *   (already a Supabase secret) — no new credentials.
 *
 * V57.9.4: accepts EITHER:
 *   - { audio: <base64>, mimeType, language }       (legacy path, V57.9.3 and older mobile)
 *   - { storage_path: <bucket key>, mimeType, language }  (V57.9.4+ mobile)
 *
 *   Storage path keeps the request body tiny (<500 bytes) and
 *   bypasses the API gateway upload bottleneck.
 *
 * Response: { transcript: string } — same as before.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VOICE_BUCKET = 'voice-memos';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders,
    });
  }

  const body = await req.json();
  const { audio, storage_path, mimeType, language } = body;

  if (!audio && !storage_path) {
    return new Response(JSON.stringify({ error: 'Missing audio or storage_path' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const t0 = Date.now();

  try {
    let audioBytes: Uint8Array;
    const resolvedMime = mimeType ?? 'audio/m4a';
    let sourceLabel: string;

    if (storage_path) {
      // V57.9.4 path — pull bytes from Storage bucket using service role.
      sourceLabel = `storage:${storage_path}`;
      const supaUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
      const { data: blob, error: dlErr } = await admin.storage
        .from(VOICE_BUCKET)
        .download(String(storage_path));
      if (dlErr || !blob) {
        const msg = dlErr?.message ?? 'storage download returned empty';
        console.error('[transcribe-memo] storage download error:', msg);
        return new Response(JSON.stringify({ error: `Storage download failed: ${msg}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      audioBytes = new Uint8Array(await blob.arrayBuffer());
      // Best-effort delete after download — voice memos are transient.
      admin.storage.from(VOICE_BUCKET).remove([String(storage_path)]).catch(() => {});
    } else {
      // Legacy V57.9.3-and-older path — base64 in JSON body.
      sourceLabel = `base64:${audio.length}`;
      const cleanAudio = String(audio).replace(/\s/g, '');
      audioBytes = Uint8Array.from(atob(cleanAudio), c => c.charCodeAt(0));
    }

    console.log(`[transcribe-memo] +${Date.now() - t0}ms audio loaded | source=${sourceLabel} | bytes=${audioBytes.length}`);

    // Deepgram pre-recorded transcription. Same nova-3 model the voice
    // server uses on its streaming WebSocket — proven to handle Wael's
    // and Robert's accents reliably with the keyterm boosts below.
    const dgParams = new URLSearchParams({
      model: 'nova-3',
      language: typeof language === 'string' && language.length > 0 ? language : 'en',
      smart_format: 'true',
      punctuate: 'true',
    });
    // Keyterms — match the voice-server's WebSocket setup so the
    // app-side voice memos recognize Naavi's name and the canonical
    // command verbs the same way.
    dgParams.append('keyterm', 'naavi');
    dgParams.append('keyterm', 'nahvee');
    for (const verb of ['alert', 'remind', 'notify', 'text', 'message', 'email', 'find', 'search', 'schedule', 'cancel', 'record', 'forget', 'remember', 'save', 'set', 'when', 'arrive', 'leave']) {
      dgParams.append('keyterm', verb);
    }

    const dgKey = Deno.env.get('DEEPGRAM_API_KEY');
    if (!dgKey) {
      return new Response(JSON.stringify({ error: 'DEEPGRAM_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const dgStart = Date.now();
    const dgRes = await fetch(`${DEEPGRAM_URL}?${dgParams.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${dgKey}`,
        'Content-Type': resolvedMime,
      },
      body: audioBytes,
    });
    const dgMs = Date.now() - dgStart;

    if (!dgRes.ok) {
      const errText = await dgRes.text();
      console.error('[transcribe-memo] Deepgram error:', dgRes.status, errText);
      return new Response(JSON.stringify({ error: `Deepgram failed: ${errText}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const dgData = await dgRes.json();
    const transcript: string =
      dgData?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';

    console.log(
      `[transcribe-memo] +${Date.now() - t0}ms total | deepgram=${dgMs}ms | ` +
      `bytes=${audioBytes.length} | transcript="${transcript.slice(0, 80)}"`
    );

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
