/**
 * Smoke tests — verify each Edge Function is reachable.
 */

import { adapters } from '../lib/adapters';
import { expect2xx } from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const smokeTests: TestCase[] = [
  {
    id: 'smoke.naavi-chat',
    category: 'smoke',
    description: 'naavi-chat returns 200 for a minimal "hello" message',
    async run(ctx) {
      const { status, durationMs } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
      });
      ctx.log(`naavi-chat status=${status} duration=${durationMs}ms`);
      expect2xx(status, 'naavi-chat');
    },
  },
];
