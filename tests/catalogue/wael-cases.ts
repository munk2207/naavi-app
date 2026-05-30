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
import { expect2xx, expectTruthy, findActionInRawText, extractSpeech, chatWithConfirm } from '../lib/assertions';
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
      // Refusal sniff — exclude Level B disclosure ("I can't verify this from a live source")
      // which is correct honest behavior, not a refusal.
      const rawForSniff = (data?.rawText ?? '').replace(/i can'?t verify this from a live source/gi, '');
      if (/i (can'?t|cannot|don'?t have access|am unable)/i.test(rawForSniff)) {
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
      // Refusal sniff — exclude Level B disclosure ("I can't verify this from a live source")
      // which is correct honest behavior, not a refusal.
      const rawForSniff = (data?.rawText ?? '').replace(/i can'?t verify this from a live source/gi, '');
      if (/i (can'?t|cannot|don'?t have access|am unable)/i.test(rawForSniff)) {
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
      // Refusal sniff — exclude Level B disclosure ("I can't verify this from a live source")
      // which is correct honest behavior, not a refusal.
      const rawForSniff = (data?.rawText ?? '').replace(/i can'?t verify this from a live source/gi, '');
      if (/i (can'?t|cannot|don'?t have access|am unable)/i.test(rawForSniff)) {
        throw new Error(`Naavi refused: ${data?.rawText?.slice(0, 200)}`);
      }
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // 4. "Alert me when I receive email from OCLCC" → B4z 2026-05-25:
  //    RULE 23 confirm-then-act. Turn 1 must ask for confirmation;
  //    turn 2 (after "yes") must emit SET_ACTION_RULE(email).
  //    The old server-side bypass (saveAlertRule path A) was removed in B4z.
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'chat.email-alert-rule-from-oclcc',
    category: 'chat',
    description: '"alert me when I receive email from OCLCC" — B4z RULE 23 confirm-then-act: turn 1 asks confirm, turn 2 emits SET_ACTION_RULE(email)',
    timeoutMs: 60_000,
    async run(ctx) {
      const cleanup = async () => {
        try {
          await db.delete(ctx, 'action_rules',
            `user_id=eq.${ctx.testUserId}&trigger_type=eq.email&label=ilike.${encodeURIComponent('%OCLCC%')}`);
        } catch { /* ignore */ }
      };
      await cleanup();

      const { turn1, turn2 } = await chatWithConfirm(ctx, 'Alert me when I receive email from OCLCC');
      expect2xx(turn1.status, 'naavi-chat turn 1');
      expect2xx(turn2.status, 'naavi-chat turn 2');
      ctx.log(`turn1: ${turn1.data?.rawText?.slice(0, 250)}…`);
      ctx.log(`turn2: ${turn2.data?.rawText?.slice(0, 250)}…`);

      // Turn 1: no email rule action, must have confirm phrase.
      const turn1Rule = findActionInRawText(turn1.data?.rawText ?? '', 'SET_ACTION_RULE');
      const turn1IsEmail = turn1Rule && (turn1Rule as any).trigger_type === 'email';
      if (turn1IsEmail) {
        await cleanup();
        throw new Error(`RULE 23 violation: email rule emitted on turn 1 before confirm. Action: ${JSON.stringify(turn1Rule)}`);
      }
      const turn1Speech = extractSpeech(turn1.data?.rawText ?? '');
      expectTruthy(/say yes to confirm/i.test(turn1Speech),
        `turn 1 must have "say yes to confirm". Speech: "${turn1Speech.slice(0,200)}"`);

      // Turn 2: SET_ACTION_RULE(trigger_type=email) referencing OCLCC.
      const turn2Rule = findActionInRawText(turn2.data?.rawText ?? '', 'SET_ACTION_RULE');
      const turn2IsEmail = turn2Rule && (turn2Rule as any).trigger_type === 'email';
      if (!turn2IsEmail) {
        await cleanup();
        throw new Error(
          `No email rule on turn 2. B4z confirm-turn detection may be broken. ` +
          `turn2 rawText: ${turn2.data?.rawText?.slice(0, 300)}`,
        );
      }
      const tcStr = JSON.stringify((turn2Rule as any).trigger_config ?? {}).toLowerCase();
      if (!tcStr.includes('oclcc')) {
        await cleanup();
        throw new Error(`trigger_config doesn't mention OCLCC: ${JSON.stringify((turn2Rule as any).trigger_config)}`);
      }
      ctx.log(`b4z: email alert confirmed on turn 2: ${JSON.stringify((turn2Rule as any).trigger_config)}`);
      await cleanup();
    },
  },
];
