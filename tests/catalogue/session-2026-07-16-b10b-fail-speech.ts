/**
 * Session 2026-07-16 — B10b: action_rule_confirm_gate.js's failSpeechForAction
 * now branches on result.error instead of always speaking one hardcoded
 * message.
 *
 * Completes docs/B10B_PHASE2_CHANGE_PLAN_2026-07-16.md (fix) and
 * docs/B10B_PHASE3_TECHNICAL_REVIEW_2026-07-16.md (authorized scope).
 * Root cause: docs/B10B_PHASE1_PROBLEM_DEFINITION_2026-07-16.md — the
 * function always spoke "you may already have an identical alert" on any
 * post-confirmation SET_ACTION_RULE failure, even once B10a made F12's
 * fail-closed resolution errors (ambiguous/not_found/resolve_failed)
 * reachable from this call site — giving the user an inaccurate
 * explanation despite the actual failure reason already being available
 * in result.error.
 *
 * These are source-assertion tests (same pattern as the B10a/F12/B9
 * catalogue) — they confirm the fix is shaped correctly in the source, not
 * a live end-to-end call against real Twilio/Supabase.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const GATE_PATH = join(process.cwd(), 'naavi-voice-server', 'src', 'action_rule_confirm_gate.js');

export const session2026_07_16_b10bFailSpeechTests: TestCase[] = [
  {
    id: 'b10b.fail-speech-branches-on-ambiguous-error',
    category: 'contacts',
    description: 'failSpeechForAction speaks the multi-contact clarification when result.error is "ambiguous", instead of the generic duplicate-alert message',
    async run() {
      const src = readFileSync(GATE_PATH, 'utf8');
      expectTruthy(src.includes("case 'ambiguous':"), 'must have a case for the ambiguous resolve-recipient error');
      expectTruthy(
        src.includes('You have more than one contact named ${toName}'),
        'ambiguous case must name the multi-contact problem and ask for a full name',
      );
    },
  },
  {
    id: 'b10b.fail-speech-branches-on-not-found-error',
    category: 'contacts',
    description: 'failSpeechForAction speaks the no-contact-found message when result.error is "not_found"/"invalid"/"resolve_failed", instead of the generic duplicate-alert message',
    async run() {
      const src = readFileSync(GATE_PATH, 'utf8');
      for (const kind of ["'not_found':", "'invalid':", "'resolve_failed':"]) {
        expectTruthy(src.includes(`case ${kind}`), `must have a case for ${kind}`);
      }
      expectTruthy(
        src.includes("I don't have a contact named ${toName}"),
        'not_found/invalid/resolve_failed cases must name the no-contact-found problem and offer a recovery path',
      );
    },
  },
  {
    id: 'b10b.fail-speech-preserves-original-duplicate-alert-message',
    category: 'contacts',
    description: 'the original duplicate-timestamp-conflict message is unchanged and still reachable as the default branch when result has no error field',
    async run() {
      const src = readFileSync(GATE_PATH, 'utf8');
      expectTruthy(
        src.includes('default:') &&
        src.includes("return \"I couldn't set that up — you may already have an identical alert. Say what you'd like to change.\";"),
        'default branch must still speak the original message byte-for-byte, for the case where result.error is undefined',
      );
    },
  },
];
