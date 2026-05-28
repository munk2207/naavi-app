/**
 * Session 2026-05-28 — regression coverage for B6d, B6e, B4s, B4y Phase 2.
 *
 * B6d: Expanded numbered-list rule from choices-only (v98) to ALL lists (v99).
 * display field now uses 1./2./3. numbering, never bullet glyphs (•/-/*).
 * Fix: PROMPT_VERSION 2026-05-28-v99-all-lists-numbered in get-naavi-prompt.
 * Regression tests also in prompt-regression.ts (b6d-display-uses-numbers-*).
 *
 * B6e: "What is on my calendar this week?" reliably misrouted to LIST_READ /
 * LIST_RULES at the 111 KB assembled prompt (Haiku attention loss on long
 * context). Root cause confirmed 2026-05-26: three explicit prompt rules
 * instructing "calendar queries → read the Schedule section" were ignored.
 * Fix: server-side pre-Claude bypass in naavi-chat (commit bf906c4) —
 * isCalendarReadIntent() detects the query, fetchLiveCalendarEvents() answers
 * deterministically. Claude is never called → impossible to misroute.
 * Deployed as part of B4y Phase 2 naavi-chat deploy (commit 494baeb).
 *
 * B4y Phase 2: Universal RULE 23 confirm-then-act gate covering CREATE_EVENT,
 * DELETE_EVENT, DELETE_RULE, DELETE_MEMORY, UPDATE_MORNING_CALL,
 * SCHEDULE_MEDICATION, and non-email SET_ACTION_RULE triggers.
 * Tests in tests/catalogue/confirm-then-act.ts (b4z.* tests added 2026-05-28).
 *
 * Run via `npm run test:auto -- --grep session-2026-05-28`.
 */

import { adapters } from '../lib/adapters';
import {
  expect2xx,
  expectTruthy,
  findActionInRawText,
  extractSpeech,
} from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const session2026_05_28Tests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────
  // B6e — calendar-read pre-Claude bypass (commit bf906c4, deployed 2026-05-28)
  // Regression: "what is on my calendar this week?" must NOT route to LIST_READ.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'session-2026-05-28.b6e-calendar-query-no-list-read',
    category: 'session-2026-05-28',
    description: 'B6e: "what is on my calendar this week?" must NOT emit LIST_READ — bypass returns calendar content directly',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'What is on my calendar this week?' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const rawText = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 400)}…`);

      // Must NOT have emitted LIST_READ — that was the bug.
      const listRead = findActionInRawText(rawText, 'LIST_READ');
      if (listRead) {
        throw new Error(
          `B6e regression: calendar query emitted LIST_READ instead of returning calendar content. ` +
          `Action: ${JSON.stringify(listRead)}. rawText: ${rawText.slice(0, 300)}`,
        );
      }

      // Must NOT have emitted LIST_RULES either (second misroute pattern).
      const listRules = findActionInRawText(rawText, 'LIST_RULES');
      if (listRules) {
        throw new Error(
          `B6e regression: calendar query emitted LIST_RULES instead of returning calendar content. ` +
          `Action: ${JSON.stringify(listRules)}. rawText: ${rawText.slice(0, 300)}`,
        );
      }

      // Speech must reference a calendar-shaped response (schedule / calendar /
      // clear / event — not a list of items from a named list).
      const speech = extractSpeech(rawText).toLowerCase();
      ctx.log(`speech: ${speech.slice(0, 200)}`);
      expectTruthy(
        /schedule|calendar|event|appointment|meeting|clear/.test(speech),
        `B6e: speech doesn't look like a calendar reply. Speech: "${speech.slice(0, 200)}"`,
      );
    },
  },

  {
    id: 'session-2026-05-28.b6e-today-calendar-no-list-read',
    category: 'session-2026-05-28',
    description: 'B6e: "what is on my calendar today?" must NOT emit LIST_READ',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'What is on my calendar today?' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const rawText = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 400)}…`);

      const listRead = findActionInRawText(rawText, 'LIST_READ');
      if (listRead) {
        throw new Error(
          `B6e regression (today variant): calendar query emitted LIST_READ. ` +
          `Action: ${JSON.stringify(listRead)}. rawText: ${rawText.slice(0, 300)}`,
        );
      }

      const speech = extractSpeech(rawText).toLowerCase();
      expectTruthy(
        /schedule|calendar|event|appointment|meeting|clear/.test(speech),
        `B6e: today variant speech doesn't look like a calendar reply. Speech: "${speech.slice(0, 200)}"`,
      );
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // B6d v99 — ALL lists and choices must be numbered (not bullets)
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'session-2026-05-28.b6d-prompt-version-v99',
    category: 'session-2026-05-28',
    description: 'B6d v99 — PROMPT_VERSION must be 2026-05-28-v99-all-lists-numbered',
    timeoutMs: 15_000,
    async run(ctx) {
      const { status, data } = await adapters.call(
        ctx, 'get-naavi-prompt', { channel: 'app' }, { timeoutMs: 15_000 },
      );
      expect2xx(status, 'get-naavi-prompt');
      const version: string = data?.version ?? '';
      ctx.log(`version: ${version}`);
      expectTruthy(
        version === '2026-05-28-v99-all-lists-numbered',
        `Expected version "2026-05-28-v99-all-lists-numbered", got "${version}"`,
      );
    },
  },
];
