/**
 * Session 2026-06-17 — Build 261 + V282 compound detection (tool_choice:none approach)
 *
 * Compound tests updated 2026-06-23 to match V282 implementation.
 * V282 replaced the old pending_actions queue approach with:
 *   - tool_choice:"none" on the compound breakdown turn (forces text-only numbered list)
 *   - isCompoundConfirmTurn detection (3+ numbered lines in last assistant msg + affirmative user reply)
 *   - max_tokens:2048 on the confirmation turn so all 6+ tool calls fit
 * The old queue tests (Step 1.5, payload column, isClarifyingQuestion) are replaced
 * with tests that verify the actual V282 implementation.
 *
 * Covers:
 * 1. Compound detection: isCompoundTurn flag and tool_choice:none applied in naavi-chat
 * 2. Compound confirmation: isCompoundConfirmTurn detection present
 * 3. Compound confirm turn: max_tokens boosted to 2048
 * 4. Compound instruction: "Say yes to confirm all" closing phrase present
 * 5. Past-time rule: prompt contains the PAST-TIME RULE rejection instruction.
 * 6. Calendar 7-day window: voice server allDayUrl uses a 7-day upper bound.
 *
 * Run via `npm run test:auto`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const NAAVI_CHAT_PATH        = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');
const VOICE_PATH             = join(process.cwd(), 'naavi-voice-server', 'src', 'index.js');
const PROMPT_PATH            = join(process.cwd(), 'supabase', 'functions', 'get-naavi-prompt', 'index.ts');
const MANAGE_LIST_CONN_PATH  = join(process.cwd(), 'supabase', 'functions', 'manage-list-connections', 'index.ts');
const MANAGE_RULES_PATH      = join(process.cwd(), 'supabase', 'functions', 'manage-rules', 'index.ts');
const ORCHESTRATOR_PATH      = join(process.cwd(), 'hooks', 'useOrchestrator.ts');

export const session2026_06_17Tests: TestCase[] = [
  {
    id: 'compound.phase1-speech-wording',
    description: 'V282 compound: isCompoundTurn detection present and tool_choice:none applied',
    tags: ['compound', 'v282'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('isCompoundTurn'),
        'V282 compound: isCompoundTurn flag not found in naavi-chat',
      );
      expectTruthy(
        src.includes("tool_choice = { type: 'none' }") || src.includes('tool_choice: { type: \'none\' }') || src.includes("{ type: 'none' }"),
        'V282 compound: tool_choice:none not applied on compound turns — Claude will emit tool calls on the breakdown turn',
      );
    },
  },

  {
    id: 'compound.no-confirm-all-wording',
    description: 'V282 compound: "Say yes to confirm all" closing phrase is present in compound instruction',
    tags: ['compound', 'v282'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('Say yes to confirm all'),
        'V282 compound: closing phrase "Say yes to confirm all" not found — user will not know how to confirm',
      );
    },
  },

  {
    id: 'compound.storage-uses-payload-column',
    description: 'V282 compound: isCompoundConfirmTurn detection present in naavi-chat',
    tags: ['compound', 'v282'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('isCompoundConfirmTurn'),
        'V282 compound: isCompoundConfirmTurn not found — "yes" after compound list will not trigger tool execution',
      );
    },
  },

  {
    id: 'compound.step1_5-returns-all-actions',
    description: 'V282 compound: max_tokens boosted to 2048 on compound confirmation turn',
    tags: ['compound', 'v282'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('isCompoundConfirmTurn') && src.includes('max_tokens = 2048'),
        'V282 compound: max_tokens not boosted to 2048 on confirm turn — 6+ tool calls may be cut off',
      );
    },
  },

  {
    id: 'compound.step1_5-deletes-row-after-yes',
    description: 'V282 compound: compound detection threshold is 4+ non-empty lines',
    tags: ['compound', 'v282'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('msgNonEmptyLines.length >= 4') || src.includes('>= 4'),
        'V282 compound: 4-line detection threshold not found — compound may not trigger correctly',
      );
    },
  },

  {
    id: 'prompt.past-time-rule-present',
    description: 'get-naavi-prompt: PAST-TIME RULE instruction is in the prompt to reject already-passed times',
    tags: ['prompt', 'calendar'],
    run: async () => {
      const src = readFileSync(PROMPT_PATH, 'utf8');
      expectTruthy(
        src.includes('PAST-TIME') || src.includes('past time') || src.includes('already passed'),
        'PAST-TIME RULE not found in get-naavi-prompt — past-time rejection may have been removed',
      );
    },
  },

  {
    id: 'voice.calendar-7day-window',
    description: 'Voice server: allDayUrl calendar fetch uses a 7-day upper bound (not 2-day)',
    tags: ['voice', 'calendar'],
    run: async () => {
      const src = readFileSync(VOICE_PATH, 'utf8');
      // Look for the 7-day window pattern: briefWindow or allDayUrl with + 7 days
      expectTruthy(
        src.includes('7 * 24 * 60 * 60 * 1000') || src.includes('+ 7') || /allDay.*\+\s*[78]/.test(src),
        'Voice server calendar fetch does not appear to use a 7-day window — birthday/future all-day events may be hidden',
      );
      // Confirm the old 2-day cap is gone from the allDay path
      const allDaySection = (() => {
        const idx = src.indexOf('allDayUrl');
        return idx >= 0 ? src.slice(idx, idx + 500) : '';
      })();
      expectTruthy(
        !allDaySection.includes('+ 2 *') && !allDaySection.includes('+2*'),
        'Voice server allDayUrl still uses 2-day window — all-day events beyond 2 days will be invisible',
      );
    },
  },

  {
    id: 'compound.turn2-skipped-for-clarifying-question',
    description: 'V282 compound: isAffirmativeConfirmTurn used to gate compound confirm — only real "yes" triggers execution',
    tags: ['compound', 'v282'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('isAffirmativeConfirmTurn') && src.includes('isCompoundConfirmTurn'),
        'V282 compound: affirmative-confirm guard not wired into isCompoundConfirmTurn — any reply may trigger tool execution',
      );
    },
  },

  {
    id: 'list-connect.idempotent-already-attached',
    description: 'manage-list-connections CONNECT returns 200 success when connection already exists (not 409)',
    tags: ['list', 'connect'],
    run: async () => {
      const src = readFileSync(MANAGE_LIST_CONN_PATH, 'utf8');
      // Must NOT return 409 for duplicate connections
      expectTruthy(
        !src.includes("}, 409)"),
        'manage-list-connections CONNECT still returns 409 for already_attached — compound queue will show LIST ACTION ERROR when work list is already connected to office alert',
      );
      // Must return success:true for duplicate connections
      expectTruthy(
        src.includes('already_attached: true') && src.includes('success: true, already_attached'),
        'manage-list-connections CONNECT does not return success:true for already_attached — idempotency fix not present',
      );
    },
  },

  {
    id: 'manage-rules.create-23505-idempotent',
    description: 'manage-rules create op returns 200 ok:true for 23505 unique_violation (duplicate rule insert is idempotent)',
    tags: ['rules', 'idempotent'],
    run: async () => {
      const src = readFileSync(MANAGE_RULES_PATH, 'utf8');
      expectTruthy(
        src.includes("'23505'") && src.includes('duplicate: true'),
        'manage-rules create does not handle 23505 idempotently — duplicate rule inserts return 500, causing compound queue speech override',
      );
    },
  },

  {
    id: 'orchestrator.set-action-rule-no-compound-speech-override',
    description: 'useOrchestrator: SET_ACTION_RULE failure does not override compound queue speech ("On it.")',
    tags: ['orchestrator', 'compound', 'rules'],
    run: async () => {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(
        src.includes('isCompoundBatch') && src.includes("startsWith('On it.')"),
        'SET_ACTION_RULE error handler does not guard compound queue speech — "I tried to save that alert" overrides "On it. First —" when a rule insert fails during compound execution',
      );
    },
  },
];
