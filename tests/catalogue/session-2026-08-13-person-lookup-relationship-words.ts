/**
 * 2026-08-13 — PERSON_LOOKUP relationship-word regression.
 *
 * Live bug, found by Wael testing "Remember Linda is my wife" then
 * "Who is my wife" in the app: the fact saved correctly (confirmed in the
 * Notes screen and DB), but the follow-up question replied "I didn't find
 * anything about 'wife'."
 *
 * Root cause (verified live against staging, not inferred): naavi-chat's
 * Haiku classifier extracts PERSON_LOOKUP → params.name = "wife" (the bare
 * relationship word). handlePersonLookup passed that single word straight
 * to global-search's knowledge adapter, which embeds it and runs a pgvector
 * cosine-similarity search with a 0.5 minimum. Query "wife" alone scored
 * below threshold against the saved fragment "Linda is my wife"; the full
 * question "who is my wife" scored 0.625 against the same fragment. One
 * word carries too little semantic content for the embedding search to
 * find a full-sentence fact.
 *
 * Fix: supabase/functions/naavi-chat/intentHandlers.ts — handlePersonLookup
 * now expands a bare relationship word ("wife", "boss", "mom", etc.) into
 * "who is my <word>" before querying global-search, giving the embedding
 * search the same full-sentence shape that clears the threshold.
 *
 * This test ingests a fresh, uniquely-marked relationship fact and then
 * asks the bare-word question through the real naavi-chat round-trip
 * (Claude classifies for real — non-deterministic like the rest of the
 * memory.* suite) — asserting the honest-out message does NOT fire for a
 * fact that was just saved. Matches the "don't strictly assert exact
 * content, but the chain not degrading into honest-out IS the test"
 * pattern already used in memory.ts for the same non-determinism reason.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectFalsy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const personLookupRelationshipWordsTests: TestCase[] = [
  {
    id: 'session-2026-08-13.person-lookup-bare-relationship-word',
    category: 'memory',
    description:
      'PERSON_LOOKUP must resolve a bare relationship word ("boss") to a ' +
      'just-saved fact instead of falsely reporting nothing found.',
    timeoutMs: 30_000,
    async run(ctx) {
      const marker = `AutoTesterBoss${Date.now()}`;
      const ingest = await adapters.ingestNote(ctx, `${marker} is my boss.`);
      ctx.log(`ingest status=${ingest.status}`);
      expect2xx(ingest.status, 'ingest-note');

      // Give the embedding time to persist before searching for it.
      await new Promise(r => setTimeout(r, 2000));

      const chat = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Who is my boss' }],
      });
      expect2xx(chat.status, 'naavi-chat');

      const raw = chat.data?.rawText ?? chat.data ?? '';
      const parsed = typeof raw === 'string' ? safeParse(raw) : raw;
      const speech: string = (parsed?.speech ?? JSON.stringify(parsed) ?? '').toString();
      ctx.log(`speech="${speech.slice(0, 300)}"`);

      // The regression: bare-word PERSON_LOOKUP falling back to the
      // honest-out "I didn't find anything" message for a fact that was
      // just saved seconds earlier.
      expectFalsy(
        /didn't find anything/i.test(speech),
        `Expected "who is my boss" to find the just-saved fact about ${marker}, ` +
        `but got the honest-out no-results message: "${speech}"`,
      );
    },
  },
];

function safeParse(text: string): any {
  try { return JSON.parse(text); } catch { return { speech: text }; }
}
