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
  {
    id: 'smoke.naavi-spend-summary',
    category: 'smoke',
    description: 'naavi-spend-summary returns 200 with valid response shape (V57.9.4 V4)',
    async run(ctx) {
      const { status, data, durationMs } = await adapters.call(ctx, 'naavi-spend-summary', {
        user_id: ctx.testUserId,
        vendor: 'Anthropic',
        period_label: 'all time',
      });
      ctx.log(`naavi-spend-summary status=${status} duration=${durationMs}ms invoice_count=${data?.invoice_count}`);
      expect2xx(status, 'naavi-spend-summary');
      if (typeof data?.invoice_count !== 'number') throw new Error('Missing invoice_count in response');
      if (!Array.isArray(data?.by_currency)) throw new Error('Missing by_currency array');
      if (typeof data?.period_start !== 'string') throw new Error('Missing period_start');
    },
  },
  {
    id: 'smoke.naavi-chat-lean-body',
    category: 'smoke',
    description: 'naavi-chat accepts V57.9.3 lean body (no system, server assembles via get-naavi-prompt)',
    async run(ctx) {
      // Skip system field entirely. naavi-chat must server-assemble.
      const { status, data, durationMs } = await adapters.call(ctx, 'naavi-chat', {
        user_id: ctx.testUserId,
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
        channel: 'app',
        language: 'en',
        brief_items: [],
        health_context: '',
        knowledge_context: '',
      });
      ctx.log(`lean-body status=${status} duration=${durationMs}ms rawText=${typeof data?.rawText === 'string' ? data.rawText.length : 'n/a'}`);
      expect2xx(status, 'naavi-chat (lean body)');
      if (typeof data?.rawText !== 'string' || data.rawText.length === 0) {
        throw new Error('lean-body call returned no rawText');
      }
    },
  },
  {
    id: 'smoke.transcribe-memo-deepgram',
    category: 'smoke',
    description: 'transcribe-memo rejects empty body cleanly (V57.9.5 Deepgram switch)',
    async run(ctx) {
      // Calling without audio or storage_path should return 400 with a
      // clear error — not a 5xx and not a hang.
      const { status, data, durationMs } = await adapters.call(ctx, 'transcribe-memo', {});
      ctx.log(`transcribe-memo empty-body status=${status} duration=${durationMs}ms err=${data?.error}`);
      if (status !== 400) throw new Error(`Expected 400 for empty body, got ${status}`);
      if (!data?.error || !/missing/i.test(data.error)) {
        throw new Error(`Expected "missing" error, got: ${JSON.stringify(data)}`);
      }
    },
  },
  {
    id: 'smoke.remote-log',
    category: 'smoke',
    description: 'remote-log accepts a sentinel diagnostic event (V57.9.2 instrumentation infra)',
    async run(ctx) {
      const { status, data, durationMs } = await adapters.call(ctx, 'remote-log', {
        session_id: `auto-tester-${Date.now()}`,
        step: 'auto-tester-sentinel',
        ms_since_start: 0,
        build_version: 'auto-tester',
      });
      ctx.log(`remote-log status=${status} duration=${durationMs}ms ok=${data?.ok}`);
      expect2xx(status, 'remote-log');
      if (data?.ok !== true) throw new Error('remote-log did not return ok:true');
    },
  },
];
