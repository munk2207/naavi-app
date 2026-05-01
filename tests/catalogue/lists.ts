/**
 * Lists tests — verify Naavi-chat emits the right list actions for the
 * canonical TEST_PLAN.md H1-H4 phrasings.
 *
 * We test the prompt-side action shape (cheaper, faster, deterministic)
 * rather than running the full mobile orchestrator + manage-list E2E.
 * The multiuser suite already proves manage-list itself is reachable.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectTruthy, findActionInRawText } from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const listsTests: TestCase[] = [
  {
    id: 'lists.create',
    category: 'lists',
    description: 'TEST_PLAN H1 — "Create a shopping list" emits LIST_CREATE',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Create a shopping list' }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat');
      const action = findActionInRawText(data?.rawText ?? '', 'LIST_CREATE');
      expectTruthy(action, 'LIST_CREATE action');
      if (typeof action.name !== 'string' || !/shopping/i.test(action.name)) {
        throw new Error(`expected name containing "shopping", got ${JSON.stringify(action.name)}`);
      }
    },
  },
  {
    id: 'lists.add',
    category: 'lists',
    description: 'TEST_PLAN H2 — "Add milk and eggs to my shopping list" emits LIST_ADD with both items',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Add milk and eggs to my shopping list' }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat');
      const action = findActionInRawText(data?.rawText ?? '', 'LIST_ADD');
      expectTruthy(action, 'LIST_ADD action');
      const items = Array.isArray(action.items) ? action.items.join(' ').toLowerCase() : '';
      if (!/milk/.test(items) || !/eggs/.test(items)) {
        throw new Error(`expected items to include milk and eggs, got ${JSON.stringify(action.items)}`);
      }
    },
  },
  {
    id: 'lists.read',
    category: 'lists',
    description: 'TEST_PLAN H3 — "What is on my shopping list?" emits LIST_READ',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'What is on my shopping list?' }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat');
      const action = findActionInRawText(data?.rawText ?? '', 'LIST_READ');
      expectTruthy(action, 'LIST_READ action');
    },
  },
  {
    id: 'lists.remove',
    category: 'lists',
    description: 'TEST_PLAN H4 — "Remove eggs from my shopping list" emits LIST_REMOVE with eggs item',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Remove eggs from my shopping list' }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat');
      const action = findActionInRawText(data?.rawText ?? '', 'LIST_REMOVE');
      expectTruthy(action, 'LIST_REMOVE action');
      const items = Array.isArray(action.items) ? action.items.join(' ').toLowerCase() : '';
      if (!/eggs/.test(items)) {
        throw new Error(`expected items to include eggs, got ${JSON.stringify(action.items)}`);
      }
    },
  },
];
