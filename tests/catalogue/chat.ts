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
];
