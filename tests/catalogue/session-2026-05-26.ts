/**
 * Session 2026-05-26 — regression coverage for B6a "one row per place".
 *
 * Tonight's work this suite locks in:
 *   - normalizePlaceName helper — pure unit test, verifies that spelling
 *     variants ("Movati Athletic, Orleans", "Movati Athletic Orleans",
 *     "movati athletic orleans") all normalize to the same canonical form.
 *
 * Companion tests live in:
 *   - tests/catalogue/data-integrity.ts —
 *       integrity.action-rules-disabled-rule-now-blocks-new (DB constraint)
 *       integrity.action-rules-re-arm-update-keeps-one-row   (UPDATE pattern)
 *
 * Coverage gaps acknowledged (Rule 15a exception):
 *   - The orchestrator-side re-arm flow (hooks/useOrchestrator.ts —
 *     reArmLocationRule + memory-hit + dup-check + commitPending sites) is
 *     React Native client code; not reachable from the auto-tester. The DB
 *     behavior side is fully covered above; the JS flow is verified by Wael
 *     on the next preview APK drive test.
 *
 * Run via `npm run test:auto`.
 */

import { expectEqual } from '../lib/assertions';
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
];
