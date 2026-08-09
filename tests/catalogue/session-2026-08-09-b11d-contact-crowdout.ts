/**
 * B11d regression test — a contacts match must never be silently dropped
 * from `global-search`'s top-8 `ranked` list just because other sources
 * (calendar/rules/email_actions) fill all 8 slots first (Wael 2026-08-09).
 *
 * Root cause (live-confirmed): every consumer of `ranked` (mobile
 * pre-search, mobile GLOBAL_SEARCH action, voice server) independently
 * truncates it to a small top-N (8). Contacts results carry no `createdAt`,
 * so `mergeAndRank`'s recency tie-break always sorts them last among
 * same-score hits from dated sources. Live repro: "Tell me about James"
 * against a real contact (James Okafor, real birthday year 1990 on file)
 * returned 6 calendar + 1 rules + 1 email_actions hits — exactly 8 — and
 * zero contacts, even though `lookup-contact` called directly proved the
 * real year was fetched correctly. The bug was never in date parsing; it
 * was the merged list silently dropping the one source with the answer.
 *
 * Fix: `global-search/index.ts`'s new `ensureContactSurvives()` runs after
 * `mergeAndRank` and promotes the best contacts hit into position 8 if it
 * would otherwise fall outside any consumer's top-8 slice — order only, no
 * change to result count, so it's a single fix point for all three
 * consumers instead of three separate client-side patches that could drift
 * out of sync (same class of risk this project's architecture doc warns
 * about for naavi-chat's two action-generation systems).
 *
 * ── Coverage gap acknowledged (Rule 15a exception path) ────────────────────
 * There's no Edge Function to create-and-delete a throwaway Google Contact
 * (`create-contact` exists but has no counterpart `delete-contact`), so this
 * test can't manufacture its own guaranteed-reproducible crowd-out scenario
 * without leaving permanent junk in the test account's real Google Contacts.
 * Instead it samples a few queries and asserts the invariant — "if the
 * contacts adapter found any match, that match must survive into the top-8
 * ranked list" — against whichever contacts the test account's live Google
 * data actually has. If none of the sampled queries produce a contacts hit
 * at all, the test skips cleanly rather than asserting nothing. Same
 * pattern as `session-2026-07-22-b10r-contact-birthdays.ts`.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectTruthy, TestSkippedError } from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const b11dContactCrowdoutTests: TestCase[] = [
  {
    id: 'b11d.contacts-hit-survives-top8-truncation',
    category: 'b11d-contact-crowdout',
    description: '2026-08-09 — a contacts match found by global-search is never silently dropped from the top-8 ranked list by other sources filling all 8 slots first',
    timeoutMs: 30_000,
    async run(ctx) {
      // "James" is the live-confirmed repro. "a"/"e" are broad fallbacks in
      // case this test account's "James" contact/calendar data has changed.
      const queries = ['James', 'a', 'e'];
      let asserted = false;
      for (const q of queries) {
        const { status, data } = await adapters.globalSearch(ctx, q);
        expect2xx(status, `global-search "${q}"`);
        const groups = (data as any)?.groups ?? {};
        const ranked = (data as any)?.ranked;
        const contactsGroupCount = Array.isArray(groups.contacts?.results) ? groups.contacts.results.length : 0;
        ctx.log(`query="${q}" contactsGroupCount=${contactsGroupCount}`);
        if (contactsGroupCount === 0) continue; // no contacts match for this query — try the next one

        const top8 = Array.isArray(ranked) ? ranked.slice(0, 8) : [];
        const contactsInTop8 = top8.some((r: any) => r?.source === 'contacts');
        ctx.log(`query="${q}" top8Sources=${JSON.stringify(top8.map((r: any) => r.source))}`);
        expectTruthy(
          contactsInTop8,
          `query "${q}": contacts adapter found ${contactsGroupCount} match(es) but none survived into the top-8 ranked list (B11d regression)`,
        );
        asserted = true;
      }
      if (!asserted) {
        throw new TestSkippedError(
          'None of the sampled queries ("James", "a", "e") produced any contacts match on this test account — cannot verify the crowd-out fix this run. Coverage gap: see file header.',
        );
      }
    },
  },
];
