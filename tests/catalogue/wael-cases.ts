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

import { adapters, db } from '../lib/adapters';
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
  // 4. "Alert me when I receive email from OCLCC" → an email rule is
  //    created. naavi-chat handles "alert me" intents via a server-side
  //    pipeline (saveAlertRule), not via Claude. So we verify the rule
  //    landed in the DB rather than expecting a SET_ACTION_RULE action.
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'chat.email-alert-rule-from-oclcc',
    category: 'chat',
    description: '"alert me when I receive email from OCLCC" creates an email rule in action_rules',
    timeoutMs: 30_000,
    async run(ctx) {
      // Capture the count BEFORE the chat call so we can detect a new row.
      const before = await db.select<any[]>(ctx, 'action_rules',
        `user_id=eq.${ctx.testUserId}&trigger_type=eq.email&select=id,trigger_config`);
      const beforeCount = Array.isArray(before) ? before.length : 0;

      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Alert me when I receive email from OCLCC' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 500)}…`);

      // Either path is acceptable:
      //   (a) naavi-chat handled it server-side and inserted a row directly.
      //   (b) Claude emitted SET_ACTION_RULE which the orchestrator would have inserted.
      // For (a), check the DB directly. For (b), the rule wouldn't be in DB
      // yet because the orchestrator runs in the mobile app, not the test.
      const action = findActionInRawText(data?.rawText ?? '', 'SET_ACTION_RULE');

      // Wait briefly for the server-side insert to land.
      await new Promise(r => setTimeout(r, 1_000));
      const after = await db.select<any[]>(ctx, 'action_rules',
        `user_id=eq.${ctx.testUserId}&trigger_type=eq.email&select=id,trigger_config`);
      const afterCount = Array.isArray(after) ? after.length : 0;

      const newRows = afterCount - beforeCount;
      ctx.log(`action_rules email count: ${beforeCount} → ${afterCount} (delta=${newRows})`);

      // PASS if EITHER a row was added OR a SET_ACTION_RULE action came back.
      if (newRows > 0) {
        const newest = (after as any[]).find(r => !(before as any[]).some(b => b.id === r.id));
        if (newest) {
          const tcStr = JSON.stringify(newest.trigger_config ?? {}).toLowerCase();
          if (!tcStr.includes('oclcc')) {
            throw new Error(`new row's trigger_config doesn't mention OCLCC: ${JSON.stringify(newest.trigger_config)}`);
          }
        }
        return; // pass via DB path
      }

      if (action) {
        ctx.log(`action: ${JSON.stringify(action)}`);
        if (action.trigger_type !== 'email') {
          throw new Error(`expected trigger_type='email', got '${action.trigger_type}'`);
        }
        const tcAny = JSON.stringify(action.trigger_config ?? {}).toLowerCase();
        if (!tcAny.includes('oclcc')) {
          throw new Error(`expected trigger_config to mention OCLCC, got ${JSON.stringify(action.trigger_config)}`);
        }
        return; // pass via Claude path
      }

      // Neither path produced a rule.
      throw new Error(
        `No rule created. Speech said: ${JSON.stringify((data?.rawText ?? '').slice(0, 200))}. ` +
        `No new row in action_rules. No SET_ACTION_RULE in response. Phantom-action bug.`,
      );
    },
  },
];
