/**
 * Wael's plain-English tests — converted to runnable form.
 *
 * Source: tests/CASES_TODO.md
 *
 * Note on data-dependent tests: tests 1-3 ask Naavi to recall info that
 * may or may not be in the test user's database. They pass if Naavi
 * responds coherently (no crash, no auth failure) — not if she finds
 * specific data. To make them strict content checks we'd need to seed
 * fixtures via the test user.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectTruthy, findActionInRawText } from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const waelTests: TestCase[] = [
  // ─────────────────────────────────────────────────────────────────────
  // 1. "Find all billing" → Naavi should return a coherent answer (or
  //    GLOBAL_SEARCH action if she queries first).
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'chat.find-billing',
    category: 'chat',
    description: '"find all billing" returns a coherent response (search result or no-data answer)',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'find all billing' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 300)}…`);
      // Pass if we got any non-empty response. Naavi may return GLOBAL_SEARCH
      // action OR a speech with results OR "nothing found" — all acceptable.
      // Failure means a crash, empty response, or generic-Claude refusal.
      expectTruthy(data?.rawText && data.rawText.length > 10, 'non-empty response');
      // Refusal sniff: "I can't" / "I don't have access" → fail.
      if (/i (can'?t|cannot|don'?t have access|am unable)/i.test(data?.rawText ?? '')) {
        throw new Error(`Naavi refused: ${data?.rawText?.slice(0, 200)}`);
      }
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // 2. "What do we know about school year" → recall query.
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'chat.school-year-recall',
    category: 'chat',
    description: '"what do we know about school year" returns a coherent recall response',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'what do we know about school year' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 300)}…`);
      expectTruthy(data?.rawText && data.rawText.length > 10, 'non-empty response');
      if (/i (can'?t|cannot|don'?t have access|am unable)/i.test(data?.rawText ?? '')) {
        throw new Error(`Naavi refused: ${data?.rawText?.slice(0, 200)}`);
      }
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // 3. "What we know about Wael's wife" → person-context recall.
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'chat.wael-wife-recall',
    category: 'chat',
    description: '"what we know about Wael\'s wife" returns a coherent person-context response',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: "what we know about Wael's wife" }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 300)}…`);
      expectTruthy(data?.rawText && data.rawText.length > 10, 'non-empty response');
      if (/i (can'?t|cannot|don'?t have access|am unable)/i.test(data?.rawText ?? '')) {
        throw new Error(`Naavi refused: ${data?.rawText?.slice(0, 200)}`);
      }
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // 4. "Alert me when I receive email from OCLCC" → SET_ACTION_RULE
  //    with trigger_type='email' and trigger_config matching OCLCC.
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'chat.email-alert-rule-from-oclcc',
    category: 'chat',
    description: '"alert me when I receive email from OCLCC" returns SET_ACTION_RULE for email trigger',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Alert me when I receive email from OCLCC' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 500)}…`);

      const action = findActionInRawText(data?.rawText ?? '', 'SET_ACTION_RULE');
      expectTruthy(action, 'SET_ACTION_RULE action');
      ctx.log(`action: ${JSON.stringify(action)}`);

      if (action.trigger_type !== 'email') {
        throw new Error(`expected trigger_type='email', got '${action.trigger_type}'`);
      }
      // The trigger_config should mention OCLCC somewhere — from_name,
      // from_email, or subject_keyword. Lenient match on any of those fields.
      const tc = action.trigger_config ?? {};
      const tcAny = JSON.stringify(tc).toLowerCase();
      if (!tcAny.includes('oclcc')) {
        throw new Error(`expected trigger_config to mention OCLCC, got ${JSON.stringify(tc)}`);
      }
    },
  },
];
