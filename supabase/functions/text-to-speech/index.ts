/**
 * text-to-speech Edge Function
 *
 * Converts text to speech using Deepgram's aura-hera-en — the SAME voice the
 * voice server uses on phone calls — so the mobile app and phone sound
 * identical. Returns base64-encoded MP3 audio so it plays identically on
 * every browser (Chrome, Edge, Safari, Firefox) and on Android/iOS.
 *
 * The `voice` parameter in the request body is accepted for backwards
 * compatibility with existing mobile clients but ignored — the function
 * always returns aura-hera-en.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Normalise contiguous digit runs into single-digit form so Aura reads them
// one digit at a time instead of parsing groups as cardinal numbers.
// "+1 613 797 6746" would otherwise be read as "plus one, six hundred
// thirteen, seven hundred ninety-seven, six thousand seven hundred forty-
// six". After this pass it becomes "+1 6 1 3 7 9 7 6 7 4 6" → "plus one,
// six, one, three, seven, nine, seven…".
// Mirrors the identical helper in naavi-voice-server/src/index.js so mobile
// chat and phone calls sound the same.
// Runs shorter than 7 digits are left alone (years, small amounts, etc.).
function normalizePhoneForTTS(text: string): string {
  if (!text) return text;

  // +1 prefix with 9-11 contiguous digits (optionally space between +1 and digits)
  text = text.replace(/\+1\s*(\d{9,11})\b/g, (_m, d) => `+1 ${d.split('').join(' ')}`);

  // Pre-grouped phone like "+1 123 456 7890" or "+1 123-456-7890"
  text = text.replace(/\+1\s+(\d{3})[\s-](\d{3})[\s-](\d{4})\b/g, (_m, a, b, c) =>
    `+1 ${(a + b + c).split('').join(' ')}`);

  // Bare 10-digit North American number (and its grouped forms)
  text = text.replace(/\b(\d{3})[\s-](\d{3})[\s-](\d{4})\b/g, (_m, a, b, c) =>
    (a + b + c).split('').join(' '));
  text = text.replace(/\b(\d{10})\b/g, (m) => m.split('').join(' '));

  // Bare 7-digit local number
  text = text.replace(/\b(\d{7})\b/g, (m) => m.split('').join(' '));

  return text;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const apiKey = Deno.env.get('DEEPGRAM_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Deepgram API key not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const rawBody = await req.text();
    console.log('[text-to-speech] raw body length:', rawBody?.length ?? 0);
    if (!rawBody) {
      return new Response(JSON.stringify({ error: 'Empty request body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { text } = JSON.parse(rawBody);
    if (!text?.trim()) {
      return new Response(JSON.stringify({ error: 'Missing text' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const normalised = normalizePhoneForTTS(text);
    console.log('[text-to-speech] voice: aura-hera-en, text length:', text.length, 'normalised length:', normalised.length);

    const res = await fetch('https://api.deepgram.com/v1/speak?model=aura-hera-en&encoding=mp3', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: normalised }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[text-to-speech] Deepgram error:', err);
      return new Response(JSON.stringify({ error: err }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    return new Response(JSON.stringify({ audio: base64 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[text-to-speech] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
