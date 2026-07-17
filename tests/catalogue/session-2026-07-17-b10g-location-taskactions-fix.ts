/**
 * Session 2026-07-17 — B10g: task_actions on location-triggered alerts had
 * zero execution path at all (silent, indefinite non-delivery — a different
 * bug shape than F5c's wrong-recipient defect).
 *
 * docs/B10G_PHASE1_PROBLEM_DEFINITION_2026-07-17.md (root cause) →
 * docs/B10G_PHASE2_CHANGE_PLAN_2026-07-17.md (fix: extract F5c's fail-closed
 * task_actions logic into a shared module both evaluate-rules and
 * report-location-event call) → docs/B10G_PHASE3_TECHNICAL_REVIEW_2026-07-17.md
 * (implementation boundaries, context-object interface decision).
 *
 * These are source-assertion tests confirming the fix is shaped correctly —
 * both call sites use the same shared function (not two independently
 * drifted copies, the exact failure mode that caused this bug), and the
 * new call in report-location-event is strictly additive (placed after the
 * existing fan-out, never altering it).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const TASK_ACTIONS_PATH = join(process.cwd(), 'supabase', 'functions', '_shared', 'task_actions.ts');
const EVALUATE_RULES_PATH = join(process.cwd(), 'supabase', 'functions', 'evaluate-rules', 'index.ts');
const REPORT_LOCATION_EVENT_PATH = join(process.cwd(), 'supabase', 'functions', 'report-location-event', 'index.ts');
const FIRE_PENDING_DWELLS_PATH = join(process.cwd(), 'supabase', 'functions', 'fire-pending-dwells', 'index.ts');

export const session2026_07_17_b10gLocationTaskActionsFixTests: TestCase[] = [
  {
    id: 'b10g.shared-module-exports-executeTaskActions',
    category: 'rules',
    description: 'the extracted shared module exists and exports executeTaskActions with the context-object signature decided in Phase 3',
    async run() {
      const src = readFileSync(TASK_ACTIONS_PATH, 'utf8');
      expectTruthy(
        src.includes('export async function executeTaskActions(ctx:'),
        'executeTaskActions must be exported with a context-object parameter',
      );
      expectTruthy(
        src.includes('config: Record<string, unknown>;') && src.includes('rule: { id: string; user_id: string };'),
        'the context object must carry config and rule (not separate ruleId/userId strings, per Phase 3 §2\'s transposition-risk reasoning)',
      );
    },
  },
  {
    id: 'b10g.evaluate-rules-uses-shared-function-not-inline-copy',
    category: 'rules',
    description: 'evaluate-rules imports and calls the shared executeTaskActions instead of its own inline resolution logic — pure extraction, no re-derived copy',
    async run() {
      const src = readFileSync(EVALUATE_RULES_PATH, 'utf8');
      expectTruthy(
        src.includes("import { executeTaskActions } from '../_shared/task_actions.ts';"),
        'evaluate-rules must import executeTaskActions from the shared module',
      );
      expectTruthy(
        src.includes('await executeTaskActions({ config, rule, userName, supabaseUrl, interFnKey });'),
        'evaluate-rules must call executeTaskActions with the exact context-object shape',
      );
    },
  },
  {
    id: 'b10g.report-location-event-now-executes-task-actions',
    category: 'rules',
    description: 'the actual fix — report-location-event now imports and calls the same shared executeTaskActions function, closing the execution gap proven in Phase 1',
    async run() {
      const src = readFileSync(REPORT_LOCATION_EVENT_PATH, 'utf8');
      expectTruthy(
        src.includes("import { executeTaskActions } from '../_shared/task_actions.ts';"),
        'report-location-event must import executeTaskActions from the shared module',
      );
      expectTruthy(
        src.includes('await executeTaskActions({ config, rule, userName, supabaseUrl, interFnKey });'),
        'report-location-event must call executeTaskActions with the exact same context-object shape as evaluate-rules — both call sites use the same function, not independently drifted copies',
      );
    },
  },
  {
    id: 'b10g.report-location-event-existing-fanout-unaffected',
    category: 'rules',
    description: 'regression guard — the existing self/third-party location-alert fan-out is untouched; the new task_actions call is strictly additive, placed after the fan-out completes and before the function returns',
    async run() {
      const src = readFileSync(REPORT_LOCATION_EVENT_PATH, 'utf8');
      const fanoutLogIdx = src.indexOf('console.log(`[report-location-event] Rule ${rule.id} fan-out (${mode}):');
      const taskActionsCallIdx = src.indexOf('await executeTaskActions(');
      const returnIdx = src.indexOf('return successCount > 0;');
      expectTruthy(fanoutLogIdx > -1, 'the existing fan-out summary log must still exist, unchanged');
      expectTruthy(taskActionsCallIdx > -1, 'the executeTaskActions call must exist');
      expectTruthy(returnIdx > -1, 'the function\'s existing return statement must still exist, unchanged');
      expectTruthy(
        fanoutLogIdx < taskActionsCallIdx && taskActionsCallIdx < returnIdx,
        'task_actions execution must run strictly between the existing fan-out completing and the function returning — never interleaved with or before the existing fan-out logic',
      );
    },
  },
  {
    id: 'b10g.fire-pending-dwells-unaffected-by-design',
    category: 'rules',
    description: 'fire-pending-dwells needs no change — it delegates dwell-completion fires back into report-location-event\'s own fireLocationAction (confirmed in Phase 1 §2.4), so the fix above covers dwell-based alerts automatically',
    async run() {
      const src = readFileSync(FIRE_PENDING_DWELLS_PATH, 'utf8');
      expectTruthy(
        !src.includes('task_actions'),
        'fire-pending-dwells should still have no direct task_actions reference — it must keep delegating to report-location-event rather than gaining its own independent (and driftable) copy',
      );
    },
  },
];
