/**
 * Query expansion — normalise user queries so "payments" and "pay" return
 * the same results, and natural-language synonyms (bill, meeting, doctor)
 * map to the stored `action_type` enum values in email_actions.
 *
 * Session 19 "One Question, One Answer" — every Global Search caller uses
 * this helper so adapters share deterministic behaviour across phrasings.
 *
 * Returns the original query plus any derived variants, all lowercased,
 * deduped. Always includes the original (even if unchanged) so adapters can
 * treat the returned array as authoritative.
 */

// Natural-language → stored-value synonym map. Start small and focused on
// email_actions.action_type — the enum values that generated today's most
// visible inconsistency. Extend as we learn.
const SYNONYMS: Record<string, string[]> = {
  // pay / payment / bill / owe / due → stored as action_type='pay'
  bill:     ['pay'],
  payment:  ['pay'],
  owed:     ['pay'],
  due:      ['pay'],
  invoice:  ['pay'],

  // appointment / meeting / doctor → stored as 'appointment'
  meeting:  ['appointment'],
  doctor:   ['appointment'],

  // delivery / shipment / tracking → stored as 'delivery'
  shipment: ['delivery'],
  tracking: ['delivery'],
};

function stemWord(word: string): string {
  if (word.length < 4) return word;
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('ss')) return word; // access, address
  if (word.endsWith('us')) return word; // status, focus
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

// Noise-prefix strip — many natural-language queries arrive as "email
// about X" / "any emails about X" / "message from X" / etc. Adapters do
// literal substring matching against stored content (subject, body,
// contact name). Without stripping the noise prefix, ILIKE %email about
// X% never matches subject "X". Bug discovered 2026-05-10 during Wael's
// deep test of the birthday-party email — gmail adapter returned 0 hits
// because the variant was "email about birthday party", not "birthday
// party". Locked in via tests/catalogue/search-normalization.ts.
//
// We KEEP the original variant as well — adapters get both. The
// stripped variant is a hint, never a replacement, so over-stripping
// (a subject literally containing "email about ...") still finds it.
const NOISE_PREFIX_RE =
  /^(?:any|an?|the|some|my)?\s*(?:emails?|messages?|mails?|inbox)\s+(?:about|on|from|regarding|re|with|mentioning|saying|involving)\s+/i;

export function expandQuery(raw: string): string[] {
  const lower = raw.toLowerCase().trim();
  if (!lower) return [];

  const variants = new Set<string>([lower]);

  const stripped = lower.replace(NOISE_PREFIX_RE, '').trim();
  if (stripped && stripped !== lower) variants.add(stripped);

  const words = lower.split(/\s+/).filter(Boolean);
  const stems = words.map(stemWord);

  // Stemmed whole-query variant (plural → singular phrase)
  const stemmedJoin = stems.join(' ');
  if (stemmedJoin !== lower) variants.add(stemmedJoin);

  // Synonyms per word — check both the word and its stem. Add the synonym
  // as a single token (not as a reassembled phrase) because the synonym
  // targets are short enum values that already work as substrings.
  for (const w of new Set([...words, ...stems])) {
    const syns = SYNONYMS[w];
    if (syns) for (const s of syns) variants.add(s);
  }

  // Email-shaped tokens: also include the username alone as a variant.
  // "david@gmail.com" → add "david" so searches for "find David at gmail.com"
  // still surface every David in contacts, even if none has that exact
  // address. Exact-email matches still score higher and rank first.
  for (const w of words) {
    const atIdx = w.indexOf('@');
    if (atIdx > 0 && atIdx < w.length - 1) {
      const username = w.slice(0, atIdx);
      if (username.length >= 2) variants.add(username);
    }
  }

  return Array.from(variants);
}
