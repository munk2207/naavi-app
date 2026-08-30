/**
 * B12k Stage 3c — bounded outbound calls.
 *
 * Governed by docs/B12K_PHASE3_TECHNICAL_REVIEW_2026-08-29.md §4c.
 *
 * Four calls in production ran 104, 110, 122 and 140 seconds. The caller hung
 * up every time and the answer reached nobody. Nothing on that path had a
 * timeout — 132 fetch calls in the voice server against 3 abort controllers,
 * none of them on the turn path. The bound is what stops that.
 *
 * ⭐ WHAT THIS SUITE NO LONGER TESTS, AND WHY — Wael's ruling, 2026-08-29.
 *
 * Four further tests existed here, covering an apparatus for what Naavi should
 * SAY when a bound fires: a sentinel, a list of unreachable sources, a
 * formatter, a prompt section, a spoken prefix, and a rule replacing her whole
 * answer on retrieval turns. All of it was removed from the voice server, and
 * those tests went with it.
 *
 * It existed to stop her saying "I don't have that information in your
 * records", read as a claim that the caller's records are empty. Wael ruled
 * that reading wrong: "if Naavi said I do not have the information, [it] does
 * not mean that Robert does not have the information or the information does
 * not exist, it simply means Naavi does not have the resources to answer."
 *
 * The sentence was honest all along — it describes her reach, not his data.
 * The apparatus solved a problem that was not there, and produced two of its
 * own on the way: a grammar bug, and a gate broad enough to replace a weather
 * answer with "I couldn't reach your saved notes."
 *
 * The line that WOULD still be false is one asserting the caller has nothing —
 * "you have no notes about that", "your records are empty". Nothing produces
 * such a line today. If one appears, that is the defect to test for, and it is
 * a claim about his data rather than about her reach.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const VOICE_PATH = join(process.cwd(), 'naavi-voice-server', 'src', 'index.js');

/** Lift the real helper out of the voice server so the test cannot drift from it. */
function loadBoundedFetch(): (label: string, url: string, opts?: any, ms?: number) => Promise<Response> {
  const src = readFileSync(VOICE_PATH, 'utf8');
  const m = src.match(/async function _b12kFetchBounded\([\s\S]*?\n\}/);
  if (!m) throw new Error('_b12kFetchBounded not found in voice server — renamed or removed');
  // The helper's default parameter references the module constant, so it is
  // declared here rather than stubbed — a wrong value would fail loudly.
  // eslint-disable-next-line no-eval
  return eval(`(() => { const B12K_FETCH_TIMEOUT_MS = 10000; ${m[0]}; return _b12kFetchBounded; })()`);
}

export const b12kBoundedCallsTests: TestCase[] = [
  {
    id: 'b12k.bounded.fires-against-a-server-that-never-responds',
    platform: 'voice',
    category: 'b12k',
    description: 'Stage 3c — the bound aborts a hung request instead of waiting forever',
    tags: ['voice', 'b12k', 'latency'],
    timeoutMs: 15_000,
    run: async () => {
      const boundedFetch = loadBoundedFetch();

      // A server that accepts the connection and then never answers — the
      // shape of the production stalls, where headers never arrived. This is
      // the injected-delay validation Phase 3 specified, and it needs no stall
      // to recur, which matters because none has since instrumentation landed.
      const server = createServer(() => { /* deliberately no response */ });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;

      try {
        const t0 = Date.now();
        let threw: any = null;
        try {
          await boundedFetch('test-hang', `http://127.0.0.1:${port}/`, {}, 400);
        } catch (err) {
          threw = err;
        }
        const elapsed = Date.now() - t0;

        expectTruthy(threw !== null, 'a hung request must throw rather than hang forever');
        expectTruthy(
          threw?.b12kTimeout === true,
          `the thrown error must be marked b12kTimeout so call sites can tell a bound from a real failure — got ${threw?.message}`,
        );
        expectTruthy(
          elapsed < 3000,
          `the bound must fire near its limit, not eventually — took ${elapsed}ms against a 400ms bound`,
        );
      } finally {
        server.close();
      }
    },
  },

  {
    id: 'b12k.bounded.three-call-sites-are-bounded',
    platform: 'voice',
    category: 'b12k',
    description: 'Stage 3c — the three authorized call sites use the bounded fetch',
    tags: ['voice', 'b12k'],
    run: async () => {
      const src = readFileSync(VOICE_PATH, 'utf8');
      for (const site of ['searchKnowledgeSpecific', 'LIST_RULES manage-rules', 'tts-play deepgram']) {
        expectTruthy(
          src.includes(`_b12kFetchBounded('${site}'`),
          `${site} must go through _b12kFetchBounded — it was one of the paths with no timeout when a turn ran 140 seconds`,
        );
      }
    },
  },
];
