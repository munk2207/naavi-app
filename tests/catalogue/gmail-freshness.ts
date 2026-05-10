/**
 * Gmail-adapter freshness tests — Wael 2026-05-10.
 *
 * Background: 2026-05-10 deep test surfaced a stale-cache bug. After
 * deleting an email from Gmail, Naavi still answered "yes, I have it"
 * because the cached row in `gmail_messages` was never reconciled with
 * Gmail's current state. Two-piece fix decided:
 *
 *   Option 1 — sync-gmail also DELETEs cache rows whose IDs no longer
 *              exist in Gmail (proactive, eventually consistent).
 *   Option 2 — gmail adapter verifies each cached hit against Gmail's
 *              messages.get API at query time and excludes 404s
 *              (reactive, real-time).
 *
 * This file covers Option 2's GRACEFUL-DEGRADATION path. Wael chose to
 * defer the strict-verify-success path to phone-side validation per
 * `feedback_user_test_is_ground_truth.md` — the test user
 * `mynaavi2207@gmail.com` does not have a working Google OAuth token,
 * which would make the strict path fail spuriously in CI.
 *
 * Locked-in behavior: when a user has no working Google refresh token
 * (refresh_token missing OR refresh fails), the gmail adapter MUST
 * still return cached rows. The freshness verify is best-effort, not
 * required. Without this fallback, a token-expiry blip would silently
 * make Naavi forget every email the user has.
 */

import { adapters, db } from '../lib/adapters';
import { expect2xx, expectTruthy } from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

function uniqueTag(): string {
  return `gmailfresh-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function insertTestEmail(
  ctx: TestContext,
  args: { subject: string; gmailMessageId: string },
): Promise<void> {
  await db.insert(ctx, 'gmail_messages', {
    user_id: ctx.testUserId,
    gmail_message_id: args.gmailMessageId,
    thread_id: args.gmailMessageId,
    subject: args.subject,
    sender_name: 'Auto Tester',
    sender_email: 'autotester@example.com',
    snippet: 'Freshness fallback test email.',
    body_text: 'Freshness fallback test email.',
    received_at: new Date().toISOString(),
    is_unread: false,
    is_important: false,
    is_tier1: true,
    signal_strength: 'personal',
    labels: [],
    updated_at: new Date().toISOString(),
  });
}

async function deleteTestEmail(ctx: TestContext, gmailMessageId: string): Promise<void> {
  await db.delete(
    ctx,
    'gmail_messages',
    `user_id=eq.${ctx.testUserId}&gmail_message_id=eq.${gmailMessageId}`,
  );
}

function gmailHitTitleMatches(rankedAny: unknown, subject: string): boolean {
  if (!Array.isArray(rankedAny)) return false;
  return rankedAny.some(
    (r: any) => r?.source === 'gmail' && typeof r?.title === 'string' && r.title.includes(subject),
  );
}

export const gmailFreshnessTests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────
  // Graceful degradation — when the test user has no working Google
  // refresh token, the gmail adapter MUST still return cached rows. This
  // protects users mid-OAuth-expiry from silently losing all email
  // recall.
  //
  // The fixture row uses a bogus gmail_message_id that doesn't resolve
  // to a real Gmail message. Pre-fix, the adapter doesn't verify and
  // returns the row → PASS. Post-fix, the adapter tries to verify but
  // either skips (no token) or catches the failure (revoked token) and
  // falls back to returning the cached row → PASS. A future refactor
  // that hard-fails on verify failure would FAIL this test.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'gmail-freshness.graceful-degradation-no-token',
    category: 'gmail-freshness',
    description: '2026-05-10 — gmail adapter returns cached rows when Google OAuth token is missing/expired (Option 2 fallback)',
    timeoutMs: 30_000,
    async run(ctx) {
      const tag = uniqueTag();
      const subject = `Freshness Fallback ${tag}`;
      const gmailMessageId = `bogus-${tag}`;
      await insertTestEmail(ctx, { subject, gmailMessageId });
      try {
        const { status, data } = await adapters.globalSearch(ctx, subject);
        expect2xx(status, 'global-search');
        const ranked = (data as any)?.ranked;
        ctx.log(`ranked count=${Array.isArray(ranked) ? ranked.length : 'n/a'}`);
        expectTruthy(
          gmailHitTitleMatches(ranked, subject),
          `expected ≥1 gmail hit with subject "${subject}" — graceful degradation must return cached rows when freshness verify cannot run`,
        );
      } finally {
        await deleteTestEmail(ctx, gmailMessageId);
      }
    },
  },
];
