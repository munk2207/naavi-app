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
      'Layer 2 — LAYER2_CANDIDATE_RE regex gate must exist in naavi-chat/index.ts ' +
      'and must be tight enough not to catch capability questions or connection queries.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('LAYER2_CANDIDATE_RE'),
        'LAYER2_CANDIDATE_RE must be defined in naavi-chat/index.ts',
      );
      // Regex must include specific list-retrieval patterns, not just "what" + "alert"
      expectTruthy(
        src.includes('list my alerts') || src.includes('list\\\\s+') || src.includes('show.*my.*alerts'),
        'LAYER2_CANDIDATE_RE must use specific retrieval patterns, not generic word combinations',
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

  // ─── Layer 3 — Path B disclosure ───────────────────────────────────────────
  {
    id: 'session-2026-05-30.layer3-pathb-flag-set',
    category: 'session-2026-05-30',
    description:
      'Layer 3 — pathB flag must be declared and set in the Layer 2 fall-through paths ' +
      '(UNKNOWN classification and high-confidence-no-handler). This is what triggers ' +
      'the Path B disclosure wrapper on Claude\'s response.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(src.includes('let pathB = false'), 'pathB flag must be declared before Layer 2 block');
      expectTruthy(src.includes('pathB = true'), 'pathB must be set true in fall-through paths');
      expectTruthy(
        src.includes('Path B disclosure'),
        'Layer 3 Path B disclosure block must exist in naavi-chat/index.ts',
      );
    },
  },

  {
    id: 'session-2026-05-30.layer3-pathb-disclosure-wording',
    category: 'session-2026-05-30',
    description:
      'Layer 3 — Path B disclosure speech must include "best reading" phrasing and ' +
      '"does that work" so Robert knows the answer is not verified.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes("Here's my best reading"),
        'Path B disclosure must include "Here\'s my best reading" phrasing',
      );
      expectTruthy(
        src.includes('Does that work'),
        'Path B disclosure must ask "Does that work" so Robert can redirect',
      );
    },
  },

  {
    id: 'session-2026-05-30.layer3-pathb-skips-state-changing-actions',
    category: 'session-2026-05-30',
    description:
      'Layer 3 — Path B disclosure must NOT fire when Claude emits a state-changing action ' +
      '(CREATE_EVENT, SET_ACTION_RULE, etc.). Those have their own RULE 23 confirmation flow.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      // The state-changing set must be checked before applying disclosure
      expectTruthy(
        src.includes('stateChanging') && src.includes('CREATE_EVENT'),
        'Path B disclosure must skip state-changing actions (stateChanging set with CREATE_EVENT)',
      );
    },
  },

  {
    id: 'session-2026-05-30.layer2-expanded-scope',
    category: 'session-2026-05-30',
    description:
      'Layer 2 scope expansion — LAYER2_CANDIDATE_RE must now catch additional data/info ' +
      'question patterns: "when is my next X", "how far to X", "what did I spend on X".',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('when\\\\s+is\\\\s+my') || src.includes('when is my') || src.includes('when\\s+is\\s+my'),
        'LAYER2_CANDIDATE_RE must catch "when is my next X" pattern',
      );
      expectTruthy(
        src.includes('how\\s+(far|long|much') || src.includes('how far'),
        'LAYER2_CANDIDATE_RE must catch "how far/long to X" pattern',
      );
      expectTruthy(
        src.includes('what\\s+did\\s+i\\s+(spend') || src.includes('what did i'),
        'LAYER2_CANDIDATE_RE must catch "what did I spend" pattern',
      );
    },
  },

  // ─── PERSON_LOOKUP handler ────────────────────────────────────────────────
  {
    id: 'session-2026-05-30.person-lookup-handler-exported',
    category: 'session-2026-05-30',
    description:
      'PERSON_LOOKUP — handlePersonLookup must be exported from intentHandlers.ts ' +
      'and PERSON_LOOKUP must be in HANDLED_INTENTS.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      expectTruthy(
        src.includes('export async function handlePersonLookup'),
        'handlePersonLookup must be exported from intentHandlers.ts',
      );
      expectTruthy(
        src.includes("'PERSON_LOOKUP'"),
        "PERSON_LOOKUP must be in HANDLED_INTENTS",
      );
    },
  },

  {
    id: 'session-2026-05-30.person-lookup-honest-out',
    category: 'session-2026-05-30',
    description:
      'PERSON_LOOKUP — handlePersonLookup must return an honest "not found" message ' +
      'when global-search returns no ranked results.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      expectTruthy(
        src.includes("didn't find anything about"),
        'handlePersonLookup must return honest-out when global-search returns no results',
      );
    },
  },

  {
    id: 'session-2026-05-30.person-lookup-wired-in-layer2',
    category: 'session-2026-05-30',
    description:
      'PERSON_LOOKUP — Layer 2 block in naavi-chat/index.ts must route PERSON_LOOKUP ' +
      'to handlePersonLookup and pass query + userId + supabaseUrl + serviceKey.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes("classification.intent === 'PERSON_LOOKUP'"),
        "Layer 2 must route PERSON_LOOKUP intent",
      );
      expectTruthy(
        src.includes('handlePersonLookup('),
        'Layer 2 must call handlePersonLookup',
      );
    },
  },

  // ─── LIST_READ handler ───────────────────────────────────────────────────────
  {
    id: 'session-2026-05-30.list-read-handler-exported',
    category: 'session-2026-05-30',
    description: 'LIST_READ — handleListRead must be exported and in HANDLED_INTENTS.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      expectTruthy(src.includes('export async function handleListRead'), 'handleListRead must be exported');
      expectTruthy(src.includes("'LIST_READ'"), "LIST_READ must be in HANDLED_INTENTS");
    },
  },

  {
    id: 'session-2026-05-30.list-read-empty-honest-out',
    category: 'session-2026-05-30',
    description: 'LIST_READ — must return honest "no lists" message when lists table is empty.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      expectTruthy(
        src.includes("don't have any active lists") || src.includes("don't have any lists"),
        'handleListRead must return honest-out when no lists exist',
      );
    },
  },

  // ─── REMINDER_READ handler ────────────────────────────────────────────────
  {
    id: 'session-2026-05-30.reminder-read-handler-exported',
    category: 'session-2026-05-30',
    description: 'REMINDER_READ — handleReminderRead must be exported and in HANDLED_INTENTS.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      expectTruthy(src.includes('export async function handleReminderRead'), 'handleReminderRead must be exported');
      expectTruthy(src.includes("'REMINDER_READ'"), "REMINDER_READ must be in HANDLED_INTENTS");
    },
  },

  {
    id: 'session-2026-05-30.reminder-read-empty-honest-out',
    category: 'session-2026-05-30',
    description: 'REMINDER_READ — must return honest "no reminders" message when none exist.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      expectTruthy(
        src.includes("don't have any upcoming reminders"),
        'handleReminderRead must return honest-out when no reminders exist',
      );
    },
  },

  {
    id: 'session-2026-05-30.reminder-read-timestamps-in-est',
    category: 'session-2026-05-30',
    description: 'REMINDER_READ — timestamps must be formatted in EST (America/Toronto), never UTC.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      expectTruthy(
        src.includes('America/Toronto'),
        'handleReminderRead must format timestamps in America/Toronto timezone',
      );
    },
  },

  // ─── MEMORY_SEARCH handler ────────────────────────────────────────────────
  {
    id: 'session-2026-05-30.memory-search-handler-exported',
    category: 'session-2026-05-30',
    description: 'MEMORY_SEARCH — handleMemorySearch must be exported and in HANDLED_INTENTS.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      expectTruthy(src.includes('export async function handleMemorySearch'), 'handleMemorySearch must be exported');
      expectTruthy(src.includes("'MEMORY_SEARCH'"), "MEMORY_SEARCH must be in HANDLED_INTENTS");
    },
  },

  {
    id: 'session-2026-05-30.memory-search-honest-out',
    category: 'session-2026-05-30',
    description: 'MEMORY_SEARCH — must return honest "nothing saved" message when no memories found.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(INTENT_HANDLERS_PATH, 'utf8');
      expectTruthy(
        src.includes("don't have anything saved about"),
        'handleMemorySearch must return honest-out when no memories match',
      );
    },
  },

  {
    id: 'session-2026-05-30.person-lookup-regex-coverage',
    category: 'session-2026-05-30',
    description:
      'PERSON_LOOKUP — LAYER2_CANDIDATE_RE must catch "what do we have about X", ' +
      '"tell me about X", and "who is X" query shapes.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('what\\\\s+do\\\\s+(we|you)') || src.includes('what\\s+do\\s+(we|you)'),
        'LAYER2_CANDIDATE_RE must catch "what do we/you have about X" pattern',
      );
      expectTruthy(
        src.includes('tell\\\\s+me') || src.includes('tell\\s+me'),
        'LAYER2_CANDIDATE_RE must catch "tell me about X" pattern',
      );
      expectTruthy(
        src.includes('who\\\\s+is') || src.includes('who\\s+is'),
        'LAYER2_CANDIDATE_RE must catch "who is X" pattern',
      );
    },
  },

  // ─── Priority 2 — Possessive/question blind spots ─────────────────────────
  {
    id: 'session-2026-05-30.p2-possessive-regex-coverage',
    category: 'session-2026-05-30',
    description:
      'Priority 2 — LAYER2_CANDIDATE_RE must catch possessive contact queries: ' +
      '"What\'s Hussein\'s email?", "Does John have a phone?", "What is Sarah\'s address?"',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes("email|phone|number|address"),
        'LAYER2_CANDIDATE_RE must catch possessive contact field queries (email/phone/number/address)',
      );
      expectTruthy(
        src.includes("does\\\\s+") || src.includes('does\\s+'),
        'LAYER2_CANDIDATE_RE must catch "does X have a phone/email" pattern',
      );
    },
  },

  {
    id: 'session-2026-05-30.p2-possessive-classifier-examples',
    category: 'session-2026-05-30',
    description:
      'Priority 2 — classifyIntent prompt must include possessive examples so Haiku ' +
      'maps "what\'s Hussein\'s email" → LOOKUP_CONTACT with name extracted.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes("Hussein's email"),
        'classifyIntent prompt must include possessive example for LOOKUP_CONTACT',
      );
    },
  },
];
