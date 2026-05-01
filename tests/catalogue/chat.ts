/**
 * Chat behavior tests — verifies Naavi-chat returns the correct action types.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectTruthy, findActionInRawText } from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const chatTests: TestCase[] = [
  {
    id: 'chat.location-default-one-time',
    category: 'chat',
    description: '"Alert me when I arrive home" returns SET_ACTION_RULE with one_shot=true',
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

      // Per V57.4 prompt v41: location alerts default to one_shot=true.
      if (action.trigger_type !== 'location') {
        throw new Error(`expected trigger_type='location', got '${action.trigger_type}'`);
      }
      if (action.one_shot !== true) {
        throw new Error(`expected one_shot=true (V57.4 default), got ${JSON.stringify(action.one_shot)}`);
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
    description: 'TEST_PLAN C2 — "Schedule a critical doctor call tomorrow 4pm" sets is_priority=true',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Schedule a critical doctor call tomorrow at 4 PM' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 250)}…`);
      const action = findActionInRawText(data?.rawText ?? '', 'CREATE_EVENT');
      expectTruthy(action, 'CREATE_EVENT action');
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
