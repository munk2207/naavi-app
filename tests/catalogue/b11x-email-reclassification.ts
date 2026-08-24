/**
 * B11x — redundant email classification
 *
 * Guards the fix for: sync-gmail fired extract-email-actions on
 * `if (!error && !isMarketing)` (sync-gmail:362), and `!error` is true for an
 * UPDATE exactly as for an INSERT, so every email in the rolling 7-day window
 * was re-sent to Claude on every hourly tick — up to 168 times per email where
 * the intended number is 1. Measured 2026-08-24: ~1.21M Haiku input tokens per
 * hour, flat around the clock, on a two-user account.
 *
 * The fix guards the classifier rather than the caller: extract-email-actions
 * records every terminal outcome — including a SENTINEL row (action_type NULL)
 * for emails the keyword pre-filter rejects, which previously wrote nothing at
 * all — and skips any message that already has a row.
 *
 * Coverage, per the Phase 2 plan §9a and ChatGPT's Phase 3 review:
 *   1. Second call for the same key is skipped, no Claude call
 *   2. Pre-filtered email writes a sentinel with all content fields NULL
 *   3. Second call on a pre-filtered email is skipped by its sentinel
 *   4. force:true re-runs a message that already has a row
 *   5. force:true bypasses the guard ONLY — pre-filter still runs, sentinel still written
 *   6. An errored classification writes no row, so it stays retryable
 *   7. Sentinel rows are invisible to global-search's email_actions adapter
 *
 * Test 5 is the one that matters most for future safety: if `force` ever
 * silently widens beyond the existence guard, that is the test that fails.
 *
 * Coverage gaps acknowledged:
 *   - Test 6 asserts the ABSENCE of a row for a message whose classification
 *     cannot run (no gmail_messages row → the function throws before any write).
 *     That proves the error path writes nothing, which is the property Success
 *     Criterion 3 depends on. It does NOT simulate an Anthropic API failure
 *     mid-call; doing so would require injecting a bad ANTHROPIC_API_KEY into a
 *     deployed function, which the harness cannot do.
 *   - No test asserts the actual reduction in Claude call volume — that is only
 *     observable in the Anthropic Console, and is Phase 5 evidence, not a
 *     regression test.
 *
 * Run via `npm run test:auto`.
 */

import { expect2xx } from '../lib/assertions';
import { db } from '../lib/adapters';
import type { TestCase, TestContext } from '../lib/types';

/** Distinct prefix so fixtures can never collide with real mail. */
const FIXTURE_PREFIX = 'b11x-test-';

/** Contains no ACTIONABLE_KEYWORDS — must take the pre-filter path. */
const INERT_SUBJECT = 'Photos from the weekend';
const INERT_BODY = 'Here are the pictures we talked about. Hope you like them.';

/** Contains 'invoice' and 'due' — must reach the classifier. */
const ACTIONABLE_SUBJECT = 'Your invoice is ready';
const ACTIONABLE_BODY =
  'Your invoice for August is attached. Payment is due on the 15th. Amount: $42.00.';

async function seedMessage(
  ctx: TestContext,
  id: string,
  subject: string,
  bodyText: string,
): Promise<void> {
  await db.insert(ctx, 'gmail_messages', {
    user_id: ctx.testUserId,
    gmail_message_id: id,
    thread_id: id,
    subject,
    sender_name: 'B11x Fixture',
    sender_email: 'fixture@example.com',
    snippet: bodyText.slice(0, 80),
    body_text: bodyText,
    received_at: new Date().toISOString(),
    is_tier1: true,
  });
}

