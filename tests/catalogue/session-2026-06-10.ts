/**
 * Session 2026-06-10 — regression coverage for B6h (delete-alert silent failure).
 *
 * B6h: Naavi said "Done — that alert was already deleted" without emitting
 * DELETE_RULE — Claude confabulated a completion. The Canadian Tire alert
 * remained visible in the Alerts screen after the "Done" reply.
 *
 * Fix: pre-Claude DELETE_ALERT_RE intercept in useOrchestrator.ts detects
 * delete-alert intent, fetches rules server-side, and handles deterministically:
 *   0 matches → "I couldn't find an alert matching X"
 *   1 match   → pendingConfirmDeleteRef + confirm prompt
 *   2+ matches → pendingDeleteRef (existing disambiguation)
 * On "yes": deletion via manage-rules, verified via data.ok === true.
 *
 * Coverage gaps acknowledged (Rule 15a exception):
 *   The fix is in useOrchestrator.ts (mobile-only React Native hook). The
 *   auto-tester cannot invoke the orchestrator directly. Tests here are
 *   static code checks verifying the fix landed correctly.
 *
 * Run via `npm run test:auto`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const ORCHESTRATOR_PATH = join(
  process.cwd(),
  'hooks', 'useOrchestrator.ts',
);

export const session2026_06_10Tests: TestCase[] = [
  {
    id: 'b6h.delete-intent-intercept-present',
    description: 'B6h: useOrchestrator has DELETE_ALERT_RE intercept before sendToNaavi',
    tags: ['b6h', 'trust', 'delete-rule'],
    run: async () => {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(
        src.includes('DELETE_ALERT_RE'),
        'useOrchestrator must define DELETE_ALERT_RE for delete-intent detection',
      );
      expectTruthy(
        src.includes('pendingConfirmDeleteRef'),
        'useOrchestrator must have pendingConfirmDeleteRef for single-match confirm-before-delete',
      );
    },
  },

  {
    id: 'b6h.delete-alert-regex-matches-natural-language',
    description: 'B6h: DELETE_ALERT_RE matches common delete-alert phrasings',
    tags: ['b6h', 'regex', 'delete-rule'],
    run: async () => {
      const DELETE_ALERT_RE = /\b(delete|remove|cancel|clear)\b.{0,40}\b(alert|reminder|rule|notification)\b/i;
      const shouldMatch = [
        'Delete my Canadian tire alert',
        'remove the Costco alert',
        'cancel that reminder',
        'clear the notification',
        'delete Canadian Tire alert',
        'Delete my alert',
      ];
      const shouldNotMatch = [
        'What alerts do I have',
        'Show me my alerts',
        'when does my alert fire',
      ];
      for (const phrase of shouldMatch) {
        expectTruthy(
          DELETE_ALERT_RE.test(phrase),
          `DELETE_ALERT_RE should match: "${phrase}"`,
        );
      }
      for (const phrase of shouldNotMatch) {
        expectTruthy(
          !DELETE_ALERT_RE.test(phrase),
          `DELETE_ALERT_RE should NOT match: "${phrase}"`,
        );
      }
    },
  },

  {
    id: 'b6h.confirm-delete-checks-data-ok',
    description: 'B6h: confirm-delete handler checks data.ok === true not just !error',
    tags: ['b6h', 'trust', 'delete-rule'],
    run: async () => {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(
        src.includes("data?.ok === true"),
        'confirm-delete must verify data.ok === true from manage-rules, not just absence of error',
      );
    },
  },

  {
    id: 'b6h.positive-re-defined',
    description: 'B6h: POSITIVE_RE constant is defined for "yes" detection',
    tags: ['b6h', 'delete-rule'],
    run: async () => {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(
        src.includes('POSITIVE_RE'),
        'useOrchestrator must define POSITIVE_RE for confirm-delete "yes" detection',
      );
    },
  },
];
