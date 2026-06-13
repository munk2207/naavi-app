/**
 * Session 2026-06-13 — ARCH-1: Deterministic-first Naavi
 *
 * Verifies that:
 * 1. HANDLED_ACTION_INTENTS set is exported and contains all 8 action intents.
 * 2. Each action handler (exec) is exported from intentHandlers.ts.
 * 3. buildActionConfirm logic is present in index.ts (Level action routing block).
 * 4. Step 1.4 resolver in index.ts has cases for all 7 server-executed action intents.
 * 5. classifyIntent prompt contains action intent param extraction rules.
 * 6. classifyIntent max_tokens bumped to 200.
 *
 * Run via `npm run test:auto`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const HANDLERS_PATH = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'intentHandlers.ts');
const INDEX_PATH    = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');

export const session2026_06_13Tests: TestCase[] = [
  {
    id: 'arch1.handled-action-intents-exported',
    description: 'ARCH-1: HANDLED_ACTION_INTENTS set exported from intentHandlers.ts',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(HANDLERS_PATH, 'utf8');
      expectTruthy(src.includes('export const HANDLED_ACTION_INTENTS'), 'HANDLED_ACTION_INTENTS not exported');
    },
  },
  {
    id: 'arch1.handled-action-intents-contains-all',
    description: 'ARCH-1: HANDLED_ACTION_INTENTS contains all 8 action intents',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(HANDLERS_PATH, 'utf8');
      const required = ['SET_REMINDER', 'CREATE_EVENT', 'REMEMBER', 'DELETE_RULE', 'DELETE_MEMORY', 'ADD_CONTACT', 'DELETE_EVENT', 'DRAFT_MESSAGE'];
      for (const intent of required) {
        expectTruthy(src.includes(`'${intent}'`), `HANDLED_ACTION_INTENTS missing intent: ${intent}`);
      }
    },
  },
  {
    id: 'arch1.exec-handlers-exported',
    description: 'ARCH-1: all 7 server-executed action handler functions exported',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(HANDLERS_PATH, 'utf8');
      const fns = [
        'handleSetReminderExec',
        'handleCreateEventExec',
        'handleRememberExec',
        'handleDeleteRuleExec',
        'handleDeleteMemoryExec',
        'handleAddContactExec',
        'handleDeleteEventExec',
      ];
      for (const fn of fns) {
        expectTruthy(src.includes(`export async function ${fn}`), `Missing export: ${fn}`);
      }
    },
  },
  {
    id: 'arch1.correctDatetime-exported',
    description: 'ARCH-1: correctDatetime helper exported for timezone correction',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(HANDLERS_PATH, 'utf8');
      expectTruthy(src.includes('export function correctDatetime'), 'correctDatetime not exported');
    },
  },
  {
    id: 'arch1.index-imports-action-handlers',
    description: 'ARCH-1: index.ts imports HANDLED_ACTION_INTENTS and all exec handlers',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      const imports = ['HANDLED_ACTION_INTENTS', 'handleSetReminderExec', 'handleCreateEventExec', 'handleRememberExec', 'handleDeleteRuleExec', 'handleDeleteMemoryExec', 'handleAddContactExec', 'handleDeleteEventExec'];
      for (const name of imports) {
        expectTruthy(src.includes(name), `index.ts missing import: ${name}`);
      }
    },
  },
  {
    id: 'arch1.buildActionConfirm-present',
    description: 'ARCH-1: buildActionConfirm function present in index.ts',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(src.includes('function buildActionConfirm'), 'buildActionConfirm missing');
    },
  },
  {
    id: 'arch1.level-action-routing-present',
    description: 'ARCH-1: Level action routing block in index.ts routes known intents without Claude',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(src.includes("classification.level === 'action' && HANDLED_ACTION_INTENTS.has"), 'Level action routing block missing');
      expectTruthy(src.includes('Deterministic action — skip Claude entirely'), 'Level action routing comment missing');
    },
  },
  {
    id: 'arch1.step1-4-action-cases-present',
    description: 'ARCH-1: Step 1.4 resolver has cases for all 7 server-executed action intents',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      const intents = ["'SET_REMINDER'", "'CREATE_EVENT'", "'REMEMBER'", "'DELETE_RULE'", "'DELETE_MEMORY'", "'ADD_CONTACT'", "'DELETE_EVENT'"];
      for (const intent of intents) {
        expectTruthy(src.includes(`pending.intent === ${intent}`), `Step 1.4 resolver missing case: ${intent}`);
      }
    },
  },
  {
    id: 'arch1.classifier-prompt-has-action-intents',
    description: 'ARCH-1: classifyIntent prompt includes action intent param extraction rules',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(src.includes('SET_REMINDER → title'), 'classifyIntent missing SET_REMINDER params');
      expectTruthy(src.includes('CREATE_EVENT → summary'), 'classifyIntent missing CREATE_EVENT params');
      expectTruthy(src.includes('REMEMBER → text'), 'classifyIntent missing REMEMBER params');
      expectTruthy(src.includes('DELETE_RULE → match'), 'classifyIntent missing DELETE_RULE params');
      expectTruthy(src.includes('DELETE_MEMORY → keyword'), 'classifyIntent missing DELETE_MEMORY params');
      expectTruthy(src.includes('ADD_CONTACT → name'), 'classifyIntent missing ADD_CONTACT params');
      expectTruthy(src.includes('DRAFT_MESSAGE → to_name'), 'classifyIntent missing DRAFT_MESSAGE params');
      expectTruthy(src.includes('DELETE_EVENT → query'), 'classifyIntent missing DELETE_EVENT params');
    },
  },
  {
    id: 'arch1.classifier-max-tokens-200',
    description: 'ARCH-1: classifyIntent max_tokens bumped to 200 for action param extraction',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(src.includes('max_tokens: 200'), 'classifyIntent max_tokens not 200');
    },
  },
  {
    id: 'arch1.set-reminder-exec-phone-lookup',
    description: 'ARCH-1: handleSetReminderExec looks up user phone for reminder fan-out',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(HANDLERS_PATH, 'utf8');
      expectTruthy(src.includes("'user_settings'") && src.includes("select('phone')"), 'handleSetReminderExec missing phone lookup from user_settings');
    },
  },
  {
    id: 'arch1.draft-message-emits-action-immediately',
    description: 'ARCH-1: DRAFT_MESSAGE emits action immediately (DraftCard is confirm UI), no PENDING_INTENT',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(src.includes("intent === 'DRAFT_MESSAGE'") && src.includes('DraftCard is the confirm UI'), 'DRAFT_MESSAGE path missing or missing DraftCard comment');
    },
  },
];
