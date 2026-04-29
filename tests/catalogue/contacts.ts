/**
 * Contact lookup tests — multi-match shape + no-match fallback.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, TestSkippedError } from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const contactsTests: TestCase[] = [
  {
    id: 'contacts.no-match-returns-empty',
    category: 'contacts',
    description: 'lookup-contact for nonsense name returns no match without hanging',
    timeoutMs: 20_000,
    async run(ctx) {
      const { status, data, durationMs } = await adapters.lookupContact(ctx, 'Zzzzqqxx-NoSuchPerson');
      ctx.log(`duration=${durationMs}ms data=${JSON.stringify(data).slice(0, 200)}`);

      // Skip cleanly when the test user has no Google OAuth tokens stored
      // (lookup-contact needs People API access).
      const errMsg = String(data?.error ?? '');
      if (status === 401 || /token (refresh|expired|revoked|invalid)|invalid_grant|People API failed/i.test(errMsg)) {
        throw new TestSkippedError(
          `Google People API token missing for test user. Sign in to Google with mynaavi2207@gmail.com once to enable.`,
        );
      }
      expect2xx(status, 'lookup-contact');

      // Could be either { contact: null, contacts: [] } (Session 26 shape) or { contact: null }.
      const contacts = Array.isArray(data?.contacts) ? data.contacts : [];
      const single = data?.contact ?? null;
      if (single !== null && contacts.length === 0) {
        // Some responses still come through as a single null/empty — accept that.
      }
      if (contacts.length > 0 || (single && (single.email || single.phone))) {
        throw new Error(`expected no match for nonsense name, got ${JSON.stringify(data)}`);
      }
      // Sanity — the call should have finished in well under the 20s timeout.
      if (durationMs > 18_000) {
        throw new Error(`lookup-contact took ${durationMs}ms — too slow`);
      }
    },
  },
];
