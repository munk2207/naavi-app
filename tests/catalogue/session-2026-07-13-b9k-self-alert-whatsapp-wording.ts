/**
 * Session 2026-07-13 — B9k: self-alert WhatsApp messages used the approved
 * naavi_message_from_sender template ("Hi {{1}}, {{2}} shared this message
 * with you: {{3}} — Sent via MyNaavi.") with {{1}}=the user's own name and
 * {{2}}="Naavi" (hardcoded), producing "Hi Robert, Naavi shared this message
 * with you..." — reading as if a third party named "Naavi" messaged the
 * user, when it's actually the user's own alert firing on themselves.
 *
 * Fix: evaluate-rules/index.ts's callSMS helper now accepts optional
 * recipientName/senderName overrides. The self-alert branch passes
 * recipientName:'there', senderName:<the user's own name> for the WhatsApp
 * send only, producing "Hi there, Robert shared this message with you..."
 * — a note-to-self reading, using the SAME already-approved template (no
 * new Meta template submission needed). Third-party alerts are unaffected
 * (no override passed, same behavior as before).
 *
 * Also fixes B9j (separate, prerequisite bug): WhatsApp self-override sends
 * were accepted by Twilio but never delivered because (a) staging's
 * TWILIO_WHATSAPP_FROM was pointed at Twilio's Sandbox number, not an
 * approved production sender, and (b) once a production sender was
 * connected, the free-form Body path still failed outside WhatsApp's 24h
 * session window (error 63016) because TWILIO_WHATSAPP_TEMPLATE_MESSAGE_SID
 * was never set on staging, even though send-sms/index.ts already had full
 * ContentSid/ContentVariables template support built in (2026-04-09). Both
 * were staging secret/config gaps, not code bugs — no test coverage needed
 * for those (they're infra state, not application logic), but this test
 * locks in the wording fix and confirms the template-secret code path
 * exists and is wired to the right template.
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a: evaluate-rules/index.ts
 * and send-sms/index.ts are Deno Edge Functions (call Deno.serve(...) at
 * module scope) and cannot be safely imported into this Node/tsx test
 * runner — same disclosed limitation as the rest of the F12/F15/B9i
 * catalogue. These are source-pattern assertions verifying the override
 * mechanism and self-alert wiring exist with the correct shape; the actual
 * fix was live-verified via a real WhatsApp send confirmed delivered
 * on-device (2026-07-13), and the wording override request is in flight,
 * not yet re-confirmed on-device at time of writing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const EVALUATE_RULES_PATH = join(process.cwd(), 'supabase', 'functions', 'evaluate-rules', 'index.ts');
const SEND_SMS_PATH       = join(process.cwd(), 'supabase', 'functions', 'send-sms', 'index.ts');

export const session2026_07_13_b9kSelfAlertWhatsappWordingTests: TestCase[] = [
  {
    id: 'b9k.callsms-accepts-recipient-sender-name-overrides',
    category: 'rules',
    description: 'callSMS in evaluate-rules accepts optional recipientName/senderName overrides, defaulting to prior behavior when omitted (third-party alerts unaffected)',
    async run() {
      const src = readFileSync(EVALUATE_RULES_PATH, 'utf8');
      const callSmsIdx = src.indexOf("const callSMS = (channel: 'sms' | 'whatsapp', to: string, overrides?:");
      expectTruthy(callSmsIdx !== -1, 'B9k fix: callSMS must accept an optional overrides param for recipientName/senderName');

      const callSmsEnd = src.indexOf('.catch(() => ({ channel, ok: false }));', callSmsIdx);
      const callSmsBody = src.slice(callSmsIdx, callSmsEnd);

      expectTruthy(
        callSmsBody.includes('recipient_name: overrides?.recipientName ?? (toName || userName || undefined)'),
        'B9k fix: recipient_name must prefer the override, falling back to the original toName||userName logic when no override is given',
      );
      expectTruthy(
        callSmsBody.includes("sender_name: overrides?.senderName ?? 'Naavi'"),
        'B9k fix: sender_name must prefer the override, falling back to the original hardcoded "Naavi" when no override is given',
      );
    },
  },
  {
    id: 'b9k.self-alert-whatsapp-uses-note-to-self-wording',
    category: 'rules',
    description: 'the self-alert branch passes recipientName:"there" and senderName:<user\'s own name> for the WhatsApp send only, producing a note-to-self reading instead of "Hi <user>, Naavi shared this message with you..."',
    async run() {
      const src = readFileSync(EVALUATE_RULES_PATH, 'utf8');
      const selfAlertIdx = src.indexOf('if (isSelfAlert) {');
      expectTruthy(selfAlertIdx !== -1, 'self-alert branch (if (isSelfAlert)) not found in evaluate-rules');

      const whatsappCallIdx = src.indexOf("if (selfWhatsappTarget && channelEnabled('whatsapp')) {", selfAlertIdx);
      expectTruthy(whatsappCallIdx !== -1, 'B9k fix: self-alert WhatsApp send must be its own block (not a single-line call) to carry the wording override');

      const blockEnd = src.indexOf('\n    }', whatsappCallIdx);
      const block = src.slice(whatsappCallIdx, blockEnd);

      expectTruthy(
        block.includes("recipientName: 'there'"),
        'B9k fix: self-alert WhatsApp send must override recipientName to "there" instead of the user\'s own name',
      );
      expectTruthy(
        block.includes("senderName: userName || 'You'"),
        'B9k fix: self-alert WhatsApp send must override senderName to the user\'s own registered name (falling back to "You"), not the hardcoded "Naavi"',
      );

      // Third-party branch (toPhone) must be untouched — no overrides passed.
      const thirdPartyIdx = src.indexOf('} else if (toPhone) {', selfAlertIdx);
      expectTruthy(thirdPartyIdx !== -1, 'third-party branch (else if (toPhone)) not found');
      const thirdPartyEnd = src.indexOf('} else if (toEmail) {', thirdPartyIdx);
      const thirdPartyBlock = src.slice(thirdPartyIdx, thirdPartyEnd);
      expectTruthy(
        !thirdPartyBlock.includes('recipientName:') && !thirdPartyBlock.includes('senderName:'),
        'B9k fix must be scoped to self-alerts only — the third-party branch must not pass any wording overrides, preserving its existing correct "Hi <third-party>, <user> shared..." behavior',
      );
    },
  },
  {
    id: 'b9k.send-sms-whatsapp-template-path-exists',
    category: 'rules',
    description: 'send-sms already supports ContentSid/ContentVariables WhatsApp template sends via TWILIO_WHATSAPP_TEMPLATE_MESSAGE_SID, falling back to free-form Body only when the secret is unset (B9j\'s actual gap was the missing staging secret, not missing code)',
    async run() {
      const src = readFileSync(SEND_SMS_PATH, 'utf8');
      expectTruthy(
        src.includes("Deno.env.get('TWILIO_WHATSAPP_TEMPLATE_MESSAGE_SID')"),
        'send-sms must read TWILIO_WHATSAPP_TEMPLATE_MESSAGE_SID to enable template-based WhatsApp sends',
      );
      expectTruthy(
        src.includes('ContentSid: templateSid') && src.includes('ContentVariables:'),
        'send-sms must send ContentSid + ContentVariables when the template secret is set (required for WhatsApp sends outside the 24h session window)',
      );
      expectTruthy(
        src.includes('Fallback: free-form body'),
        'send-sms must still fall back to a free-form Body send when no template secret is configured, for backwards compatibility',
      );
    },
  },
];
