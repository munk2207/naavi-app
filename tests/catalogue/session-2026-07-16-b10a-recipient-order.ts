/**
 * Session 2026-07-16 — B10a: voice general (non-location) SET_ACTION_RULE
 * handler — B4y/F12 block reorder.
 *
 * Completes docs/B10A_PHASE2_CHANGE_PLAN_2026-07-16.md (fix) and
 * docs/B10A_PHASE3_TECHNICAL_REVIEW_2026-07-16.md (authorized scope).
 * Root cause: docs/B10A_PHASE1_PROBLEM_DEFINITION_2026-07-16.md — B4y's
 * default-to-self block ran before F12's named-recipient resolution block,
 * so B4y's assignment satisfied F12's own guard condition before F12 ever
 * ran, silently skipping resolution for every time-trigger SMS/WhatsApp
 * request naming a real contact. The fix moves F12's block ahead of B4y's,
 * with no condition logic changes — the guard conditions themselves are
 * unchanged, only their order.
 *
 * These are source-assertion tests (same pattern as the rest of the F12/B9
 * catalogue) — they confirm the fix is shaped and ordered correctly in the
 * source, not a live end-to-end call against real Twilio/Supabase.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const VOICE_SERVER_PATH = join(process.cwd(), 'naavi-voice-server', 'src', 'index.js');

export const session2026_07_16_b10aRecipientOrderTests: TestCase[] = [
  {
    id: 'b10a.f12-resolution-runs-before-b4y-default',
    category: 'contacts',
    description: 'voice general SET_ACTION_RULE handler runs F12 named-recipient resolution before B4y\'s default-to-self block, so B4y can no longer satisfy F12\'s guard condition ahead of time',
    async run() {
      const src = readFileSync(VOICE_SERVER_PATH, 'utf8');
      const f12GuardIdx = src.indexOf("if (!hasSelfOverride && toNameVoice && !actionConfigNorm.to_phone && !actionConfigNorm.to_email)");
      const b4yGuardIdx = src.indexOf("if (!hasSelfOverride && (actType === 'sms' || actType === 'whatsapp') && !actionConfigNorm.to_phone)");
      expectTruthy(f12GuardIdx > -1, 'F12 resolution guard must still exist');
      expectTruthy(b4yGuardIdx > -1, 'B4y default-to-self guard must still exist');
      expectTruthy(
        f12GuardIdx < b4yGuardIdx,
        `F12's resolution block must run before B4y's default block (found F12 at ${f12GuardIdx}, B4y at ${b4yGuardIdx})`,
      );
    },
  },
  {
    id: 'b10a.resolution-failure-return-precedes-b4y-default',
    category: 'contacts',
    description: 'the fail-closed return on an unresolvable/ambiguous recipient is positioned before B4y\'s default, so a real named contact that cannot be resolved never falls through to texting the user instead',
    async run() {
      const src = readFileSync(VOICE_SERVER_PATH, 'utf8');
      const failClosedReturnIdx = src.indexOf("return { success: false, error: resolved?.kind || 'resolve_failed' };");
      const b4yGuardIdx = src.indexOf("if (!hasSelfOverride && (actType === 'sms' || actType === 'whatsapp') && !actionConfigNorm.to_phone)");
      expectTruthy(failClosedReturnIdx > -1, 'fail-closed return on unresolvable recipient must still exist');
      expectTruthy(
        failClosedReturnIdx < b4yGuardIdx,
        `fail-closed return must be positioned before B4y's default block (found return at ${failClosedReturnIdx}, B4y at ${b4yGuardIdx})`,
      );
    },
  },
  {
    id: 'b10a.b4y-no-recipient-self-default-preserved',
    category: 'contacts',
    description: 'B4y\'s original no-recipient default ("text me... in 3 minutes") is unchanged and still reachable — the reorder only changes when it runs, not its own condition or behavior',
    async run() {
      const src = readFileSync(VOICE_SERVER_PATH, 'utf8');
      expectTruthy(
        src.includes("if (!hasSelfOverride && (actType === 'sms' || actType === 'whatsapp') && !actionConfigNorm.to_phone) {"),
        'B4y\'s guard condition must be byte-identical to before the reorder — no condition logic changes were authorized',
      );
      expectTruthy(
        src.includes("console.log('[Action] B4y: defaulted SET_ACTION_RULE to_phone from user_settings:', userPhone);"),
        'B4y\'s user_settings.phone default must still fire for the genuine no-recipient case',
      );
    },
  },
];
