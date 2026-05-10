/**
 * Brief filter tests — Wael 2026-05-10.
 *
 * Locks in the email-action freshness filter shipped 2026-05-10. The
 * old filter trusted urgency='today' / 'this_week' tags forever, so an
 * email extracted a year ago kept appearing in today's brief as if it
 * still needed attention. The new filter:
 *
 *   - Drop if explicit deadline is in the past.
 *   - Keep if explicit deadline is within next 7 days.
 *   - Keep urgency='today'/'this_week' items only if email arrived in
 *     last 7 days (urgency tag is fresh).
 *   - Drop otherwise.
 *
 * Same logic in two surfaces:
 *   - assistant-fulfillment (mobile spoken brief, this file tests it
 *     directly via body user_id per CLAUDE.md Rule 4).
 *   - naavi-voice-server (phone-call saved Drive brief, no auto-tester
 *     for the voice repo — covered by user retest).
 */

import { adapters, db } from '../lib/adapters';
import { expect2xx, expectTruthy } from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

interface InsertArgs {
  uniqueTag: string;
  urgency?: 'today' | 'this_week' | 'soon' | 'info';
  due_date?: string | null;
  created_at: string;
}

function uniqueTag(): string {
  return `brieffilter${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

async function insertEmailAction(
  ctx: TestContext,
  args: InsertArgs,
): Promise<void> {
  await db.insert(ctx, 'email_actions', {
    user_id: ctx.testUserId,
    gmail_message_id: `test-msgid-${args.uniqueTag}`,
    action_type: 'pay',
    title: `Test ${args.uniqueTag}`,
    vendor: `Vendor ${args.uniqueTag}`,
    summary: `Test summary ${args.uniqueTag}`,
    urgency: args.urgency ?? 'info',
    due_date: args.due_date ?? null,
    dismissed: false,
    created_at: args.created_at,
  });
}

async function deleteEmailAction(ctx: TestContext, tag: string): Promise<void> {
  await db.delete(
    ctx,
    'email_actions',
    `user_id=eq.${ctx.testUserId}&summary=like.*${tag}*`,
  );
}

async function callBrief(ctx: TestContext) {
  return adapters.call(ctx, 'assistant-fulfillment', {
    intent: 'brief',
    user_id: ctx.testUserId,
  });
}

function briefMentions(plainText: string, tag: string): boolean {
  return typeof plainText === 'string' && plainText.includes(tag);
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const briefFilterTests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────
  // Stale urgency tag — extracted 8 days ago — must NOT appear in
  // today's brief. This is the primary user-facing bug Wael surfaced
  // 2026-05-10 ("Power shutdown tonight at midnight" from a year ago
  // kept showing up).
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'brief-filter.stale-urgency-today-dropped',
    category: 'brief-filter',
    description: '2026-05-10 — email_action with urgency="today" but created 8 days ago is NOT in today\'s brief',
    timeoutMs: 30_000,
    async run(ctx) {
      const tag = uniqueTag();
      const eightDaysAgo = new Date(Date.now() - 8 * ONE_DAY_MS).toISOString();
      await insertEmailAction(ctx, {
        uniqueTag: tag,
        urgency: 'today',
        due_date: null,
        created_at: eightDaysAgo,
      });
      try {
        const { status, data } = await callBrief(ctx);
        expect2xx(status, 'assistant-fulfillment');
        const plain = data?.plainText ?? '';
        ctx.log(`brief: ${plain.slice(0, 300)}`);
        expectTruthy(
          !briefMentions(plain, tag),
          `stale urgency="today" item (8 days old) MUST NOT appear in today\'s brief. Got: "${plain.slice(0, 300)}"`,
        );
      } finally {
        await deleteEmailAction(ctx, tag);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Fresh urgency tag — extracted yesterday — MUST appear. Guard
  // against an over-aggressive filter that drops everything urgency-
  // tagged.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'brief-filter.fresh-urgency-today-kept',
    category: 'brief-filter',
    description: '2026-05-10 — email_action with urgency="today" created 1 day ago IS in today\'s brief',
    timeoutMs: 30_000,
    async run(ctx) {
      const tag = uniqueTag();
      const oneDayAgo = new Date(Date.now() - 1 * ONE_DAY_MS).toISOString();
      await insertEmailAction(ctx, {
        uniqueTag: tag,
        urgency: 'today',
        due_date: null,
        created_at: oneDayAgo,
      });
      try {
        const { status, data } = await callBrief(ctx);
        expect2xx(status, 'assistant-fulfillment');
        const plain = data?.plainText ?? '';
        ctx.log(`brief: ${plain.slice(0, 300)}`);
        expectTruthy(
          briefMentions(plain, tag),
          `fresh urgency="today" item (1 day old) MUST appear in today\'s brief. Got: "${plain.slice(0, 300)}"`,
        );
      } finally {
        await deleteEmailAction(ctx, tag);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Past deadline — must NOT appear regardless of urgency tag.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'brief-filter.past-deadline-dropped',
    category: 'brief-filter',
    description: '2026-05-10 — email_action with deadline in the past is NOT in today\'s brief',
    timeoutMs: 30_000,
    async run(ctx) {
      const tag = uniqueTag();
      const tenDaysAgo = new Date(Date.now() - 10 * ONE_DAY_MS).toISOString();
      const oneDayAgo = new Date(Date.now() - 1 * ONE_DAY_MS).toISOString();
      await insertEmailAction(ctx, {
        uniqueTag: tag,
        urgency: 'today',          // even with the freshest urgency
        due_date: tenDaysAgo,      // explicit past deadline takes precedence
        created_at: oneDayAgo,
      });
      try {
        const { status, data } = await callBrief(ctx);
        expect2xx(status, 'assistant-fulfillment');
        const plain = data?.plainText ?? '';
        ctx.log(`brief: ${plain.slice(0, 300)}`);
        expectTruthy(
          !briefMentions(plain, tag),
          `past-deadline item MUST NOT appear in today\'s brief. Got: "${plain.slice(0, 300)}"`,
        );
      } finally {
        await deleteEmailAction(ctx, tag);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Future deadline within 7 days — MUST appear.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'brief-filter.future-deadline-within-7d-kept',
    category: 'brief-filter',
    description: '2026-05-10 — email_action with deadline in next 7 days IS in today\'s brief',
    timeoutMs: 30_000,
    async run(ctx) {
      const tag = uniqueTag();
      const threeDaysAhead = new Date(Date.now() + 3 * ONE_DAY_MS).toISOString();
      const oneDayAgo = new Date(Date.now() - 1 * ONE_DAY_MS).toISOString();
      await insertEmailAction(ctx, {
        uniqueTag: tag,
        urgency: 'soon',
        due_date: threeDaysAhead,
        created_at: oneDayAgo,
      });
      try {
        const { status, data } = await callBrief(ctx);
        expect2xx(status, 'assistant-fulfillment');
        const plain = data?.plainText ?? '';
        ctx.log(`brief: ${plain.slice(0, 300)}`);
        expectTruthy(
          briefMentions(plain, tag),
          `future-deadline-in-7d item MUST appear in today\'s brief. Got: "${plain.slice(0, 300)}"`,
        );
      } finally {
        await deleteEmailAction(ctx, tag);
      }
    },
  },
];
