/**
 * transcribe-memo Edge Function
 *
 * V57.9.4: now accepts EITHER:
 *   - { audio: <base64>, mimeType, language }       (legacy path, V57.9.3 and older mobile builds)
 *   - { storage_path: <bucket key>, mimeType, language }  (V57.9.4+ mobile)
 *
 * The new storage_path mode reads the file from Supabase Storage's
 * `voice-memos` bucket, which keeps the request body tiny (<500 bytes)
 * and lets the actual audio bytes travel over the dedicated Storage
 * upload endpoint. Drops the cold-start "Processing…" hang from 30s
 * to a few seconds (same architecture win as V57.9.3 chat send).
 *
 * Whisper itself is called identically in both modes — the only
 * difference is HOW we load the audio bytes into memory before
 * forwarding to Whisper.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VOICE_BUCKET = 'voice-memos';

const EXT_MAP: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/m4a':  'm4a',
  'audio/mp4':  'mp4',
  'audio/mpeg': 'mp3',
  'audio/ogg':  'ogg',
  'audio/wav':  'wav',
  'audio/3gp':  '3gp',
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
  const { audio, storage_path, mimeType, language } = body;

  if (!audio && !storage_path) {
    return new Response(JSON.stringify({ error: 'Missing audio or storage_path' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const t0 = Date.now();

  try {
    let audioBytes: Uint8Array;
    let resolvedMime = mimeType ?? 'audio/webm';
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
      // Failure is non-fatal; a cleanup job can sweep stragglers.
      admin.storage.from(VOICE_BUCKET).remove([String(storage_path)]).catch(() => {});
    } else {
      // Legacy V57.9.3-and-older path — base64 in JSON body.
      sourceLabel = `base64:${audio.length}`;
      const cleanAudio = String(audio).replace(/\s/g, '');
      audioBytes = Uint8Array.from(atob(cleanAudio), c => c.charCodeAt(0));
    }

    const audioBlob = new Blob([audioBytes], { type: resolvedMime });
    const ext = EXT_MAP[resolvedMime] ?? 'webm';

    console.log(`[transcribe-memo] +${Date.now() - t0}ms audio loaded | source=${sourceLabel} | bytes=${audioBytes.length}`);

    // Build multipart form for Whisper
    const formData = new FormData();
    formData.append('file', audioBlob, `memo.${ext}`);
    formData.append('model', 'whisper-1');
    if (language) formData.append('language', language);
    formData.append('prompt', 'Voice command from Robert speaking English.');

    const whisperStart = Date.now();
    const res = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      },
      body: formData,
    });
    const whisperMs = Date.now() - whisperStart;

    if (!res.ok) {
      const err = await res.text();
      console.error('[transcribe-memo] Whisper error:', err);
      return new Response(JSON.stringify({ error: `Whisper failed: ${err}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json();
    const transcript = data.text ?? '';

    console.log(
      `[transcribe-memo] +${Date.now() - t0}ms total | whisper=${whisperMs}ms | ` +
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
