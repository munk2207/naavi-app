/**
 * resolveRelationshipToName — 2026-08-13
 *
 * "Text my wife" / "send SMS to my wife" never resolved to a real contact:
 * the prompt claims "contact resolution happens automatically" for this
 * exact phrase, but every caller (DraftCard's lookupContact/resolveRecipient,
 * lookup-contact, resolve-recipient) searched Google Contacts for the
 * literal string "wife" — no contact is ever named that, so it always came
 * back not-found (or forced a manual-entry fallback), even when the user
 * had already told Naavi "Linda is my wife" via REMEMBER.
 *
 * This checks knowledge_fragments for a saved relationship fact matching
 * the word, before the caller runs its normal name-based contact search —
 * same pattern as the PERSON_LOOKUP fix (naavi-chat/intentHandlers.ts),
 * reusing the "who is my <word>" phrasing that clears the embedding
 * similarity threshold (verified live: bare word ~0, full phrase ~0.625).
 *
 * Returns the resolved person's name (e.g. "Linda") on a match, or null if
 * `word` isn't a known relationship word, nothing is saved, or the saved
 * fact's wording doesn't match either canonical shape below — callers
 * should fall back to their normal literal-name search in that case, never
 * guess.
 */

import { RELATIONSHIP_WORDS } from './relationship_words.ts';

const OPENAI_API = 'https://api.openai.com/v1/embeddings';
const MIN_SIMILARITY = 0.5;

async function generateEmbedding(text: string): Promise<number[] | null> {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) return null;
  try {
    const res = await fetch(OPENAI_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text, dimensions: 1536 }),
    });
    const data = await res.json();
    return data?.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// Matches both observed REMEMBER phrasings: "Linda is my wife" and
// "my wife is Linda" — the get-naavi-prompt REMEMBER spec doesn't fix an
// order, so both must be handled, not just whichever one this bug's repro
// happened to produce.
function extractNameFromFact(content: string, word: string): string | null {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameFirst = new RegExp(`^(.+?)\\s+is\\s+my\\s+${escaped}\\b`, 'i');
  const wordFirst = new RegExp(`^my\\s+${escaped}\\s+is\\s+(.+?)[.\\s]*$`, 'i');
  const m1 = content.match(nameFirst);
  if (m1?.[1]) return m1[1].trim();
  const m2 = content.match(wordFirst);
  if (m2?.[1]) return m2[1].trim();
  return null;
}

export async function resolveRelationshipToName(
  word: string,
  userId: string,
  // deno-lint-ignore no-explicit-any
  adminClient: any,
): Promise<string | null> {
  const w = word.trim().toLowerCase();
  if (!RELATIONSHIP_WORDS.has(w)) return null;

  const embedding = await generateEmbedding(`who is my ${w}`);
  if (!embedding) return null;

  const { data, error } = await adminClient.rpc('search_knowledge_fragments', {
    query_embedding: JSON.stringify(embedding),
    match_count: 3,
    p_user_id: userId,
  });
  if (error || !Array.isArray(data)) return null;

  for (const row of data as Array<{ content?: string; similarity?: number }>) {
    if (typeof row.similarity !== 'number' || row.similarity < MIN_SIMILARITY) continue;
    const name = extractNameFromFact(String(row.content ?? ''), w);
    if (name) return name;
  }
  return null;
}
