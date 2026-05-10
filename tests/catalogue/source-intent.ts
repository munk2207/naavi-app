/**
 * Source-intent filter tests — Wael 2026-05-10.
 *
 * Locks in `detectSourceIntent` behavior in `global-search`. When the
 * user names a specific source ("email about X", "meeting about X"),
 * only that adapter runs. Open-ended phrasings ("what do we know about
 * X") run all adapters.
 *
 * This filter is the server-side enforcement of the truth-at-user-layer
 * principle — non-named sources never reach Claude in the first place.
 *
 * Test mechanism: global-search's response includes a `groups` map
 * keyed by adapter name. Only adapters that actually ran appear as keys
 * (filtered-out adapters don't get an entry). Asserting on the keys is
 * equivalent to asserting on which adapters ran.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

function adapterNames(data: any): string[] {
  const groups = (data?.groups ?? {}) as Record<string, unknown>;
  return Object.keys(groups).sort();
}

export const sourceIntentTests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────
  // Email source intent — only gmail + email_actions run.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'source-intent.email-named-only-gmail-runs',
    category: 'source-intent',
    description: '2026-05-10 — query "email about X" runs only gmail + email_actions adapters',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.globalSearch(ctx, 'email about anything');
      expect2xx(status, 'global-search');
      const names = adapterNames(data);
      ctx.log(`adapters that ran: [${names.join(', ')}]`);
      expectTruthy(
        names.includes('gmail') && names.includes('email_actions'),
        `gmail + email_actions must run for email-named query (got: ${names.join(',')})`,
      );
      expectTruthy(
        !names.includes('knowledge') &&
        !names.includes('drive') &&
        !names.includes('calendar') &&
        !names.includes('contacts') &&
        !names.includes('lists'),
        `non-email adapters must NOT run for email-named query (got: ${names.join(',')})`,
      );
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Calendar source intent — only calendar adapter runs.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'source-intent.calendar-named-only-calendar-runs',
    category: 'source-intent',
    description: '2026-05-10 — query "meeting about X" runs only calendar adapter',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.globalSearch(ctx, 'meeting about anything');
      expect2xx(status, 'global-search');
      const names = adapterNames(data);
      ctx.log(`adapters that ran: [${names.join(', ')}]`);
      expectTruthy(
        names.includes('calendar'),
        `calendar must run for meeting-named query (got: ${names.join(',')})`,
      );
      expectTruthy(
        !names.includes('gmail') &&
        !names.includes('knowledge') &&
        !names.includes('drive') &&
        !names.includes('contacts'),
        `non-calendar adapters must NOT run for meeting-named query (got: ${names.join(',')})`,
      );
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Note / memory source intent — only knowledge adapter runs.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'source-intent.note-named-only-knowledge-runs',
    category: 'source-intent',
    description: '2026-05-10 — query "note about X" runs only knowledge adapter',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.globalSearch(ctx, 'note about anything');
      expect2xx(status, 'global-search');
      const names = adapterNames(data);
      ctx.log(`adapters that ran: [${names.join(', ')}]`);
      expectTruthy(
        names.includes('knowledge'),
        `knowledge must run for note-named query (got: ${names.join(',')})`,
      );
      expectTruthy(
        !names.includes('gmail') &&
        !names.includes('drive') &&
        !names.includes('calendar') &&
        !names.includes('contacts'),
        `non-knowledge adapters must NOT run for note-named query (got: ${names.join(',')})`,
      );
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Open-ended phrasings run all adapters. "What do we know" is the
  // canonical open-ended trigger; gmail / knowledge / drive / etc. all
  // run regardless of which source has the answer.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'source-intent.open-ended-runs-all-adapters',
    category: 'source-intent',
    description: '2026-05-10 — query "what do we know about X" runs all adapters (open-ended)',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.globalSearch(ctx, 'what do we know about anything');
      expect2xx(status, 'global-search');
      const names = adapterNames(data);
      ctx.log(`adapters that ran: [${names.join(', ')}]`);
      // Open-ended should fan out to multiple sources. The exact count
      // depends on which adapters consider themselves connected for the
      // test user, but at least gmail + knowledge + drive should run.
      expectTruthy(
        names.includes('gmail') && names.includes('knowledge') && names.includes('drive'),
        `open-ended query must run gmail + knowledge + drive (got: ${names.join(',')})`,
      );
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Open-ended phrasing wins over a source noun. *"What do we know about
  // my email"* contains the word "email" but is open-ended in intent —
  // all adapters should run, not just gmail. Guards against a future
  // refactor that drops the open-ended check before the source-noun
  // check.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'source-intent.open-ended-overrides-source-noun',
    category: 'source-intent',
    description: '2026-05-10 — open-ended phrasing overrides a source noun in the same query',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.globalSearch(ctx, 'what do we know about my email anyway');
      expect2xx(status, 'global-search');
      const names = adapterNames(data);
      ctx.log(`adapters that ran: [${names.join(', ')}]`);
      expectTruthy(
        names.includes('knowledge') && names.includes('drive'),
        `open-ended query containing "email" must STILL run all adapters, not just gmail (got: ${names.join(',')})`,
      );
    },
  },
];
