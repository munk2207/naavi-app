/**
 * Session 2026-07-14 — B9r: mitigation for B9m (Google People API's search
 * doesn't reliably return the same result on every call for the same
 * query). Confirmed live twice in the same session: a real, existing
 * contact ("Xxx") came back "not_found" from resolve-recipient once, then
 * resolved cleanly on an identical retry a few minutes later — with no
 * code change in between, proving the inconsistency is on Google's side,
 * not Naavi's.
 *
 * Fix, per Wael's explicit design (confirmed 2026-07-14): on a not_found
 * result specifically (not ambiguous or invalid — a retry wouldn't help
 * those), hooks/useOrchestrator.ts's SET_ACTION_RULE recipient-resolution
 * silently retries resolve-recipient once after a short delay before
 * telling the user anything. In the common case (retry succeeds) the user
 * never sees an error — just a slightly longer "thinking" pause. Only if
 * the retry ALSO comes back not_found does Naavi say something, and even
 * then with honest, non-specific wording ("I'm having a technical
 * hiccup...") rather than blaming a cause (like "network") that was never
 * verified — per CLAUDE.md's outbound-claims rule.
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a: hooks/useOrchestrator.ts
 * is a React Native hook with Expo/RN imports that cannot be safely
 * imported into this Node/tsx test runner. These are source-pattern
 * assertions verifying the retry is scoped to not_found only, fires before
 * any user-facing message, and that the final fallback message doesn't
 * claim an unverified cause.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const USE_ORCHESTRATOR_PATH = join(process.cwd(), 'hooks', 'useOrchestrator.ts');

export const session2026_07_14_b9rContactLookupRetryTests: TestCase[] = [
  {
    id: 'b9r.retries-once-on-not-found-before-any-user-facing-message',
    category: 'rules',
    description: 'a not_found result from resolve-recipient triggers exactly one silent retry before any recipientBlocked/turnSpeechOverride is set',
    async run() {
      const src = readFileSync(USE_ORCHESTRATOR_PATH, 'utf8');
      const retryIdx = src.indexOf("if (resolved?.kind === 'not_found') {");
      expectTruthy(retryIdx !== -1, 'B9r fix: not_found retry block not found');

      const switchIdx = src.indexOf('switch (resolved?.kind) {', retryIdx);
      expectTruthy(switchIdx !== -1, 'switch on resolved.kind not found after the retry block');
      expectTruthy(retryIdx < switchIdx, 'B9r fix: the retry must happen BEFORE the switch that sets recipientBlocked/turnSpeechOverride, so a successful retry never surfaces an error to the user');

      const retryBlock = src.slice(retryIdx, switchIdx);
      expectTruthy(
        retryBlock.includes("'resolve-recipient'") && (retryBlock.match(/'resolve-recipient'/g) || []).length >= 1,
        'B9r fix: the retry block must call resolve-recipient again',
      );
      expectTruthy(
        retryBlock.includes('setTimeout') || retryBlock.includes('await new Promise'),
        'B9r fix: the retry must wait briefly before re-querying, not retry instantaneously (defeats the purpose if Google\'s index hasn\'t caught up yet)',
      );
    },
  },
  {
    id: 'b9r.not-found-message-does-not-claim-unverified-cause',
    category: 'rules',
    description: 'the final not_found message (after the retry also fails) does not claim a specific unverified cause like "network problem"',
    async run() {
      const src = readFileSync(USE_ORCHESTRATOR_PATH, 'utf8');
      const msgIdx = src.indexOf("technical hiccup finding");
      expectTruthy(msgIdx !== -1, 'B9r fix: the post-retry not_found message not found');

      const line = src.slice(Math.max(0, msgIdx - 100), msgIdx + 150);
      expectTruthy(
        !/network/i.test(line),
        'B9r fix: the message must not blame "the network" specifically — that was never verified as the cause and CLAUDE.md prohibits unverified claims in outbound messages',
      );
      expectTruthy(
        line.includes('try again') || line.includes('tell me their'),
        'B9r fix: the message must give the user a clear next step (retry, or provide contact info directly), not just state the failure',
      );
    },
  },
  {
    id: 'b9r.ambiguous-and-invalid-are-not-retried',
    category: 'rules',
    description: 'a retry only fires for not_found — ambiguous (genuinely multiple real contacts) and invalid are not retried, since a retry cannot fix either',
    async run() {
      const src = readFileSync(USE_ORCHESTRATOR_PATH, 'utf8');
      const retryConditionIdx = src.indexOf("if (resolved?.kind === 'not_found') {");
      expectTruthy(retryConditionIdx !== -1, 'not_found retry condition not found');
      const conditionLine = src.slice(retryConditionIdx, src.indexOf('\n', retryConditionIdx));
      expectTruthy(
        !conditionLine.includes('ambiguous') && !conditionLine.includes('invalid'),
        'B9r fix: the retry condition must check only for not_found, not ambiguous or invalid',
      );
    },
  },
];
