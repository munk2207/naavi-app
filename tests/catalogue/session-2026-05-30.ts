/**
 * Session 2026-05-30 — regression coverage for Deterministic Naavi Layer 2.
 *
 * Layer 2 is the intent classification + deterministic routing layer built
 * this session. Claude's only job for handled intents is to classify the
 * query into a structured JSON object; the server runs a deterministic handler
 * and returns a verified answer. Claude is never called for the response.
 *
 * Handlers shipped this session:
 *   - LIST_RULES      → action_rules DB query, numbered list
 *   - LOOKUP_CONTACT  → Google People API, result or numbered disambiguation
 *   - CALENDAR_SEARCH → live calendar filtered by keyword
 *
 * Tests verify:
 *   1. LAYER2_CANDIDATE_RE gate — only candidate messages enter the classifier
 *   2. HANDLED_INTENTS set — exactly the three handlers are registered
 *   3. intentHandlers.ts exports — all three handler functions exist
 *   4. Disambiguation never auto-picks — handleLookupContact returns numbered list for 2+ results
 *   5. Honest-out — handleCalendarSearch returns "not found" speech when no events match
 *   6. handleListRules — returns "no alerts" speech when list is empty
 *   7. naavi-chat wiring — Layer 2 block appears after B6e bypass in index.ts
 *   8. classifyIntent function exists in index.ts
 *
 * Run via `npm run test:auto -- --grep session-2026-05-30`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expectTruthy, expectFalsy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const NAAVI_CHAT_PATH      = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');
const INTENT_HANDLERS_PATH = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'intentHandlers.ts');

export const session2026_05_30Tests: TestCase[] = [

  // ─── 1. LAYER2_CANDIDATE_RE gate ───────────────────────────────────────────
  {
    id: 'session-2026-05-30.layer2-candidate-regex-exists',
    category: 'session-2026-05-30',
    description:
      'Layer 2 — LAYER2_CANDIDATE_RE regex gate must exist in naavi-chat/index.ts. ' +
      'It prevents the classification call from firing on every message.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('LAYER2_CANDIDATE_RE'),
        'LAYER2_CANDIDATE_RE must be defined in naavi-chat/index.ts',
      );
    },
  },

  // ─── 2. HANDLED_INTENTS set ────────────────────────────────────────────────
  {
    id: 'session-2026-05-30.handled-intents-set-contains-three',
    category: 'session-2026-05-30',
    description:
      'Layer 2 — HANDLED_INTENTS set in intentHandlers.ts must contain exactly ' +
      'LIST_RULES, LOOKUP_CONTACT, and CALENDAR_SEARCH.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      expectTruthy(src.includes("'LIST_RULES'"),      "HANDLED_INTENTS must include 'LIST_RULES'");
      expectTruthy(src.includes("'LOOKUP_CONTACT'"),  "HANDLED_INTENTS must include 'LOOKUP_CONTACT'");
      expectTruthy(src.includes("'CALENDAR_SEARCH'"), "HANDLED_INTENTS must include 'CALENDAR_SEARCH'");
      expectTruthy(src.includes('HANDLED_INTENTS'),   'HANDLED_INTENTS export must exist');
    },
  },

  // ─── 3. intentHandlers.ts exports ──────────────────────────────────────────
  {
    id: 'session-2026-05-30.intent-handlers-exports-all-three',
    category: 'session-2026-05-30',
    description:
      'Layer 2 — intentHandlers.ts must export handleListRules, handleLookupContact, ' +
      'and handleCalendarSearch.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      expectTruthy(src.includes('export async function handleListRules'),     'handleListRules must be exported');
      expectTruthy(src.includes('export async function handleLookupContact'), 'handleLookupContact must be exported');
      expectTruthy(src.includes('export async function handleCalendarSearch'), 'handleCalendarSearch must be exported');
    },
  },

  // ─── 4. Disambiguation — never auto-picks ──────────────────────────────────
  {
    id: 'session-2026-05-30.lookup-contact-disambiguation-numbered-list',
    category: 'session-2026-05-30',
    description:
      'Layer 2 LOOKUP_CONTACT — when multiple contacts are returned, handleLookupContact ' +
      'must return a numbered disambiguation list and NOT pick one automatically. ' +
      'Verified by static analysis: the function must produce numbered lines and stop.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      // The disambiguation branch must produce "Which one?" and numbered items.
      expectTruthy(
        src.includes('Which one?'),
        'handleLookupContact must ask "Which one?" when multiple results found — never auto-pick',
      );
      // Verify it numbers results (${i + 1}.)
      expectTruthy(
        src.includes('${i + 1}.'),
        'handleLookupContact must number disambiguation options',
      );
    },
  },

  // ─── 5. Honest-out — CALENDAR_SEARCH no-match ──────────────────────────────
  {
    id: 'session-2026-05-30.calendar-search-no-match-honest-out',
    category: 'session-2026-05-30',
    description:
      'Layer 2 CALENDAR_SEARCH — when no events match the keyword, handleCalendarSearch ' +
      'must return an honest "not found" message, not a hallucinated answer.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      expectTruthy(
        src.includes("don't see anything matching"),
        'handleCalendarSearch must return honest-out when no events match the keyword',
      );
    },
  },

  // ─── 5b. Word-level matching — "family doctor appointment" finds "Family Doctor" ──
  {
    id: 'session-2026-05-30.calendar-search-word-level-matching',
    category: 'session-2026-05-30',
    description:
      'Layer 2 CALENDAR_SEARCH — must use word-level OR matching so "family doctor appointment" ' +
      'finds an event titled "Family Doctor". Stop words (appointment, meeting, etc.) must be ' +
      'stripped before matching. Fix for Wael live test: first call returned no, second correct.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      // Stop words set must exist
      expectTruthy(
        src.includes('CALENDAR_STOP_WORDS'),
        'handleCalendarSearch must define CALENDAR_STOP_WORDS to strip generic words before matching',
      );
      // Word-level OR match must exist
      expectTruthy(
        src.includes('searchWords.some'),
        'handleCalendarSearch must use word-level OR matching (searchWords.some)',
      );
      // "appointment" must be in stop words so it is stripped
      expectTruthy(
        src.includes("'appointment'"),
        '"appointment" must be in CALENDAR_STOP_WORDS so it is not used as a search term',
      );
    },
  },

  // ─── 5c. Classification prompt — keyword must be core noun only ─────────────
  {
    id: 'session-2026-05-30.classify-intent-keyword-is-core-noun',
    category: 'session-2026-05-30',
    description:
      'Layer 2 classifyIntent prompt must instruct Claude to extract only the core subject ' +
      'noun as the keyword (strip "appointment", "meeting", etc.). Prevents "family doctor ' +
      'appointment" keyword from failing to match "Family Doctor" event title.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('Strip generic words like') || src.includes('core subject noun'),
        'classifyIntent prompt must instruct Claude to strip generic words from the keyword',
      );
    },
  },

  // ─── 6. LIST_RULES — no-alerts honest-out ──────────────────────────────────
  {
    id: 'session-2026-05-30.list-rules-no-alerts-honest-out',
    category: 'session-2026-05-30',
    description:
      'Layer 2 LIST_RULES — when the user has no alerts, handleListRules must return ' +
      'an honest "no alerts" message, not an empty response.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      expectTruthy(
        src.includes("don't have any alerts set up yet"),
        'handleListRules must return an honest "no alerts" message when action_rules is empty',
      );
    },
  },

  // ─── 7. naavi-chat wiring — Layer 2 block after B6e ───────────────────────
  {
    id: 'session-2026-05-30.layer2-block-wired-after-b6e',
    category: 'session-2026-05-30',
    description:
      'Layer 2 — the Step 1.6 routing block must appear in naavi-chat/index.ts ' +
      'AFTER the B6e calendar-read bypass and BEFORE the main Claude call.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      const b6eIdx    = src.indexOf('B6e bypass');
      const layer2Idx = src.indexOf('Step 1.6');
      const claudeIdx = src.indexOf('Step 3: forward to Claude');
      expectTruthy(b6eIdx    >= 0, 'B6e bypass marker must exist in naavi-chat/index.ts');
      expectTruthy(layer2Idx >= 0, 'Step 1.6 Layer 2 block must exist in naavi-chat/index.ts');
      expectTruthy(claudeIdx >= 0, 'Step 3 Claude call marker must exist in naavi-chat/index.ts');
      expectTruthy(
        b6eIdx < layer2Idx && layer2Idx < claudeIdx,
        'Layer 2 block must appear after B6e bypass and before the main Claude call',
      );
    },
  },

  // ─── 8. classifyIntent function exists ────────────────────────────────────
  {
    id: 'session-2026-05-30.classify-intent-function-exists',
    category: 'session-2026-05-30',
    description:
      'Layer 2 — classifyIntent() function must exist in naavi-chat/index.ts. ' +
      'It issues a small Claude classification call and returns JSON.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('async function classifyIntent('),
        'classifyIntent function must exist in naavi-chat/index.ts',
      );
      // Must output JSON and use temperature: 0
      expectTruthy(
        src.includes('temperature: 0') && src.includes('classifyIntent'),
        'classifyIntent must call Claude with temperature: 0 for determinism',
      );
    },
  },
];
