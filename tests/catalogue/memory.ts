/**
 * Memory tests — verify search-knowledge returns a valid response shape.
 *
 * Note: we don't verify content matching because search-knowledge uses
 * vector similarity on the embedding column. To test end-to-end content
 * match we'd need to either (a) run the Claude+embedding pipeline (slow,
 * brittle to model output) or (b) insert an embedding directly (requires
 * generating one via OpenAI/Cohere API). For now this is a smoke test
 * for the search endpoint itself.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const memoryTests: TestCase[] = [
  {
    id: 'memory.search-knowledge-smoke',
    category: 'memory',
    description: 'search-knowledge returns 200 with a valid response shape',
    timeoutMs: 20_000,
    async run(ctx) {
      const search = await adapters.searchKnowledge(ctx, 'birthday');
      expect2xx(search.status, 'search-knowledge');
      ctx.log(`search data=${JSON.stringify(search.data).slice(0, 400)}`);
      // Response shape must contain a results array (even if empty).
      const hasArray =
        Array.isArray(search.data?.fragments) ||
        Array.isArray(search.data?.results) ||
        Array.isArray(search.data);
      expectTruthy(hasArray, 'search-knowledge response array (results / fragments)');
    },
  },
];
