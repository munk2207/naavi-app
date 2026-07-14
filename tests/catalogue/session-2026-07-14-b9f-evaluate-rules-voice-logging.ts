/**
 * Session 2026-07-14 — B9f: `evaluate-rules`'s `callVoice` never wrote to
 * `sent_messages`, unlike `report-location-event`'s `callVoice` which does.
 * A time-triggered self-alert with voice_call enabled fired correctly
 * (Wael confirmed receiving the call), but no corresponding row appeared in
 * `sent_messages` the way SMS/WhatsApp rows for the same fire did — delivery
 * was real, just not database-observable via the normal audit trail.
 *
 * Fix: `evaluate-rules/index.ts`'s `callVoice` now inserts into
 * `sent_messages` after the Twilio call, matching the exact pattern
 * `report-location-event`'s `callVoice` already uses (channel:'voice',
 * provider_sid, delivery_status, metadata with Twilio's error body on
 * failure).
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a: naavi-chat/evaluate-rules
 * is a Deno Edge Function that cannot be safely imported into this Node/tsx
 * test runner. This is a source-pattern assertion locking in the fix; not
 * live-fire tested with a real phone call (low-severity, audit-trail-only
 * gap — disproportionate to place a real Twilio call cost against).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const EVALUATE_RULES_PATH = join(process.cwd(), 'supabase', 'functions', 'evaluate-rules', 'index.ts');

export const session2026_07_14_b9fEvaluateRulesVoiceLoggingTests: TestCase[] = [
  {
    id: 'b9f.evaluate-rules-callvoice-logs-to-sent-messages',
    category: 'rules',
    description: 'evaluate-rules\'s callVoice inserts a sent_messages row after the Twilio call, matching report-location-event\'s callVoice',
    async run() {
      const src = readFileSync(EVALUATE_RULES_PATH, 'utf8');

      const fnIdx = src.indexOf("const callVoice = async (toNumber: string): Promise<{ channel: string; ok: boolean }> => {");
      expectTruthy(fnIdx !== -1, 'callVoice function not found in evaluate-rules/index.ts');

      const fnEnd = src.indexOf('\n  };', fnIdx);
      const fnBody = src.slice(fnIdx, fnEnd);

      expectTruthy(
        fnBody.includes("adminClient.from('sent_messages').insert("),
        'B9f fix: callVoice must insert into sent_messages after the Twilio call, matching report-location-event\'s callVoice',
      );
      expectTruthy(
        fnBody.includes("channel:         'voice'"),
        'B9f fix: the sent_messages insert must use channel: \'voice\'',
      );
      expectTruthy(
        fnBody.includes('provider_sid:'),
        'B9f fix: the sent_messages insert must capture Twilio\'s call SID as provider_sid',
      );
      expectTruthy(
        fnBody.includes("delivery_status: res.ok ? 'sent' : 'failed'"),
        'B9f fix: the sent_messages insert must record delivery_status from the Twilio response',
      );
    },
  },
];
