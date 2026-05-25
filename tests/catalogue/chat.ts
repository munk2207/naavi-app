/**
 * Chat behavior tests — verifies Naavi-chat returns the correct action types.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectTruthy, findActionInRawText, extractSpeech, chatWithConfirm } from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const chatTests: TestCase[] = [
  {
    id: 'chat.location-default-one-time',
    category: 'chat',
    description: '"Alert me when I arrive home" returns SET_ACTION_RULE with one_shot=true (V57.19 default revert)',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Alert me when I arrive home' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 200)}…`);

      const action = findActionInRawText(data?.rawText ?? '', 'SET_ACTION_RULE');
      expectTruthy(action, 'SET_ACTION_RULE action');
      ctx.log(`action: ${JSON.stringify(action)}`);

      // V57.19 (2026-05-17) reverted V57.18's recurring-by-default. The
      // recurring default caused stationary-re-fire bugs (Wael got phantom
      // home-arrival alerts while sitting at home). Back to one-time as
      // the default; user has to say "every time" for recurring.
      if (action.trigger_type !== 'location') {
        throw new Error(`expected trigger_type='location', got '${action.trigger_type}'`);
      }
      if (action.one_shot !== true) {
        throw new Error(`expected one_shot=true (V57.19 default revert), got ${JSON.stringify(action.one_shot)}`);
      }
    },
  },
  {
    id: 'chat.spend-summary-anthropic',
    category: 'chat',
    description: 'TEST_PLAN-new + V57.9.4 — "How much did Anthropic charge me last month?" emits SPEND_SUMMARY action',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'How much did Anthropic charge me last month?' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 200)}…`);
      const action = findActionInRawText(data?.rawText ?? '', 'SPEND_SUMMARY');
      expectTruthy(action, 'SPEND_SUMMARY action');
      if (typeof action.vendor !== 'string' || !/anthropic/i.test(action.vendor)) {
        throw new Error(`expected vendor containing "Anthropic", got ${JSON.stringify(action.vendor)}`);
      }
      if (typeof action.period_label !== 'string' || !/last month/i.test(action.period_label)) {
        throw new Error(`expected period_label "last month", got ${JSON.stringify(action.period_label)}`);
      }
    },
  },
  {
    id: 'chat.priority-flag-critical',
    category: 'chat',
    description: 'TEST_PLAN C2 — "Schedule a critical doctor call tomorrow 4pm" sets is_priority=true. B4z 2026-05-25: 2-turn confirm-then-act (RULE 23).',
    timeoutMs: 60_000,
    async run(ctx) {
      const { turn1, turn2 } = await chatWithConfirm(ctx, 'Schedule a critical doctor call tomorrow at 4 PM');
      expect2xx(turn1.status, 'naavi-chat turn 1');
      expect2xx(turn2.status, 'naavi-chat turn 2');
      ctx.log(`turn1: ${turn1.data?.rawText?.slice(0, 250)}…`);
      ctx.log(`turn2: ${turn2.data?.rawText?.slice(0, 250)}…`);

      // Turn 1: no action, must have confirm phrase.
      const turn1Action = findActionInRawText(turn1.data?.rawText ?? '', 'CREATE_EVENT');
      if (turn1Action) {
        throw new Error(`RULE 23 violation: CREATE_EVENT emitted on turn 1. Action: ${JSON.stringify(turn1Action)}`);
      }
      const turn1Speech = extractSpeech(turn1.data?.rawText ?? '');
      expectTruthy(/say yes to confirm/i.test(turn1Speech),
        `turn 1 must contain "say yes to confirm". Speech: "${turn1Speech.slice(0,200)}"`);

      // Turn 2: CREATE_EVENT with is_priority=true.
      const action = findActionInRawText(turn2.data?.rawText ?? '', 'CREATE_EVENT');
      expectTruthy(action, 'CREATE_EVENT action on turn 2');
      if (action.is_priority !== true) {
        throw new Error(`expected is_priority=true (RULE 16), got ${JSON.stringify(action.is_priority)}`);
      }
    },
  },
  {
    id: 'chat.no-phantom-on-schedule-question',
    category: 'chat',
    description: 'TEST_PLAN C5 + V57.9.4 — "What is on my schedule today" must NOT emit CREATE_EVENT (retrieval, not commit)',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'What is on my schedule today?' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 250)}…`);
      // For a retrieval question Claude should respond with speech only,
      // possibly a GLOBAL_SEARCH action — but NOT CREATE_EVENT (that
      // would mean Claude is hallucinating a calendar add).
      const phantom = findActionInRawText(data?.rawText ?? '', 'CREATE_EVENT');
      if (phantom) {
        throw new Error(`Schedule retrieval question generated a phantom CREATE_EVENT: ${JSON.stringify(phantom)}`);
      }
    },
  },
];
