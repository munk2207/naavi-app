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

// Spell out date-context day numbers as ordinal words so Aura reads them
// naturally instead of digit-by-digit. Aura was reading "October 15" as
// "October one five tee etch" — the bare cardinal 15 confuses the model
// in a date context. Forcing the ordinal word ("fifteenth") removes the
// ambiguity and produces natural English date speech.
//
// Step 1: strip ordinal suffixes from numbers ("15th" → "15") so step 2
// can match a uniform format regardless of how the source text wrote it.
// Step 2: after any English month name, replace 1-31 with the matching
// ordinal word.
//
// Phone numbers (7+ digit runs) are handled separately by
// normalizePhoneForTTS and are unaffected by this 1-2 digit regex.
// Years (4 digits) are unaffected.
const DATE_ORDINAL_WORDS: Record<string, string> = {
  '1': 'first', '2': 'second', '3': 'third', '4': 'fourth', '5': 'fifth',
  '6': 'sixth', '7': 'seventh', '8': 'eighth', '9': 'ninth', '10': 'tenth',
  '11': 'eleventh', '12': 'twelfth', '13': 'thirteenth', '14': 'fourteenth', '15': 'fifteenth',
  '16': 'sixteenth', '17': 'seventeenth', '18': 'eighteenth', '19': 'nineteenth', '20': 'twentieth',
  '21': 'twenty-first', '22': 'twenty-second', '23': 'twenty-third', '24': 'twenty-fourth',
  '25': 'twenty-fifth', '26': 'twenty-sixth', '27': 'twenty-seventh', '28': 'twenty-eighth',
  '29': 'twenty-ninth', '30': 'thirtieth', '31': 'thirty-first',
};
const MONTH_NAMES = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const MONTH_DAY_RE = new RegExp(`(${MONTH_NAMES})\\s+(\\d{1,2})\\b`, 'gi');

// Mobile's `sanitiseForSpeech` over-splits letter+digit tokens, breaking
// "15th" into "1 5 t h" before the text reaches TTS. Rejoin the broken
// ordinal back into its original form so the rest of the pipeline can
// process it normally. Mobile-side fix is queued as AAB item #18.
function rejoinBrokenOrdinalsForTTS(text: string): string {
  if (!text) return text;
  // 1-digit ordinals: "1 s t" / "5 t h" / "3 r d" / "2 n d"
  // 2-digit ordinals: "1 5 t h" / "2 1 s t" / "3 0 t h"
  return text.replace(
    /\b(\d)(?:\s+(\d))?\s+(s\s+t|n\s+d|r\s+d|t\s+h)\b/gi,
    (match) => match.replace(/\s+/g, '')
  );
}

function normalizeOrdinalsForTTS(text: string): string {
  if (!text) return text;
  // Step 0: rejoin ordinals broken by mobile-side over-splitting
  text = rejoinBrokenOrdinalsForTTS(text);
  // Step 1: strip ordinal suffixes
  text = text.replace(/(\d+)(?:st|nd|rd|th)\b/gi, '$1');
  // Step 2: spell out day numbers after a month name
  text = text.replace(MONTH_DAY_RE, (_m, month, num) => {
    const word = DATE_ORDINAL_WORDS[num];
    return word ? `${month} ${word}` : `${month} ${num}`;
  });
  return text;
}

// V57.8 — expand street-suffix abbreviations to full words so Aura reads
// addresses correctly. Wael flagged Naavi pronouncing "962 Terranova Dr"
// as "962 Terranova Doctor" — "Dr" was being read as "Doctor" because
// that's the more common dictionary expansion. Address abbreviations
// only get expanded when in unambiguous address context (preceded by a
// street name token + followed by ",", " in", or end-of-line).
//
// "Dr." with a period followed by a capitalized name (Dr. Smith) is
// LEFT ALONE — that's correctly read as "Doctor".
function expandAddressAbbreviations(text: string): string {
  if (!text) return text;
  // Each entry: bare abbrev (no period), expansion. Only one-word
  // street suffixes — multi-word like "Apt 4" stay unchanged.
  const SUFFIX_MAP: Record<string, string> = {
    'Dr':   'Drive',
    'St':   'Street',
    'Ave':  'Avenue',
    'Blvd': 'Boulevard',
    'Rd':   'Road',
    'Ln':   'Lane',
    'Ct':   'Court',
    'Pl':   'Place',
    'Hwy':  'Highway',
    'Pkwy': 'Parkway',
    'Sq':   'Square',
    'Ter':  'Terrace',
    'Cir':  'Circle',
    'Trl':  'Trail',
  };
  // Pattern: street name word + abbrev + (comma | space + city-ish word | EOL)
  // We require a preceding capitalized word so "I'll Dr you home" doesn't match.
  const pattern = new RegExp(
    `(\\b[A-Z][a-zA-Z]+)\\s+(${Object.keys(SUFFIX_MAP).join('|')})\\b(\\.?)(?=\\s*(?:,|$|\\n))`,
    'g',
  );
  return text.replace(pattern, (_m, name, abbrev, _dot) => `${name} ${SUFFIX_MAP[abbrev]}`);
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
    const normalised = expandAddressAbbreviations(normalizeOrdinalsForTTS(normalizePhoneForTTS(text)));
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
