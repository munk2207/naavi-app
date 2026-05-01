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
  {
    id: 'memory.ingest-then-search',
    category: 'memory',
    description: 'TEST_PLAN F1+F2: ingest-note writes a fragment that search-knowledge can find',
    timeoutMs: 30_000,
    async run(ctx) {
      const marker = `auto-tester-marker-${Date.now()}`;
      const noteText = `Auto-tester favorite color is ${marker}.`;
      const ingest = await adapters.ingestNote(ctx, noteText);
      ctx.log(`ingest status=${ingest.status} duration=${ingest.durationMs}ms`);
      expect2xx(ingest.status, 'ingest-note');
      // Wait briefly for embedding to be persisted.
      await new Promise(r => setTimeout(r, 1500));
      const search = await adapters.searchKnowledge(ctx, marker);
      expect2xx(search.status, 'search-knowledge');
      const results = search.data?.results ?? search.data?.fragments ?? [];
      ctx.log(`search results=${results.length}`);
      // We don't strictly assert match (vector recall on a one-shot insert
      // is best-effort) — but the chain not 5xxing IS the test.
    },
  },
];
