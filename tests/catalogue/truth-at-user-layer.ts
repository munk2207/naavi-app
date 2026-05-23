/**
 * Truth-at-user-layer regression tests — Wael 2026-05-10.
 *
 * Locks in the FOUNDATIONAL PRINCIPLE: Naavi must never say something
 * that is not true from the user's perspective. The DB state is
 * irrelevant if it diverges from what the user sees.
 *
 * See `memory/project_naavi_truth_at_user_layer.md` for the full
 * principle. This file exercises the most user-visible application:
 * **source-specific questions must answer the source asked**, not pivot
 * to a related-but-different source.
 *
 * Trigger case (2026-05-10):
 *   User asked "Do I have email about birthday cake?". Email was in
 *   Trash → gmail adapter excluded it correctly. But knowledge_fragments
 *   had a derived note "I am buying the birthday cake this year" →
 *   memory adapter returned 1 hit. Naavi's response: "Found it — you
 *   have a note that says...". User's reaction: "you said cake was not
 *   excluded". The user asked about email; Naavi answered about a note
 *   without first acknowledging "no email".
 *
 * Locked-in behavior post-fix (Wael 2026-05-10 stricter revision):
 *   - When the user asks about a specific source ("email about X",
 *     "document about X", "note about X", "meeting about X"), Naavi's
 *     reply MUST answer ONLY about THAT source. No mixing.
 *   - If the named source has no hit, Naavi says "no, you don't have
 *     an email about X" — full stop. Do NOT pivot to mentioning notes,
 *     drive, memory, or any other source.
 *   - Naavi MUST NOT lead with "Found it" / "Yes" when the literal
 *     answer to the source question is no.
 *   - Open-ended phrasings ("what do we know about X", "tell me about
 *     X", "anything about X") are different — those DO get global
 *     search and may surface multiple sources. This file covers ONLY
 *     the named-source case.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectMatch, expectTruthy, extractSpeech } from '../lib/assertions';
import type { TestCase } from '../lib/types';

function uniqueTag(): string {
  // 2026-05-22 (Wael) — natural-language tag (spaces, no hyphens, small
  // number). Haiku's garbled-text guard (prompt rule line 101) trips on
  // hyphen-digit patterns like "birthday-cake-1234" — it pattern-matches
  // to "looks like a test fixture" and short-circuits to "I didn't
  // quite catch that, <name>." Using a plain phrase with a small
  // trailing number ("birthday cake number 1234") looks like normal
  // English so Claude runs global_search and produces the honest-out
  // reply the test expects. Uniqueness is still good (1 in 10K) for
  // test isolation.
  return `birthday cake number ${Math.floor(Math.random() * 10000)}`;
}

export const truthAtUserLayerTests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────
  // Source-specific honesty: user asks "email about X", no email exists,
  // but a note about X does. Naavi must say "no email" before mentioning
  // the note. Must NOT lead with "Found it" or "Yes".
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'truth-at-user-layer.email-source-no-email-has-note',
    category: 'truth-at-user-layer',
    description: '2026-05-10 — when user asks about email but only a note exists, Naavi must explicitly say "no email" before mentioning the note',
    timeoutMs: 60_000,
    async run(ctx) {
      const tag = uniqueTag();
      // Insert a knowledge_fragment so the memory adapter has something to
      // surface. Use a unique tag so existing user data does not pollute
      // the assertion.
      const noteText = `Auto-tester is buying the ${tag} this year.`;
      const ingest = await adapters.ingestNote(ctx, noteText);
      expect2xx(ingest.status, 'ingest-note');
      // Brief wait for embedding.
      await new Promise((r) => setTimeout(r, 1500));

      // 2026-05-22 (Wael) — mirror the mobile orchestrator's pre-search
      // injection. Production never sends Claude a bare retrieval query;
      // it runs global_search FIRST, then appends a "## Live search
      // results" block to the user message so Claude has the data in
      // hand when it formulates the reply. Without this, the prompt's
      // "always search first" rule (line 907) tells Claude to emit
      // "Let me check..." + a global_search action instead of the
      // honest-out reply the test verifies. The test was structurally
      // broken — Option 3 from tonight's decision tree restores it to
      // match the production shape.
      //
      // The injected block uses the SAME format the orchestrator emits
      // (useOrchestrator.ts line ~1328): "## Live search results for
      // the user's question..." then "- [source] title — snippet".
      // Only the knowledge hit is included — that's exactly what global
      // search would return for this seeded scenario.
      const liveSearchBlock =
        `\n\n## Live search results for the user's question (these are authoritative — use them to answer; do NOT say "I couldn't find" if results are listed here)\n` +
        `- [knowledge] ${noteText}`;
      const userMessage = `Do I have email about ${tag}?${liveSearchBlock}`;
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: userMessage }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const speech = extractSpeech(data?.rawText ?? '');
      ctx.log(`speech: ${speech.slice(0, 300)}`);

      // Principle check 1: Naavi MUST explicitly negate "email" somewhere.
      // Acceptable phrasings — match liberally to avoid false negatives on
      // valid wording variants:
      //   "no email about ..."
      //   "no emails about ..."
      //   "you don't have any email ..."
      //   "you do not have an email ..."
      //   "I don't see any email ..."
      //   "I don't have an email ..."
      //   "there's no email ..."
      const NEGATE_EMAIL =
        /\b(?:no\s+emails?|don'?t\s+(?:have|see)\s+(?:any\s+|an\s+|the\s+)?emails?|do\s+not\s+(?:have|see)\s+(?:any\s+|an\s+|the\s+)?emails?|there'?s?\s+no\s+emails?|no\s+such\s+emails?)\b/i;
      expectMatch(
        speech,
        NEGATE_EMAIL,
        'speech must explicitly state no email exists (e.g. "no email about", "don\'t have an email")',
      );

      // Principle check 2: Naavi MUST NOT lead with "Found it" / "Yes" /
      // "I found" when the answer to the source question is no. Check the
      // first ~80 characters.
      const head = speech.slice(0, 80).toLowerCase();
      const leadsWithFoundIt = /\b(?:found it|i found|yes,?\s+(?:you\s+do|i\s+have|here'?s|there'?s))\b/i.test(head);
      expectTruthy(
        !leadsWithFoundIt,
        `speech MUST NOT lead with "Found it"/"Yes" when no email exists. Head: "${head}"`,
      );

      // Principle check 3 (stricter rule, Wael 2026-05-10): when ${userName}
      // names a source, Naavi answers ONLY about that source. Do NOT
      // mention notes, memory, drive, document, knowledge, etc. — those
      // are different sources and the user did not ask about them.
      const NON_EMAIL_SOURCE =
        /\b(?:notes?|memor(?:y|ies)|drive|documents?|files?|fragment|knowledge|calendar|meetings?|appointments?|contacts?|lists?)\b/i;
      const mentionsNonEmailSource = NON_EMAIL_SOURCE.test(speech);
      expectTruthy(
        !mentionsNonEmailSource,
        `speech MUST NOT mention non-email sources when ${''}${''}user asked about email. Got: "${speech.slice(0, 300)}"`,
      );
    },
  },
];
