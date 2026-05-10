/**
 * Brief unread-emails tests — Wael 2026-05-10.
 *
 * The morning brief no longer surfaces "email items needing attention"
 * — Naavi cannot truthfully claim what does or doesn't need the user's
 * attention. Instead it reports a descriptive count + sender list of
 * unread emails. The user decides what needs attention.
 *
 * These tests verify the brief surface (assistant-fulfillment) returns
 * a well-formed unread description. They use the test user's actual
 * Gmail account via the Edge Function's existing OAuth path; if the
 * test user has no Google token (current state), the function returns
 * 0 unread and these tests assert the "0 unread" wording.
 *
 * Future: once the test user has a working Google token, expand to
 * assert real unread counts.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectMatch } from '../lib/assertions';
import type { TestCase } from '../lib/types';

async function callBrief(ctx: any) {
  return adapters.call(ctx, 'assistant-fulfillment', {
    intent: 'brief',
    user_id: ctx.testUserId,
  });
}

export const briefUnreadTests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────
  // Brief surfaces an unread count regardless of whether unread > 0.
  // The exact count depends on the test user's live Gmail (or 0 if no
  // token); we just assert the brief uses unread-language, not the old
  // "items needing attention" framing.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'brief-unread.uses-unread-language',
    category: 'brief-unread',
    description: '2026-05-10 — brief reports "X unread email(s)", never "items needing attention"',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await callBrief(ctx);
      expect2xx(status, 'assistant-fulfillment');
      const plain: string = data?.plainText ?? '';
      ctx.log(`brief: ${plain.slice(0, 300)}`);

      // POSITIVE — must contain "unread email" or "unread emails".
      expectMatch(plain, /\b\d+\s+unread\s+emails?\b/i, 'brief must contain "<N> unread email(s)"');

      // NEGATIVE — must not use the old judgment-claim framing.
      const FORBIDDEN = /\b(items?\s+needing\s+attention|needing\s+your\s+attention)\b/i;
      if (FORBIDDEN.test(plain)) {
        throw new Error(`brief still uses old judgment-claim framing: "${plain.slice(0, 300)}"`);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Brief includes the calendar / weather context as before — guard
  // against the email refactor accidentally removing other sections.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'brief-unread.calendar-section-still-present',
    category: 'brief-unread',
    description: '2026-05-10 — brief still mentions calendar (event count or "calendar is clear")',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await callBrief(ctx);
      expect2xx(status, 'assistant-fulfillment');
      const plain: string = data?.plainText ?? '';
      ctx.log(`brief: ${plain.slice(0, 300)}`);
      expectMatch(
        plain,
        /\b(?:event|events|calendar\s+is\s+clear)\b/i,
        'brief must mention events or "calendar is clear"',
      );
    },
  },
];
