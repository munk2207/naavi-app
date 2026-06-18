/**
 * Session 2026-06-17 — Build 261 + compound queue fix
 *
 * Covers:
 * 1. Compound queue: Phase 1 confirmation speech starts with "I'll take care of"
 *    and ends with "Say yes to go ahead, or no to cancel."
 * 2. Compound queue: pending_actions row stored via type='__COMPOUND__' + payload
 *    (not the missing `actions`/`expires_at` columns — that was the root cause of
 *    the compound queue silently failing on every prior run).
 * 3. Compound queue: Step 1.5 returns ALL sub-task actions at once on a single "yes"
 *    and produces narrated speech (First / Next / And last prefix per sub-task).
 * 4. Past-time rule: prompt contains the PAST-TIME RULE rejection instruction.
 * 5. Calendar 7-day window: voice server allDayUrl uses a 7-day upper bound
 *    (not the old 2-day window that hid June 18 birthday when fetched on June 16).
 * 6. Compound queue: confirmation speech does NOT say "Say yes to confirm all"
 *    (the old wording that confused users about what "yes" would do).
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
    description: 'Compound queue: Phase 1 speech says "I\'ll take care of these" and "Say yes to go ahead, or no to cancel."',
    tags: ['compound', 'queue'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes("I'll take care of these"),
        'Phase 1 confirmation speech missing "I\'ll take care of these" — wording regressed',
      );
      expectTruthy(
        src.includes('Say yes to go ahead, or no to cancel.'),
        'Phase 1 confirmation speech missing "Say yes to go ahead, or no to cancel." — wording regressed',
      );
    },
  },

  {
    id: 'compound.no-confirm-all-wording',
    description: 'Compound queue: old "Say yes to confirm all" wording is gone',
    tags: ['compound', 'queue'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        !src.includes('Say yes to confirm all'),
        'Old "Say yes to confirm all" wording still present — Phase 1 speech not updated',
      );
    },
  },

  {
    id: 'compound.storage-uses-payload-column',
    description: 'Compound queue: pending_actions insert uses type=__COMPOUND__ and payload column (not missing actions/expires_at columns)',
    tags: ['compound', 'queue'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes("type: '__COMPOUND__'") && src.includes("payload: { tasks:"),
        'Compound queue storage not using payload column with type=__COMPOUND__ — row insert will fail silently',
      );
      expectTruthy(
        !src.includes("onConflict: 'user_id'"),
        'Compound queue still uses upsert(onConflict:user_id) — pending_actions has no such unique constraint',
      );
    },
  },

  {
    id: 'compound.step1_5-returns-all-actions',
    description: 'Compound queue: Step 1.5 flattens all sub-task actions and returns narrated speech on a single yes',
    tags: ['compound', 'queue'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      // Narrated speech pattern: First / Next / And last
      expectTruthy(
        src.includes("'First'") && src.includes("'Next'") && src.includes("'And last'"),
        'Step 1.5 narrated speech (First/Next/And last) not found — one-at-a-time with separate confirmations may have regressed',
      );
      // All actions flattened in one shot
      expectTruthy(
        src.includes('flatMap(s => Array.isArray(s.actions)'),
        'Step 1.5 does not flatMap all sub-task actions — compound queue may not execute all items on a single yes',
      );
    },
  },

  {
    id: 'compound.step1_5-deletes-row-after-yes',
    description: 'Compound queue: Step 1.5 deletes the __COMPOUND__ pending_actions row after returning all actions',
    tags: ['compound', 'queue'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      // The delete is inside the Step 1.5 block, just before the console.log('[Step1.5]').
      // Slice 2000 chars ending at the [Step1.5] log line to capture it.
      const logIdx = src.indexOf('[Step1.5]');
      const step15Block = src.slice(Math.max(0, logIdx - 2000), logIdx + 200);
      expectTruthy(
        step15Block.includes('.delete()') && step15Block.includes("eq('id', compoundRow.id)"),
        'Step 1.5 does not delete the compound pending_actions row after execution — row will linger and misfire on next yes',
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
    description: 'Compound queue: Turn 2 fake-yes is skipped when Turn 1 speech is a clarifying question (prevents garbage SET_ACTION_RULE with no coordinates)',
    tags: ['compound', 'queue'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('isClarifyingQuestion') && src.includes("!isClarifyingQuestion"),
        'Compound queue Turn 2 skip guard for clarifying questions not present — unresolved tasks will generate incomplete actions',
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
