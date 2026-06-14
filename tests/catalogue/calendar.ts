/**
 * Calendar tests — create event, verify it shows up.
 *
 * Note: this test requires a connected Google Calendar OAuth token for the
 * test user. If the token is missing, the test will be marked as errored and
 * skipped on subsequent runs until a token is provisioned. (Auto-tester
 * doesn't drive OAuth — that's a manual one-time step.)
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectTruthy, extractSpeech, TestSkippedError } from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const calendarTests: TestCase[] = [
  {
    id: 'calendar.create-event',
    category: 'calendar',
    description: 'create-calendar-event returns a valid htmlLink for a new event',
    timeoutMs: 30_000,
    async run(ctx) {
      // 30 minutes from now, 30 min duration.
      const start = new Date(Date.now() + 30 * 60_000);
      const end = new Date(start.getTime() + 30 * 60_000);

      const { status, data } = await adapters.createCalendarEvent(ctx, {
        summary: 'Auto-tester sample event',
        start: start.toISOString(),
        end: end.toISOString(),
        description: 'Created by Naavi auto-tester. Safe to delete.',
      });
      ctx.log(`create-event status=${status} data=${JSON.stringify(data).slice(0, 200)}`);

      // Skip cleanly when the test user's Google Calendar OAuth isn't
      // connected — that's a one-time manual setup, not a code bug.
      const errMsg = String(data?.error ?? '');
      if (status === 401 || status === 403 || /token (refresh|expired|revoked|invalid)|invalid_grant|insufficient.*(scope|permission)|insufficientPermissions/i.test(errMsg)) {
        throw new TestSkippedError(
          `Google Calendar OAuth not connected for test user. Sign in to Google Calendar once with mynaavi2207@gmail.com to enable.`,
        );
      }
      expect2xx(status, 'create-calendar-event');
      expectTruthy(data?.htmlLink, 'event htmlLink');
    },
  },

  // ── ARCH-1 READ_CALENDAR regression (2026-06-13) ─────────────────────────────
  // "what do I have today" must return a deterministic calendar answer —
  // never Claude hedging like "I don't have access" or a list/alert read.
  {
    id: 'calendar.read-today-no-hedging',
    category: 'calendar',
    description: 'ARCH-1 — "what do I have today" returns a deterministic calendar response, never Claude hedging',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'what do I have today' }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat');
      const speech = extractSpeech(data?.rawText ?? '');
      ctx.log(`speech: ${speech.slice(0, 200)}`);
      // Must be one of the two deterministic responses: clear calendar OR event list.
      const isCalendarClear = /your calendar is clear for today/i.test(speech);
      const isSchedule      = /here'?s your schedule for today/i.test(speech);
      // Must NOT be Claude hedging about calendar access.
      const isHedging = /i (don'?t|can'?t|cannot|do not) have access|i'?m not able to|i can'?t (see|access|check|view)|unable to access/i.test(speech);
      if (isHedging) {
        throw new Error(`READ_CALENDAR returned Claude hedging: "${speech.slice(0, 200)}"`);
      }
      expectTruthy(
        isCalendarClear || isSchedule,
        `Expected deterministic calendar response ("Your calendar is clear for today" OR "Here's your schedule for today"), got: "${speech.slice(0, 200)}"`,
      );
    },
  },

  // "what's coming up" — another gap pattern not caught by the original B6e regex.
  {
    id: 'calendar.read-coming-up-no-hedging',
    category: 'calendar',
    description: 'ARCH-1 — "what\'s coming up" returns a deterministic calendar response',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: "what's coming up" }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat');
      const speech = extractSpeech(data?.rawText ?? '');
      ctx.log(`speech: ${speech.slice(0, 200)}`);
      const isHedging = /i (don'?t|can'?t|cannot|do not) have access|i'?m not able to|i can'?t (see|access|check|view)|unable to access/i.test(speech);
      if (isHedging) {
        throw new Error(`READ_CALENDAR returned Claude hedging for "what's coming up": "${speech.slice(0, 200)}"`);
      }
      const isDeterministic = /your calendar is clear|here'?s your schedule|here'?s what'?s on/i.test(speech);
      expectTruthy(
        isDeterministic,
        `Expected deterministic calendar response, got: "${speech.slice(0, 200)}"`,
      );
    },
  },
];
