/**
 * Session 2026-08-19 — B10y root fix: scope the auto-tester's own teardown so it
 * deletes only suite-created `calendar_events` rows.
 *
 * The bug (found live 2026-08-03, during Ticket B Phase 7 testing):
 * `teardownSuite()` deleted every row in each `OWNED_TABLES` table with
 * `user_id=eq.<test user>` and no further scoping. For `calendar_events` that is
 * wrong — the table holds REAL rows synced from the user's live Google Calendar,
 * not suite-created ones. Every run wiped the account's actual calendar. It
 * surfaced as the mobile Brief truthfully reporting "your day is clear" minutes
 * after a test run, on robert.esm.2207@gmail.com.
 *
 * Two prior mitigations shipped, neither of which fixed the delete:
 *   1. (2026-08-03) staging runs repointed to a dedicated account.
 *   2. (2026-08-04) PROTECTED_ACCOUNT_IDS hard guard in fixtures.ts + runner.ts.
 * Both protect ONE account by name. The unscoped delete would still wipe real
 * calendar data on whatever account the suite was pointed at. This is the root fix.
 *
 * The fix: `TEARDOWN_ROW_SCOPE` in `tests/lib/fixtures.ts` adds a per-table row
 * filter, applied on top of the user filter. `calendar_events` is scoped to the
 * title markers the calendar tests already use ('Auto-tester …',
 * 'multiuser-safety-test') — the same convention the Google-side cleanup at the
 * bottom of `teardownSuite` matches on.
 *
 * Relationship to `session-2026-05-29.calendar-events-in-owned-tables`: that test
 * asserts `calendar_events` stays in OWNED_TABLES so stale rows don't accumulate.
 * It still passes and is still correct — its intent was always suite-created rows.
 * The two tests are complementary: that one says "clean it up," this one says
 * "clean up only what you made."
 *
 * Coverage gaps acknowledged (Rule 15a exception path):
 *   These are static source assertions, not live-DB behavior tests. Executing the
 *   real teardown against a live account to prove real rows survive would require
 *   seeding a non-suite calendar row on a connected account and running a full
 *   suite cycle against it — which is precisely the destructive operation this fix
 *   exists to prevent, and cannot be done safely on the protected account. The
 *   behavioral verification is instead: run `npm run test:auto` against staging and
 *   confirm the pre-existing `calendar_events` row count for the test user is
 *   unchanged. Recorded as a manual verification step, surfaced to Wael.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const FIXTURES_PATH = join(process.cwd(), 'tests', 'lib', 'fixtures.ts');

export const session2026_08_19_b10yTeardownScopeTests: TestCase[] = [
  {
    id: 'session-2026-08-19.b10y-calendar-events-teardown-is-scoped',
    category: 'session-2026-08-19-b10y',
    description:
      'B10y root fix: fixtures.ts must scope the calendar_events teardown delete to ' +
      'suite-created rows via TEARDOWN_ROW_SCOPE. An unscoped user_id-only delete ' +
      'wipes real Google-synced calendar data on every run.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(FIXTURES_PATH, 'utf8');

      expectTruthy(
        src.includes('TEARDOWN_ROW_SCOPE'),
        'fixtures.ts must define TEARDOWN_ROW_SCOPE (B10y root fix)',
      );

      // The scope map must actually cover calendar_events — the table B10y wiped.
      const scopeBlock = src.slice(
        src.indexOf('const TEARDOWN_ROW_SCOPE'),
        src.indexOf('const TEARDOWN_ROW_SCOPE') + 400,
      );
      expectTruthy(
        scopeBlock.includes('calendar_events'),
        'TEARDOWN_ROW_SCOPE must include a calendar_events entry',
      );
      // All three title conventions the suite creates must be covered. Missing one
      // means those rows are never cleaned and accumulate indefinitely — the failure
      // session-2026-05-29.calendar-events-in-owned-tables exists to prevent.
      // Observed live 2026-08-19: an 'Auto-tester*'-only filter left 'AutoTest …'
      // rows behind on the production test account.
      for (const marker of ['Auto-tester', 'AutoTest', 'multiuser-safety-test']) {
        expectTruthy(
          scopeBlock.includes(marker),
          `calendar_events teardown scope must cover the "${marker}" title marker`,
        );
      }
    },
  },
  {
    id: 'session-2026-08-19.b10y-teardown-applies-the-row-scope',
    category: 'session-2026-08-19-b10y',
    description:
      'Defining TEARDOWN_ROW_SCOPE is not enough — teardownSuite must actually apply it ' +
      'to the delete filter. Guards against the map existing but being ignored, which ' +
      'would silently restore the original B10y behavior.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(FIXTURES_PATH, 'utf8');
      const teardownBlock = src.slice(src.indexOf('export async function teardownSuite'));

      expectTruthy(
        teardownBlock.includes('TEARDOWN_ROW_SCOPE['),
        'teardownSuite must look up TEARDOWN_ROW_SCOPE for each table',
      );
      // The composed filter must append the row scope to the user filter, not replace it —
      // dropping user_id would delete across ALL users (a far worse bug than B10y).
      expectTruthy(
        /user_id=eq\.\$\{ctx\.testUserId\}&\$\{rowScope\}/.test(teardownBlock),
        'the scoped delete filter must keep user_id=eq.<test user> AND append the row scope',
      );
    },
  },
  {
    id: 'session-2026-08-19.b10y-protected-account-guard-still-present',
    category: 'session-2026-08-19-b10y',
    description:
      'The 2026-08-04 PROTECTED_ACCOUNT_IDS hard guard must survive this fix. The root fix ' +
      'makes teardown safe in general; the guard still blocks the specific account B10y hit. ' +
      'Both layers stay.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(FIXTURES_PATH, 'utf8');
      expectTruthy(
        src.includes('PROTECTED_ACCOUNT_IDS'),
        'PROTECTED_ACCOUNT_IDS guard must not be removed by the B10y root fix',
      );
      expectTruthy(
        src.includes('f1bc46b8-a478-43ad-bf09-e138099c8847'),
        'robert.esm.2207 account must remain hard-blocked in PROTECTED_ACCOUNT_IDS',
      );
      expectTruthy(
        src.includes('assertNotProtectedAccount(ctx)'),
        'assertNotProtectedAccount must still be called in the teardown path',
      );
    },
  },
];
