/**
 * 2026-08-13 — DRAFT_MESSAGE channel regression (fast-path classifier).
 *
 * Live bug, found by Wael testing "Send sms to my wife saying good morning":
 * the app rendered an EMAIL draft card instead of SMS, complete with an
 * auto-generated email subject line — even though the user said "sms"
 * explicitly and the Path B system prompt has a STRICT channel-mapping
 * rule ("text"/"SMS" → sms, never guess).
 *
 * Root cause (verified live against staging, not inferred): naavi-chat has
 * a separate, faster Haiku classifier for single-action messages (distinct
 * from the full Claude tool-use path in _shared/anthropic_tools.ts, whose
 * `draft_message` tool schema DOES require channel). That classifier's
 * DRAFT_MESSAGE param spec never asked for `channel`, and the code building
 * the action object (naavi-chat/index.ts, DRAFT_MESSAGE case) never set one
 * — so every message through this fast path silently defaulted to email in
 * the UI (DraftCard's `action.channel ?? 'email'` fallback). Confirmed
 * deterministic: 5/5 identical live runs of the exact repro phrase all
 * produced an action object with no `channel` key before the fix.
 *
 * Fix: classifier prompt now extracts `channel` with the same strict
 * mapping as Path B; the DRAFT_MESSAGE case builds `action.channel` from it
 * (defaulting to 'email' only for genuinely ambiguous phrasing, matching
 * Path B's own default).
 *
 * Addendum (same session) — subject-line quality. Once channel resolution
 * was fixed, Wael's next live test ("Email my wife saying goodnight")
 * surfaced a second, separate issue: the email arrived at the correct
 * recipient (verified via sent_messages: to_email matched Linda's real
 * address), but with subject "Wife Saying Goodnight" — because the
 * classifier never asked for `subject` at all, so the DRAFT_MESSAGE case's
 * pre-existing fallback (strip the verb phrase off the raw command text,
 * title-case whatever's left) always fired for this fast path. Fixed by
 * adding `subject` to the classifier's DRAFT_MESSAGE param spec (channel="email"
 * only), matching Path B's own "short natural subject line" instruction —
 * verified live: 5/5 runs of the same phrase now produce subject:"Goodnight"
 * instead of the mechanical "Wife Saying Goodnight".
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectEqual, expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

function extractAction(rawText: string): any {
  try {
    const parsed = JSON.parse(rawText);
    const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
    return actions.find((a: any) => a?.type === 'DRAFT_MESSAGE') ?? null;
  } catch {
    return null;
  }
}

export const draftMessageChannelTests: TestCase[] = [
  {
    id: 'session-2026-08-13.draft-message-sms-channel',
    category: 'chat',
    description:
      'DRAFT_MESSAGE fast-path classifier must set channel="sms" when the ' +
      'user says "sms" — not silently default to email.',
    timeoutMs: 20_000,
    async run(ctx) {
      const chat = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Send sms to my wife saying good morning' }],
      });
      expect2xx(chat.status, 'naavi-chat');
      const action = extractAction(chat.data?.rawText ?? '{}');
      ctx.log(`action=${JSON.stringify(action)}`);
      expectEqual(action?.type, 'DRAFT_MESSAGE', 'must emit a DRAFT_MESSAGE action');
      expectEqual(action?.channel, 'sms', 'channel must be "sms", not the email default');
    },
  },
  {
    id: 'session-2026-08-13.draft-message-email-channel',
    category: 'chat',
    description:
      'DRAFT_MESSAGE fast-path classifier must set channel="email" when the ' +
      'user says "email".',
    timeoutMs: 20_000,
    async run(ctx) {
      const chat = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Email Sarah asking for the report' }],
      });
      expect2xx(chat.status, 'naavi-chat');
      const action = extractAction(chat.data?.rawText ?? '{}');
      ctx.log(`action=${JSON.stringify(action)}`);
      expectEqual(action?.type, 'DRAFT_MESSAGE', 'must emit a DRAFT_MESSAGE action');
      expectEqual(action?.channel, 'email', 'channel must be "email"');
    },
  },
  {
    id: 'session-2026-08-13.draft-message-natural-subject',
    category: 'chat',
    description:
      'DRAFT_MESSAGE email subject must be a natural short phrase from the ' +
      'classifier, not the mechanical "leftover words title-cased" fallback ' +
      '("Wife Saying Goodnight" instead of "Goodnight").',
    timeoutMs: 20_000,
    async run(ctx) {
      const chat = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Email my wife saying goodnight' }],
      });
      expect2xx(chat.status, 'naavi-chat');
      const action = extractAction(chat.data?.rawText ?? '{}');
      ctx.log(`action=${JSON.stringify(action)}`);
      expectEqual(action?.type, 'DRAFT_MESSAGE', 'must emit a DRAFT_MESSAGE action');
      expectEqual(action?.channel, 'email', 'channel must be "email"');
      const subject = String(action?.subject ?? '');
      expectTruthy(subject.length > 0, 'subject must not be empty');
      expectTruthy(
        !/^wife\s+saying/i.test(subject),
        `subject must not be the mechanical word-strip fallback, got "${subject}"`,
      );
    },
  },
];
