/**
 * Calendar tests — create event, verify it shows up.
 *
 * Note: this test requires a connected Google Calendar OAuth token for the
 * test user. If the token is missing, the test will be marked as errored and
 * skipped on subsequent runs until a token is provisioned. (Auto-tester
 * doesn't drive OAuth — that's a manual one-time step.)
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectTruthy, TestSkippedError } from '../lib/assertions';
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
      if (status === 401 || status === 403 || /token (refresh|expired|revoked|invalid)|invalid_grant/i.test(errMsg)) {
        throw new TestSkippedError(
          `Google Calendar OAuth not connected for test user. Sign in to Google Calendar once with mynaavi2207@gmail.com to enable.`,
        );
      }
      expect2xx(status, 'create-calendar-event');
      expectTruthy(data?.htmlLink, 'event htmlLink');
    },
  },
];
