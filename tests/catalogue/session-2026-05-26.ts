/**
 * Session 2026-05-26 — regression coverage for B6a "one row per place"
 * AND B6e "calendar-read bypass".
 *
 * B6a tests (existing):
 *   - normalizePlaceName helper — pure unit test, verifies that spelling
 *     variants ("Movati Athletic, Orleans", "Movati Athletic Orleans",
 *     "movati athletic orleans") all normalize to the same canonical form.
 *   - Companion tests in tests/catalogue/data-integrity.ts —
 *       integrity.action-rules-disabled-rule-now-blocks-new (DB constraint)
 *       integrity.action-rules-re-arm-update-keeps-one-row   (UPDATE pattern)
 *
 * B6e tests (added 2026-05-26 night):
 *   - "What is on my calendar this week?" routes through the pre-Claude
 *     bypass — verifies no LIST_READ / LIST_RULES / GLOBAL_SEARCH actions
 *     are emitted (the failing-mode tools captured live 2026-05-26 via
 *     b6e-diag instrumentation). Non-empty speech proves the bypass shipped
 *     a real response.
 *
 * Coverage gaps acknowledged (Rule 15a exception):
 *   - The orchestrator-side re-arm flow (hooks/useOrchestrator.ts —
 *     reArmLocationRule + memory-hit + dup-check + commitPending sites) is
 *     React Native client code; not reachable from the auto-tester. The DB
 *     behavior side is fully covered above; the JS flow is verified by Wael
 *     on the next preview APK drive test.
 *   - The bypass intent-detector + window-filter + response-builder helpers
 *     live inside the naavi-chat Edge Function (Deno) and can't be imported
 *     into Node tests. Behaviorally covered via the round-trip test below.
 *
 * Run via `npm run test:auto`.
 */

import { adapters } from '../lib/adapters';
import {
  expect2xx,
  expectEqual,
  expectFalsy,
  expectTruthy,
  findActionInRawText,
  extractSpeech,
} from '../lib/assertions';
import type { TestCase } from '../lib/types';
import { normalizePlaceName } from '../../lib/normalizePlaceName';

export const session2026_05_26Tests: TestCase[] = [
  {
    id: 'b6a.normalize-place-name-handles-comma-and-case',
    category: 'b6a',
    description: 'B6a — normalizePlaceName collapses spelling variants of the same place. "Movati Athletic, Orleans" ≡ "Movati Athletic Orleans" ≡ "movati athletic orleans" — strips commas and lowercases.',
    timeoutMs: 1_000,
    async run() {
      const canonical = normalizePlaceName('movati athletic orleans');
      expectEqual(normalizePlaceName('Movati Athletic, Orleans'), canonical, 'comma stripped, lowercased');
      expectEqual(normalizePlaceName('Movati Athletic Orleans'),  canonical, 'plain spelling, lowercased');
      expectEqual(normalizePlaceName('  MOVATI ATHLETIC ORLEANS  '), canonical, 'leading/trailing whitespace + uppercase');
      expectEqual(normalizePlaceName('Movati  Athletic   Orleans'), canonical, 'collapsed multi-space');
    },
  },
  {
    id: 'b6a.normalize-place-name-strips-apostrophe',
    category: 'b6a',
    description: "B6a — normalizePlaceName strips apostrophes so \"Tim Horton's\" matches \"Tim Hortons\". STT sometimes inserts apostrophes; both should hit the same existing row.",
    timeoutMs: 1_000,
    async run() {
      const canonical = normalizePlaceName('tim hortons');
      expectEqual(normalizePlaceName("Tim Horton's"), canonical, 'curly-quote-free apostrophe stripped');
      expectEqual(normalizePlaceName('Tim Horton’s'), canonical, 'right single quotation mark stripped');
      expectEqual(normalizePlaceName('TIM HORTONS'), canonical, 'no apostrophe variant');
    },
  },
  {
    id: 'b6a.normalize-place-name-empty-and-noise',
    category: 'b6a',
    description: 'B6a — normalizePlaceName handles empty, whitespace-only, and punctuation-only inputs without throwing. Defensive shape.',
    timeoutMs: 1_000,
    async run() {
      expectEqual(normalizePlaceName(''),         '', 'empty string');
      expectEqual(normalizePlaceName('   '),      '', 'whitespace-only');
      expectEqual(normalizePlaceName(',,, !!!'),  '', 'punctuation-only collapses to empty');
      expectEqual(normalizePlaceName(undefined as any), '', 'undefined coerced safely');
      expectEqual(normalizePlaceName(null as any),      '', 'null coerced safely');
    },
  },
  {
    id: 'b6e.calendar-read-bypass-this-week',
    category: 'b6e',
    description: 'B6e — "What is on my calendar this week?" pre-Claude bypass: zero LIST_READ / LIST_RULES / GLOBAL_SEARCH actions, non-empty speech. Live failure modes captured 2026-05-26 were list_read(naavi) and list_rules(alert); both are blocked structurally by the bypass.',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'What is on my calendar this week?' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const rt = data?.rawText ?? '';
      ctx.log(`rawText: ${rt.slice(0, 300)}…`);

      expectFalsy(findActionInRawText(rt, 'LIST_READ'),
        'no LIST_READ action — the bug class captured live 2026-05-26 at 11:24 PM EST');
      expectFalsy(findActionInRawText(rt, 'LIST_RULES'),
        'no LIST_RULES action — the bug class captured live 2026-05-26 at 11:25 PM EST');
      expectFalsy(findActionInRawText(rt, 'GLOBAL_SEARCH'),
        'no GLOBAL_SEARCH action — calendar read is answered from brief, never searched');

      const speech = extractSpeech(rt);
      expectTruthy(speech.length > 0,
        `speech must be non-empty; got: "${speech.slice(0, 200)}"`);
    },
  },
];
