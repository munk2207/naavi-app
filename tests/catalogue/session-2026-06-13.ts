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
    description: 'ARCH-1: HANDLED_ACTION_INTENTS contains all 9 action intents (including SET_ACTION_RULE)',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(HANDLERS_PATH, 'utf8');
      const required = ['SET_REMINDER', 'CREATE_EVENT', 'REMEMBER', 'DELETE_RULE', 'DELETE_MEMORY', 'ADD_CONTACT', 'DELETE_EVENT', 'DRAFT_MESSAGE', 'SET_ACTION_RULE'];
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
    id: 'arch1.set-reminder-suppress-calendar-notifications',
    description: 'ARCH-1: handleSetReminderExec passes suppress_reminders:true so Google Calendar does not fire its own notifications',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(HANDLERS_PATH, 'utf8');
      expectTruthy(src.includes('suppress_reminders: true'), 'handleSetReminderExec must pass suppress_reminders:true to create-calendar-event');
    },
  },
  {
    id: 'arch1.create-calendar-event-honors-suppress-reminders',
    description: 'ARCH-1: create-calendar-event EF reads suppress_reminders and sets useDefault:false when true',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(
        join(process.cwd(), 'supabase', 'functions', 'create-calendar-event', 'index.ts'),
        'utf8',
      );
      expectTruthy(src.includes('suppress_reminders'), 'create-calendar-event must read suppress_reminders param');
      expectTruthy(src.includes('useDefault: false'), 'create-calendar-event must set useDefault:false when suppress_reminders');
    },
  },
  {
    id: 'arch1.set-action-rule-in-handled-intents',
    description: 'ARCH-1: SET_ACTION_RULE is in HANDLED_ACTION_INTENTS for deterministic email confirm path',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(HANDLERS_PATH, 'utf8');
      expectTruthy(src.includes("'SET_ACTION_RULE'"), 'HANDLED_ACTION_INTENTS must contain SET_ACTION_RULE');
    },
  },
  {
    id: 'arch1.build-action-confirm-set-action-rule-email',
    description: 'ARCH-1: buildActionConfirm generates confirm speech for email SET_ACTION_RULE',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(src.includes("case 'SET_ACTION_RULE':"), 'buildActionConfirm missing SET_ACTION_RULE case');
      expectTruthy(src.includes("trigger_type === 'email'") || src.includes("tt === 'email'"), 'SET_ACTION_RULE case must handle email trigger');
      expectTruthy(src.includes('subject_keyword'), 'SET_ACTION_RULE email confirm must use subject_keyword param');
    },
  },
  {
    id: 'arch1.step1-4-set-action-rule-case',
    description: 'ARCH-1: Step 1.4 resolver has SET_ACTION_RULE case emitting action for mobile',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(src.includes("pending.intent === 'SET_ACTION_RULE'"), 'Step 1.4 missing SET_ACTION_RULE case');
    },
  },
  {
    id: 'arch1.email-trigger-from-anyone',
    description: 'evaluate-rules email trigger fires even when no from/subject specified (alert on any email)',
    tags: ['arch1', 'evaluate-rules'],
    run: async () => {
      const src = readFileSync(
        join(process.cwd(), 'supabase', 'functions', 'evaluate-rules', 'index.ts'),
        'utf8',
      );
      expectTruthy(
        !src.includes('!fromName && !fromEmail && !subjectKeyword') ,
        'early-return guard must be removed so "alert on any email" rules can fire',
      );
    },
  },
  {
    id: 'arch1.email-trigger-and-logic',
    description: 'evaluate-rules email trigger uses AND (from+subject both must match, not OR)',
    tags: ['arch1', 'evaluate-rules'],
    run: async () => {
      const src = readFileSync(
        join(process.cwd(), 'supabase', 'functions', 'evaluate-rules', 'index.ts'),
        'utf8',
      );
      expectTruthy(src.includes('fromResult && subjectResult'), 'email trigger must use AND logic (fromResult && subjectResult)');
      expectTruthy(!src.includes('nameMatch || emailMatch || subjectMatch'), 'OR logic must be removed from email trigger match');
    },
  },
  {
    id: 'arch1.location-action-one-shot-default',
    description: 'ARCH-1: SET_ACTION_RULE(location) from buildActionConfirm includes one_shot:true by default',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(src.includes('one_shot'), 'buildActionConfirm SET_ACTION_RULE(location) must set one_shot');
    },
  },
  {
    id: 'arch1.check-reminders-reads-channel-prefs',
    description: 'check-reminders reads alert_channels_enabled and gates each channel',
    tags: ['arch1', 'reminder'],
    run: async () => {
      const src = readFileSync(
        join(process.cwd(), 'supabase', 'functions', 'check-reminders', 'index.ts'),
        'utf8',
      );
      expectTruthy(src.includes('alert_channels_enabled'), 'check-reminders must read alert_channels_enabled');
      expectTruthy(src.includes("channelEnabled('sms')"), 'check-reminders must gate SMS on channelEnabled');
      expectTruthy(src.includes("channelEnabled('whatsapp')"), 'check-reminders must gate WhatsApp on channelEnabled');
      expectTruthy(src.includes("channelEnabled('email')"), 'check-reminders must gate Email on channelEnabled');
      expectTruthy(src.includes("channelEnabled('push')"), 'check-reminders must gate Push on channelEnabled');
      expectTruthy(src.includes("channelEnabled('voice_call')"), 'check-reminders must gate voice call on channelEnabled');
    },
  },
  {
    id: 'arch1.check-reminders-voice-call-fan-out',
    description: 'check-reminders includes voice call in fan-out via /speak-alert (not just priority path)',
    tags: ['arch1', 'reminder'],
    run: async () => {
      const src = readFileSync(
        join(process.cwd(), 'supabase', 'functions', 'check-reminders', 'index.ts'),
        'utf8',
      );
      expectTruthy(src.includes('speak-alert'), 'check-reminders must use speak-alert for voice call');
      expectTruthy(src.includes('prepare-alert'), 'check-reminders must pre-generate TTS before dialing');
    },
  },
  {
    id: 'arch1.draft-message-emits-action-immediately',
    description: 'ARCH-1: DRAFT_MESSAGE emits action immediately (DraftCard is confirm UI), no PENDING_INTENT',
    tags: ['arch1', 'deterministic'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      // DRAFT_MESSAGE returns actions[] from buildActionConfirm; routing block emits immediately
      // when confirmed.actions.length > 0. DraftCard comment lives in buildActionConfirm header.
      expectTruthy(src.includes("case 'DRAFT_MESSAGE':"), 'DRAFT_MESSAGE case missing from buildActionConfirm');
      expectTruthy(src.includes('DraftCard is the confirm UI'), 'DraftCard comment missing');
      expectTruthy(src.includes('confirmed.actions.length > 0'), 'Immediate-emit branch missing for actions-bearing intents');
    },
  },
  // F5c — Executable tasks on alert fire
  {
    id: 'f5c.orchestrator-resolve-task-actions-present',
    description: 'F5c: resolveTaskActions helper in useOrchestrator.ts parses text/email task strings',
    tags: ['f5c', 'location'],
    run: async () => {
      const src = readFileSync(join(process.cwd(), 'hooks', 'useOrchestrator.ts'), 'utf8');
      expectTruthy(src.includes('resolveTaskActions'), 'resolveTaskActions helper missing from useOrchestrator.ts');
      expectTruthy(src.includes('TASK_SMS_RE'), 'TASK_SMS_RE pattern missing');
      expectTruthy(src.includes('TASK_EMAIL_RE'), 'TASK_EMAIL_RE pattern missing');
      expectTruthy(src.includes("type: 'send_sms'"), "task_actions type 'send_sms' missing");
      expectTruthy(src.includes("type: 'send_email'"), "task_actions type 'send_email' missing");
    },
  },
  {
    id: 'f5c.orchestrator-injects-task-actions-into-action-config',
    description: 'F5c: commitPending in useOrchestrator.ts injects task_actions into action_config before insert',
    tags: ['f5c', 'location'],
    run: async () => {
      const src = readFileSync(join(process.cwd(), 'hooks', 'useOrchestrator.ts'), 'utf8');
      expectTruthy(src.includes('resolvedTaskActions'), 'resolvedTaskActions missing from commitPending');
      expectTruthy(src.includes('task_actions: resolvedTaskActions'), 'task_actions not merged into action_config');
      expectTruthy(src.includes('actionConfigWithTasks'), 'actionConfigWithTasks merge object missing');
    },
  },
  {
    id: 'f5c.evaluate-rules-executes-task-actions',
    description: 'F5c: evaluate-rules fireAction executes task_actions after main fan-out',
    tags: ['f5c', 'evaluate-rules'],
    run: async () => {
      const src = readFileSync(
        join(process.cwd(), 'supabase', 'functions', 'evaluate-rules', 'index.ts'),
        'utf8',
      );
      expectTruthy(src.includes('task_actions'), 'evaluate-rules missing task_actions execution');
      expectTruthy(src.includes("ta.type === 'send_sms'"), 'evaluate-rules missing send_sms task execution');
      expectTruthy(src.includes("ta.type === 'send_email'"), 'evaluate-rules missing send_email task execution');
      expectTruthy(src.includes('alert_task'), 'task executions should use source: alert_task');
    },
  },
  // RULE 26 — Time-anchor split
  {
    id: 'rule26.time-anchor-split-prompt-present',
    description: 'RULE 26: get-naavi-prompt contains time-anchor split rule (immediate vs future-bound actions)',
    tags: ['rule26', 'prompt'],
    run: async () => {
      const src = readFileSync(
        join(process.cwd(), 'supabase', 'functions', 'get-naavi-prompt', 'index.ts'),
        'utf8',
      );
      expectTruthy(src.includes('RULE 26'), 'RULE 26 missing from get-naavi-prompt');
      expectTruthy(src.includes('TIME-ANCHOR SPLIT') || src.includes('time-anchor'), 'RULE 26 must be about time-anchor splitting');
      expectTruthy(src.includes('external recipient'), 'RULE 26 must reference external recipient as split signal');
      expectTruthy(src.includes('v112-narrate-before-tool') || src.includes('v111-time-alert-third-party-sends'), 'PROMPT_VERSION must be v111 or later');
    },
  },
  // RULE 25 — Context enrichment
  {
    id: 'rule25.context-enrichment-prompt-present',
    description: 'RULE 25: get-naavi-prompt contains context enrichment rule (carry setup into action)',
    tags: ['rule25', 'prompt'],
    run: async () => {
      const src = readFileSync(
        join(process.cwd(), 'supabase', 'functions', 'get-naavi-prompt', 'index.ts'),
        'utf8',
      );
      expectTruthy(src.includes('RULE 25'), 'RULE 25 missing from get-naavi-prompt');
      expectTruthy(src.includes('context enrichment') || src.includes('CONTEXT ENRICHMENT'), 'RULE 25 must be about context enrichment');
      expectTruthy(src.includes('action verb must be present'), 'RULE 25 must require explicit action verb');
      expectTruthy(src.includes('RULE 25'), 'RULE 25 must still be present in prompt');
    },
  },
];
