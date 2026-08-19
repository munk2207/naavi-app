/**
 * Fixtures — provision a dedicated test user once per suite run, and clean
 * up its rows when the suite finishes.
 *
 * Strategy: we don't create a fresh auth user every run (that involves email
 * confirmation, OAuth, etc.). Instead the test suite uses a STATIC test user
 * id that's been pre-created in Supabase. We only delete the rows it owns.
 *
 * To configure: set TEST_USER_ID in .env (or tests/.env) to a real user_id.
 * For local testing without a real user, set it to something like
 * '00000000-0000-0000-0000-000000000001' and accept that some Edge Functions
 * may reject because there's no auth.users row — but smoke + naavi-chat tests
 * still work because they don't write to RLS-protected tables.
 */

import { adapters, db } from './adapters';
import type { TestContext } from './types';

/** Tables to clear at suite teardown for the test user. */
const OWNED_TABLES = [
  'action_rules',
  // V57.10.3 — action_rule_log removed. The table is keyed by rule_id,
  // not user_id, so the user_id=eq.X delete pattern always returned a
  // 42703 "column action_rule_log.user_id does not exist" error in
  // every suite run (Wael 2026-05-01). Test-created action_rules are
  // virtual (no real geofence fires for the test user), so no
  // action_rule_log entries should accumulate. If a future test
  // pushes synthetic fires, add a per-rule cascade here.
  'reminders',
  'knowledge_fragments',
  'lists',
  'people',
  'sent_messages',
  'pending_disambig',
  'documents',
  'email_actions',
  'calendar_events',
];

/**
 * B10y root fix (2026-08-19) — per-table row scoping for teardown.
 *
 * `OWNED_TABLES` above is deleted with `user_id=eq.<test user>` and nothing
 * else. For tables whose rows are genuinely created by the suite, that's
 * correct. For `calendar_events` it was not: that table holds REAL rows
 * synced from the user's live Google Calendar, so the unscoped delete wiped
 * actual user data on every run — the B10y incident (2026-08-03), which
 * emptied robert.esm.2207@gmail.com's calendar and surfaced as the mobile
 * Brief truthfully reporting "your day is clear."
 *
 * The prior mitigations (a dedicated staging test account + the
 * PROTECTED_ACCOUNT_IDS hard guard below) stopped that ONE account from
 * being hit again. Neither fixed the delete itself — it would still wipe
 * real calendar data on whatever account the suite is pointed at. This is
 * the root fix.
 *
 * Scope is by title marker, matching the convention the calendar tests
 * already use ('Auto-tester …' / 'multiuser-safety-test', see
 * tests/catalogue/calendar.ts and the Google-side cleanup at the bottom of
 * teardownSuite). Rows the suite did not create are now left alone.
 *
 * This preserves the original intent of
 * `session-2026-05-29.calendar-events-in-owned-tables` — "teardown clears
 * DB rows each run, without which stale rows accumulate indefinitely" —
 * which was always about SUITE-CREATED rows. Intent and implementation had
 * diverged; this reconciles them.
 *
 * NOT fixed here, deliberately (minimal-change; each needs its own
 * analysis): `documents`, `email_actions`, `knowledge_fragments`, and
 * `sent_messages` are also deleted unscoped and can likewise hold real data
 * on a Gmail/Drive-connected account. Tracked as a follow-up to B10y.
 */
 * Markers must cover EVERY title convention the suite creates, or those rows
 * stop being cleaned and accumulate — the exact failure
 * `session-2026-05-29.calendar-events-in-owned-tables` guards against. Three
 * conventions are in use and all three are listed below; a first pass covering
 * only 'Auto-tester*' left 'AutoTest …' rows behind (observed live on the
 * production test account 2026-08-19). If a new test creates calendar events
 * under a new title prefix, add it here in the same commit.
 */
const TEARDOWN_ROW_SCOPE: Record<string, string> = {
  calendar_events:
    'or=(title.like.Auto-tester*,title.like.AutoTest*,title.like.multiuser-safety-test*)',
};

// V57.16 — multi-phone tests in the suite mutate user_settings.phone and
// user_settings.phone_numbers on the test user. They were calling
// clearTestUserPhones(ctx) → null in finally blocks, which nuked the real
// phone every suite run (Wael 2026-05-16). Snapshot the original values
// at suite start; restore them at suite end.
let originalPhoneSnapshot: { phone: string | null; phone_numbers: string[] | null } | null = null;

/**
 * Accounts the auto-tester must NEVER write to or delete from, regardless
 * of which env var (TEST_USER_ID, STAGING_TEST_USER_ID, or any future
 * alias) happens to resolve to them. Hard-coded on purpose, not an env
 * toggle: B10y (2026-08-03) wiped Robert's real calendar_events because a
 * config value pointed the suite at his live demo/testing account
 * (f1bc46b8-a478-43ad-bf09-e138099c8847, robert.esm.2207@gmail.com) — an
 * env var is too easy to change by accident or by a future session
 * "helpfully" reusing an ID. This list requires an actual code change
 * (visible in git history, subject to review) to ever be lifted. If
 * there's ever a real reason to run tests against one of these accounts,
 * get Wael's explicit pre-authorization first, then edit this list in its
 * own dedicated commit — never work around it with an env var.
 */
