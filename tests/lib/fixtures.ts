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

// V57.16 — multi-phone tests in the suite mutate user_settings.phone and
// user_settings.phone_numbers on the test user. They were calling
// clearTestUserPhones(ctx) → null in finally blocks, which nuked the real
// phone every suite run (Wael 2026-05-16). Snapshot the original values
// at suite start; restore them at suite end.
let originalPhoneSnapshot: { phone: string | null; phone_numbers: string[] | null } | null = null;

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
  // Snapshot phones BEFORE teardown so we capture the real value.
  await snapshotOriginalPhones(ctx);
  // Idempotent — we don't insert auth.users, the test user must exist.
  // We just make sure our tables don't have stale data from a prior run.
  await teardownSuite(ctx);
}

export async function teardownSuite(ctx: TestContext): Promise<void> {
  for (const table of OWNED_TABLES) {
    try {
      await db.delete(ctx, table, `user_id=eq.${ctx.testUserId}`);
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
