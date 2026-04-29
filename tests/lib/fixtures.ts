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

import { db } from './adapters';
import type { TestContext } from './types';

/** Tables to clear at suite teardown for the test user. */
const OWNED_TABLES = [
  'action_rules',
  'action_rule_log',
  'reminders',
  'knowledge_fragments',
  'lists',
  'people',
  'sent_messages',
  'pending_disambig',
  'user_places',
  'documents',
  'email_actions',
];

export async function setupSuite(ctx: TestContext): Promise<void> {
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
}
