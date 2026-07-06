/**
 * Session 2026-07-05 — F12 Defect B: memory-hit dedup dropped destination changes.
 *
 * The "you already have one" location-alert memory-hit path only checked
 * tasks/list_name/body for merge-worthiness — a changed recipient (`to`,
 * `to_name`, `to_email`, `to_phone`) was invisible to the check and got
 * silently discarded, on both mobile and voice. Reproduced live on a real
 * production call this session ("email me at X when I arrive at Bob's
 * home" twice, second attempt's destination was dropped).
 *
 * Fix: recipientChanged is now part of the merge-worthiness check on both
 * surfaces, manage-rules::merge_tasks accepts recipient fields, and the
 * disabled-rule re-arm path on mobile now actually passes action_config
 * through (previously called with no 3rd argument at all).
 *
 * See docs/F12_PHASE1_PROBLEM_DEFINITION_2026-07-05.md and
 * docs/F12_PHASE2_CHANGE_PLAN_2026-07-05.md §5.
 *
 * These are source-assertion tests (same pattern as
 * session-2026-07-03-f2b-reminder-label.ts) — they confirm the fix code
 * exists and is shaped correctly, not a live end-to-end call.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const ORCHESTRATOR_PATH  = join(process.cwd(), 'hooks', 'useOrchestrator.ts');
const VOICE_SERVER_PATH  = join(process.cwd(), 'naavi-voice-server', 'src', 'index.js');
const MANAGE_RULES_PATH  = join(process.cwd(), 'supabase', 'functions', 'manage-rules', 'index.ts');

export const session2026_07_05_f12DefectBTests: TestCase[] = [
  {
    id: 'f12.mobile-memory-hit-detects-recipient-change',
    category: 'location',
    description: 'mobile location memory-hit merge-check treats a changed recipient as new content, not just tasks/list_name/body',
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(
        src.includes('const recipientChanged = newTo.length > 0 && newTo.toLowerCase() !== existingToKey;'),
        'hasNewContent check must compute recipientChanged by comparing the new action_config.to against the existing rule\'s destination fields',
      );
      expectTruthy(
        src.includes('const hasNewContent = newTasks.length > 0 || newListName || newBody || recipientChanged;'),
        'hasNewContent must include recipientChanged — old bug: only tasks/list_name/body were checked, a changed destination was silently dropped',
      );
    },
  },
  {
    id: 'f12.mobile-rearm-passes-action-config',
    category: 'location',
    description: 'mobile disabled-rule re-arm path passes action_config through to reArmLocationRule (previously called with no 3rd argument)',
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(
        src.includes('const armResult = await reArmLocationRule(supabase!, match, {\n                          action_config: action.action_config as Record<string, any> | undefined,\n                        });'),
        'reArmLocationRule must be called with an action_config-bearing 3rd argument on the disabled-rule branch — old bug: called with no 3rd arg, so a re-armed rule could never pick up a new destination',
      );
    },
  },
  {
    id: 'f12.voice-memory-hit-detects-recipient-change',
    category: 'location',
    description: 'voice location memory-hit merge-check treats a changed recipient as new content, not just body',
    async run() {
      const src = readFileSync(VOICE_SERVER_PATH, 'utf8');
      expectTruthy(
        src.includes('const recipientChanged = !!(newTo && newTo.toLowerCase() !== existingToKey);'),
        'voice enabled-rule branch must compute recipientChanged — old bug: only body was diffed, a changed destination fell through to "create a new one / delete it"',
      );
      expectTruthy(
        src.includes('if (bodyChanged || recipientChanged) {'),
        'voice must offer to update when either body or recipient changed, not body alone',
      );
    },
  },
  {
    id: 'f12.voice-pending-note-update-applies-recipient',
    category: 'location',
    description: 'voice pendingNoteUpdate consumption actually writes the new recipient fields into action_config, not just body',
    async run() {
      const src = readFileSync(VOICE_SERVER_PATH, 'utf8');
      expectTruthy(
        src.includes('const { ruleId, label, existingActionConfig, newBody, newTo, newToName, newToEmail, newToPhone } = pendingNoteUpdate;'),
        'pendingNoteUpdate destructure must include the new recipient fields',
      );
      expectTruthy(
        src.includes('merged.to = newTo;') && src.includes('delete merged.to_name;') && src.includes('delete merged.to_phone;'),
        'pendingNoteUpdate consumption must overwrite the destination fields wholesale when newTo is present, matching manage-rules::merge_tasks semantics',
      );
    },
  },
  {
    id: 'f12.manage-rules-merge-tasks-accepts-recipient',
    category: 'rules',
    description: 'manage-rules merge_tasks operation accepts and applies to/to_name/to_email/to_phone, not just tasks/list_name',
    async run() {
      const src = readFileSync(MANAGE_RULES_PATH, 'utf8');
      expectTruthy(
        src.includes("interface MergeTasksRequest   { op: 'merge_tasks';   user_id?: string; rule_id: string; tasks?: string[]; list_name?: string; to?: string; to_name?: string; to_email?: string; to_phone?: string; }"),
        'MergeTasksRequest interface must declare the recipient fields',
      );
      expectTruthy(
        src.includes('if (typeof body.to === \'string\' && body.to.trim()) {') &&
        src.includes('mergedConfig.to = body.to.trim();'),
        'merge_tasks handler must overwrite the destination fields wholesale when a new `to` is provided — a recipient replaces, it does not accumulate like tasks',
      );
    },
  },
];