const PROTECTED_ACCOUNT_IDS: Record<string, string> = {
  'f1bc46b8-a478-43ad-bf09-e138099c8847':
    'robert.esm.2207@gmail.com — live manual demo/testing account, never auto-tester-owned (B10y incident 2026-08-03)',
};

function assertNotProtectedAccount(ctx: TestContext): void {
  const reason = PROTECTED_ACCOUNT_IDS[ctx.testUserId];
  if (reason) {
    throw new Error(
      `[fixtures] REFUSING to run against protected account ${ctx.testUserId} (${reason}). ` +
      `This account is hard-blocked in tests/lib/fixtures.ts — TEST_USER_ID (or any other env var) ` +
      `must not resolve to it. If there's a real reason to test against it, get Wael's explicit ` +
      `pre-authorization first, then edit PROTECTED_ACCOUNT_IDS in its own dedicated commit.`
    );
  }
}

async function snapshotOriginalPhones(ctx: TestContext): Promise<void> {
  try {
    const url = `${ctx.supabaseUrl}/rest/v1/user_settings?user_id=eq.${ctx.testUserId}&select=phone,phone_numbers`;
    const res = await fetch(url, {
      headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` },
    });
    const rows = (await res.json()) as Array<{ phone: string | null; phone_numbers: string[] | null }>;
    originalPhoneSnapshot = rows[0] ?? { phone: null, phone_numbers: null };
    ctx.log(`[fixtures] snapshot test-user phones: phone=${originalPhoneSnapshot.phone} numbers=${JSON.stringify(originalPhoneSnapshot.phone_numbers)}`);
  } catch (err) {
    ctx.log(`[fixtures] snapshot failed: ${(err as Error).message}`);
  }
}

async function restoreOriginalPhones(ctx: TestContext): Promise<void> {
  if (!originalPhoneSnapshot) return;
  try {
    const url = `${ctx.supabaseUrl}/rest/v1/user_settings?user_id=eq.${ctx.testUserId}`;
    await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: ctx.serviceRoleKey,
        Authorization: `Bearer ${ctx.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone:         originalPhoneSnapshot.phone,
        phone_numbers: originalPhoneSnapshot.phone_numbers,
      }),
    });
    ctx.log(`[fixtures] restored test-user phones to original: phone=${originalPhoneSnapshot.phone}`);
  } catch (err) {
    ctx.log(`[fixtures] restore phones failed: ${(err as Error).message}`);
  }
}

export async function setupSuite(ctx: TestContext): Promise<void> {
  assertNotProtectedAccount(ctx);
  // Snapshot phones BEFORE teardown so we capture the real value.
  await snapshotOriginalPhones(ctx);
  // Idempotent — we don't insert auth.users, the test user must exist.
  // We just make sure our tables don't have stale data from a prior run.
  await teardownSuite(ctx);
}

export async function teardownSuite(ctx: TestContext): Promise<void> {
  assertNotProtectedAccount(ctx);
  for (const table of OWNED_TABLES) {
    try {
      // B10y — tables listed in TEARDOWN_ROW_SCOPE get an additional filter
      // so only suite-created rows are deleted. Everything else keeps the
      // original user-scoped delete.
      const rowScope = TEARDOWN_ROW_SCOPE[table];
      const filter = rowScope
        ? `user_id=eq.${ctx.testUserId}&${rowScope}`
        : `user_id=eq.${ctx.testUserId}`;
      if (rowScope) {
        ctx.log(`[fixtures] teardown(${table}) scoped to suite-created rows: ${rowScope}`);
      }
      await db.delete(ctx, table, filter);
    } catch (err) {
      // Some tables may not have user_id, or may not exist in this env.
      // Log and continue — best-effort cleanup.
      ctx.log(`[fixtures] teardown(${table}) skipped: ${(err as Error).message}`);
    }
  }

  // V57.16 — restore the test user's phone+phone_numbers if multi-phone
  // tests nuked them via clearTestUserPhones(). Snapshot taken in setupSuite.
  await restoreOriginalPhones(ctx);

  // V57.16 — clean up Google Calendar events created by the calendar +
  // multiuser tests. Without this, every suite run leaves events behind on
  // the test user's calendar (Wael flagged 2026-05-15 that mynaavi2207's
  // calendar was flooded).
  const calendarQueries = [
    'Auto-tester sample event',
    'multiuser-safety-test',
  ];
  for (const query of calendarQueries) {
    try {
      const { status, data } = await adapters.deleteCalendarEvent(ctx, query);
      const deleted = data?.deleted ?? 0;
      if (deleted > 0) {
        ctx.log(`[fixtures] cleaned ${deleted} calendar event(s) matching "${query}"`);
      }
      if (status >= 400) {
        ctx.log(`[fixtures] calendar cleanup status=${status} for "${query}": ${JSON.stringify(data).slice(0, 120)}`);
      }
    } catch (err) {
      ctx.log(`[fixtures] calendar cleanup for "${query}" failed: ${(err as Error).message}`);
    }
  }
}