async function callExtract(
  ctx: TestContext,
  id: string,
  force = false,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${ctx.supabaseUrl}/functions/v1/extract-email-actions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ctx.serviceRoleKey}`,
    },
    body: JSON.stringify({ gmail_message_id: id, user_id: ctx.testUserId, force }),
  });
  return { status: res.status, body: await res.json() };
}

async function actionRows(ctx: TestContext, id: string): Promise<any[]> {
  return db.select(
    ctx,
    'email_actions',
    `user_id=eq.${ctx.testUserId}&gmail_message_id=eq.${encodeURIComponent(id)}&select=*`,
  );
}

/** Remove both fixture tables for one message id. Safe to call when absent. */
async function cleanup(ctx: TestContext, id: string): Promise<void> {
  const q = `user_id=eq.${ctx.testUserId}&gmail_message_id=eq.${encodeURIComponent(id)}`;
  await db.delete(ctx, 'email_actions', q).catch(() => {});
  await db.delete(ctx, 'gmail_messages', q).catch(() => {});
}

export const b11xEmailReclassificationTests: TestCase[] = [
  // ── Test 1 + 3: the second call is skipped, for both outcome shapes ─────────
  {
    id: 'b11x.second-call-is-skipped',
    category: 'email',
    description:
      'A second extract-email-actions call for the same (user_id, gmail_message_id) ' +
      'must return reason="already_classified" and make no Claude call — for an ' +
      'actionable email AND for a pre-filtered one. Guards B11x directly.',
    timeoutMs: 60_000,
    async setup(ctx) {
      await cleanup(ctx, `${FIXTURE_PREFIX}dedup-actionable`);
      await cleanup(ctx, `${FIXTURE_PREFIX}dedup-inert`);
      await seedMessage(ctx, `${FIXTURE_PREFIX}dedup-actionable`, ACTIONABLE_SUBJECT, ACTIONABLE_BODY);
      await seedMessage(ctx, `${FIXTURE_PREFIX}dedup-inert`, INERT_SUBJECT, INERT_BODY);
    },
    async run(ctx) {
      for (const [label, id] of [
        ['actionable (reaches Claude)', `${FIXTURE_PREFIX}dedup-actionable`],
        ['pre-filtered (sentinel path)', `${FIXTURE_PREFIX}dedup-inert`],
      ] as const) {
        const first = await callExtract(ctx, id);
        expect2xx(first.status, `first call — ${label}`);
        ctx.log(`${label} first call → reason=${first.body?.reason ?? 'none'}`);

        if (first.body?.reason === 'already_classified') {
          throw new Error(`${label}: first call was skipped — fixture was not clean`);
        }

        const second = await callExtract(ctx, id);
        expect2xx(second.status, `second call — ${label}`);
        ctx.log(`${label} second call → reason=${second.body?.reason ?? 'none'}`);

        if (second.body?.reason !== 'already_classified') {
          throw new Error(
            `${label}: second call returned reason="${second.body?.reason}" — expected ` +
            `"already_classified". B11x has regressed: this message was sent to Claude twice.`,
          );
        }
      }
    },
    async teardown(ctx) {
      await cleanup(ctx, `${FIXTURE_PREFIX}dedup-actionable`);
      await cleanup(ctx, `${FIXTURE_PREFIX}dedup-inert`);
    },
  },

  // ── Test 2: the sentinel row's shape ───────────────────────────────────────
  {
    id: 'b11x.prefilter-writes-null-sentinel',
    category: 'email',
    description:
      'An email rejected by the keyword pre-filter must write a sentinel email_actions ' +
      'row with action_type NULL and every content field NULL. Locks Wael\'s Phase 2 ' +
      'decision that no system string goes in a user-content column.',
    timeoutMs: 45_000,
    async setup(ctx) {
      await cleanup(ctx, `${FIXTURE_PREFIX}sentinel`);
      await seedMessage(ctx, `${FIXTURE_PREFIX}sentinel`, INERT_SUBJECT, INERT_BODY);
    },
    async run(ctx) {
      const res = await callExtract(ctx, `${FIXTURE_PREFIX}sentinel`);
      expect2xx(res.status, 'extract on inert email');

      if (res.body?.reason !== 'pre_filter_no_keywords') {
        throw new Error(
          `Expected the pre-filter path, got reason="${res.body?.reason}". The fixture ` +
          `subject/body may now contain an ACTIONABLE_KEYWORD.`,
        );
      }

      const rows = await actionRows(ctx, `${FIXTURE_PREFIX}sentinel`);
      if (rows.length !== 1) {
        throw new Error(
          `Expected exactly 1 sentinel row, found ${rows.length}. Without it the guard ` +
          `cannot tell "never processed" from "processed, found nothing" — which is the ` +
          `70-80% case B11x exists to cover.`,
        );
      }

      const row = rows[0];
      if (row.action_type !== null) {
        throw new Error(`Sentinel action_type must be NULL, got "${row.action_type}"`);
      }

      for (const field of ['title', 'vendor', 'summary', 'reference', 'due_date', 'amount_cents']) {
        if (row[field] !== null && row[field] !== undefined) {
          throw new Error(
            `Sentinel ${field} must be NULL, got "${row[field]}". get-naavi-prompt ` +
            `instructs Naavi never to read these columns aloud — a system string here ` +
            `could reach a caller's ear.`,
          );
        }
      }
      ctx.log('sentinel row shape verified: action_type and all content fields NULL');
    },
    async teardown(ctx) {
      await cleanup(ctx, `${FIXTURE_PREFIX}sentinel`);
    },
  },

  // ── Test 4 + 5: force bypasses the guard, and ONLY the guard ───────────────
  {
    id: 'b11x.force-bypasses-guard-only',
    category: 'email',
    description:
      'force:true must re-run a message that already has a row, AND must not disable ' +
      'anything else — a pre-filtered email under force must still take the pre-filter ' +
      'path and still write its sentinel. This is the test that fails if `force` ever ' +
      'silently widens beyond the existence guard.',
    timeoutMs: 60_000,
    async setup(ctx) {
      await cleanup(ctx, `${FIXTURE_PREFIX}force`);
      await seedMessage(ctx, `${FIXTURE_PREFIX}force`, INERT_SUBJECT, INERT_BODY);
    },
    async run(ctx) {
      const id = `${FIXTURE_PREFIX}force`;

      const first = await callExtract(ctx, id);
      expect2xx(first.status, 'first call');
      if (first.body?.reason !== 'pre_filter_no_keywords') {
        throw new Error(`Expected pre-filter path, got "${first.body?.reason}"`);
      }

      // Without force, the sentinel now blocks it.
      const blocked = await callExtract(ctx, id, false);
      if (blocked.body?.reason !== 'already_classified') {
        throw new Error(
          `Without force, expected "already_classified", got "${blocked.body?.reason}"`,
        );
      }

      // With force, the guard is bypassed — and the pre-filter must STILL run.
      const forced = await callExtract(ctx, id, true);
      expect2xx(forced.status, 'forced call');
      ctx.log(`forced call → reason=${forced.body?.reason ?? 'none'}`);

      if (forced.body?.reason === 'already_classified') {
        throw new Error(
          'force:true did not bypass the existence guard — administrative ' +
          'reclassification (the approved procedure for a widened ACTIONABLE_KEYWORDS ' +
          'list) is broken.',
        );
      }
      if (forced.body?.reason !== 'pre_filter_no_keywords') {
        throw new Error(
          `force:true reached the classifier for an inert email (reason=` +
          `"${forced.body?.reason}"). force must bypass the existence guard ONLY — ` +
          `the keyword pre-filter must still run, or forced backfills will pay for ` +
          `Claude calls on every non-actionable email.`,
        );
      }

      const rows = await actionRows(ctx, id);
      if (rows.length !== 1 || rows[0].action_type !== null) {
        throw new Error(
          `After a forced re-run the sentinel must still be present and still NULL; ` +
          `found ${rows.length} row(s), action_type="${rows[0]?.action_type}".`,
        );
      }
      ctx.log('force bypassed the existence guard only — pre-filter ran, sentinel intact');
    },
    async teardown(ctx) {
      await cleanup(ctx, `${FIXTURE_PREFIX}force`);
    },
  },

  // ── Test 6b: the not_actionable path also writes a sentinel ────────────────
  {
    id: 'b11x.not-actionable-writes-sentinel',
    category: 'email',
    description:
      'An email that CLEARS the keyword pre-filter but which Claude judges ' +
      'non-actionable must also write a sentinel. This branch was missing from the ' +
      'Phase 2 outcome table and is the expensive one: the Claude call was already ' +
      'paid for, so without a row it would be re-sent every tick forever.',
    timeoutMs: 60_000,
    async setup(ctx) {
      await cleanup(ctx, `${FIXTURE_PREFIX}not-actionable`);
      // Contains 'confirm' (an ACTIONABLE_KEYWORD, so the pre-filter passes it
      // through) but carries no actual action for Claude to extract.
      await seedMessage(
        ctx,
        `${FIXTURE_PREFIX}not-actionable`,
        'Thanks for signing up',
        'Please confirm you received this welcome note. Nothing is required from you. ' +
        'There is no payment, no appointment and no deadline of any kind.',
      );
    },
    async run(ctx) {
      const id = `${FIXTURE_PREFIX}not-actionable`;
      const first = await callExtract(ctx, id);
      expect2xx(first.status, 'first call');
      ctx.log(`first call → reason=${first.body?.reason ?? 'none'}`);

      if (first.body?.reason === 'pre_filter_no_keywords') {
        throw new Error(
          'Fixture was rejected by the pre-filter, so this test did not exercise the ' +
          'not_actionable branch. The fixture body must contain an ACTIONABLE_KEYWORD.',
        );
      }
      if (first.body?.reason === 'parse_failed') {
        throw new Error('Claude response failed to parse — rerun; this is transient.');
      }

      // Whether Claude says actionable or not, a row must now exist — that is the
      // property the guard depends on.
      const rows = await actionRows(ctx, id);
      if (rows.length !== 1) {
        throw new Error(
          `After a completed Claude classification (reason="${first.body?.reason}") there ` +
          `must be exactly 1 email_actions row; found ${rows.length}. Without it this ` +
          `email is re-sent to Claude on every sync, forever — the exact defect B11x fixes, ` +
          `surviving in the one branch that already paid for a Claude call.`,
        );
      }

      const second = await callExtract(ctx, id);
      if (second.body?.reason !== 'already_classified') {
        throw new Error(
          `Second call returned "${second.body?.reason}" — expected "already_classified".`,
        );
      }
      ctx.log(`completed classification recorded and second call skipped`);
    },
    async teardown(ctx) {
      await cleanup(ctx, `${FIXTURE_PREFIX}not-actionable`);
    },
  },

  // ── Test 6: the error path writes nothing, so it stays retryable ───────────
  {
    id: 'b11x.error-path-writes-no-row',
    category: 'email',
    description:
      'A classification that cannot complete must write NO email_actions row, so the ' +
      'message is retried on the next sync. Guards Success Criterion 3 — the reason ' +
      'fire-on-insert in sync-gmail was rejected as the mechanism.',
    timeoutMs: 30_000,
    async setup(ctx) {
      await cleanup(ctx, `${FIXTURE_PREFIX}error`);
      // Deliberately NO gmail_messages row — the function throws at its fetch step,
      // which is the earliest possible failure and the cleanest available proxy for
      // "classification did not complete".
    },
    async run(ctx) {
      const id = `${FIXTURE_PREFIX}error`;
      const res = await callExtract(ctx, id);
      ctx.log(`missing-message call → status=${res.status} body=${JSON.stringify(res.body).slice(0, 160)}`);

      const rows = await actionRows(ctx, id);
      if (rows.length !== 0) {
        throw new Error(
          `A failed classification wrote ${rows.length} row(s). It must write none: a ` +
          `row here would permanently suppress retry, and the email would never be ` +
          `classified at all — silently, with no user-visible symptom until a bill is ` +
          `missed.`,
        );
      }
      ctx.log('error path wrote no row — message remains retryable');
    },
    async teardown(ctx) {
      await cleanup(ctx, `${FIXTURE_PREFIX}error`);
    },
  },

  // ── Test 7: sentinels stay out of Global Search ────────────────────────────
  {
    id: 'b11x.sentinel-invisible-to-global-search',
    category: 'email',
    description:
      'A sentinel row must not surface in global-search. Its adapter matches with ' +
      'ILIKE on title/vendor/summary/reference — all NULL on a sentinel — so it should ' +
      'be structurally unreachable. Guards the Phase 2 regression claim.',
    timeoutMs: 45_000,
    async setup(ctx) {
      await cleanup(ctx, `${FIXTURE_PREFIX}search`);
      await seedMessage(ctx, `${FIXTURE_PREFIX}search`, INERT_SUBJECT, INERT_BODY);
    },
    async run(ctx) {
      const id = `${FIXTURE_PREFIX}search`;
      const res = await callExtract(ctx, id);
      expect2xx(res.status, 'extract on inert email');

      const rows = await actionRows(ctx, id);
      if (rows.length !== 1) {
        throw new Error(`Expected a sentinel row to search against, found ${rows.length}`);
      }

      const search = await fetch(`${ctx.supabaseUrl}/functions/v1/global-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.serviceRoleKey}`,
        },
        body: JSON.stringify({ query: 'weekend photos', user_id: ctx.testUserId }),
      });
      expect2xx(search.status, 'global-search');
      const data = await search.json();

      const hits = JSON.stringify(data?.results ?? data ?? {});
      if (hits.includes(id)) {
        throw new Error(
          `Sentinel row ${id} surfaced in global-search results. Sentinels represent ` +
          `"nothing worth surfacing" — showing them to the user is a visible regression.`,
        );
      }
      ctx.log('sentinel row absent from global-search results, as expected');
    },
    async teardown(ctx) {
      await cleanup(ctx, `${FIXTURE_PREFIX}search`);
    },
  },
];
