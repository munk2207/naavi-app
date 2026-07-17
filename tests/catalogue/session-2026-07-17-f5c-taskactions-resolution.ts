/**
 * Session 2026-07-17 — F5c: fire-time task_actions recipient resolution
 * defect. Originally lived in evaluate-rules/index.ts; extracted 2026-07-17
 * (same day, later session) to supabase/functions/_shared/task_actions.ts
 * as part of B10g's fix (docs/B10G_PHASE2_CHANGE_PLAN_2026-07-17.md), so
 * report-location-event can execute task_actions too. These tests were
 * retargeted to the new file location — the guarantees they check are
 * unchanged, only where the code lives changed.
 *
 * Completes docs/F5C_PHASE2_CHANGE_PLAN_2026-07-17.md (approved fix) and
 * docs/F5C_PHASE3_TECHNICAL_REVIEW_2026-07-17.md (authorized scope).
 * Root cause: docs/F5C_PHASE1_PROBLEM_DEFINITION_2026-07-17.md — the F5c
 * block took `data.contacts?.[0]` from lookup-contact unconditionally, with
 * no ambiguity check, no confirmation, no fail-closed path. A real incident
 * sent three unconfirmed SMS to wrong real contacts for to_name values
 * "A"/"B"/"C". The fix adds a defense-in-depth name-length guard, replaces
 * the unconditional index-0 pick with an exact-match-count requirement (the
 * actual correctness guarantee), and closes a pre-existing silent-drop
 * logging gap.
 *
 * These are source-assertion tests (same pattern as the B10a catalogue) —
 * they confirm the fix is shaped correctly in the source, not a live
 * end-to-end fire against real Twilio/Supabase/Google contacts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy, expectFalsy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const TASK_ACTIONS_PATH = join(process.cwd(), 'supabase', 'functions', '_shared', 'task_actions.ts');
const EVALUATE_RULES_PATH = join(process.cwd(), 'supabase', 'functions', 'evaluate-rules', 'index.ts');

export const session2026_07_17_f5cTaskActionsResolutionTests: TestCase[] = [
  {
    id: 'f5c.name-too-short-guard-precedes-lookup-fetch',
    category: 'rules',
    description: 'executeTaskActions rejects a to_name under 2 characters (defense-in-depth) before ever calling lookup-contact, and logs the reason as name_too_short',
    async run() {
      const src = readFileSync(TASK_ACTIONS_PATH, 'utf8');
      const guardIdx = src.indexOf('ta.to_name.trim().length < 2');
      const lookupFetchIdx = src.indexOf("fetch(`${supabaseUrl}/functions/v1/lookup-contact`");
      expectTruthy(guardIdx > -1, 'name-length guard must exist in executeTaskActions');
      expectTruthy(lookupFetchIdx > -1, 'lookup-contact fetch call must still exist');
      expectTruthy(
        guardIdx < lookupFetchIdx,
        `name-length guard must run before the lookup-contact fetch (found guard at ${guardIdx}, fetch at ${lookupFetchIdx})`,
      );
      expectTruthy(
        src.includes('SKIPPED (name_too_short)'),
        'a too-short to_name must be logged with the distinct reason name_too_short',
      );
    },
  },
  {
    id: 'f5c.exact-match-count-required-not-unconditional-index-zero',
    category: 'rules',
    description: 'the correctness guarantee — executeTaskActions resolves a task_action only when lookup-contact returns exactly one match; the prior unconditional data.contacts?.[0] pick is gone',
    async run() {
      const src = readFileSync(TASK_ACTIONS_PATH, 'utf8');
      expectTruthy(
        src.includes('matches.length === 1'),
        'executeTaskActions must require exactly one match before resolving a recipient',
      );
      expectFalsy(
        src.includes('const best = data.contacts?.[0];'),
        'the old unconditional "take index 0 regardless of match count" line must be removed, not left alongside the new check',
      );
    },
  },
  {
    id: 'f5c.ambiguous-and-zero-match-log-distinct-reasons',
    category: 'rules',
    description: 'zero matches and multiple (ambiguous) matches are logged as two distinct, named reasons rather than one generic warning, so production diagnostics can filter by cause',
    async run() {
      const src = readFileSync(TASK_ACTIONS_PATH, 'utf8');
      expectTruthy(
        src.includes('SKIPPED (zero_matches)'),
        'a zero-match lookup must log the distinct reason zero_matches',
      );
      expectTruthy(
        src.includes('SKIPPED (ambiguous_multiple_matches)'),
        'a multi-match (ambiguous) lookup must log the distinct reason ambiguous_multiple_matches',
      );
    },
  },
  {
    id: 'f5c.unresolved-task-action-no-longer-silently-dropped',
    category: 'rules',
    description: 'a task_action that ends up with no resolved destination is now logged (no_resolved_destination) instead of being dropped from taskSends with zero log output — closes the prior silent-failure gap',
    async run() {
      const src = readFileSync(TASK_ACTIONS_PATH, 'utf8');
      const taskSendsIdx = src.indexOf('const taskSends = resolvedActions.map(ta =>');
      const noDestLogIdx = src.indexOf('SKIPPED (no_resolved_destination)');
      expectTruthy(taskSendsIdx > -1, 'taskSends build step must still exist');
      expectTruthy(noDestLogIdx > -1, 'the no_resolved_destination log line must exist');
      expectTruthy(
        taskSendsIdx < noDestLogIdx,
        'the no_resolved_destination log must be inside the taskSends build step',
      );
    },
  },
  {
    id: 'f5c.primary-alert-fanout-unaffected',
    category: 'rules',
    description: 'regression guard — the primary self/third-party alert fan-out logic in evaluate-rules is untouched by this fix; task_actions execution still runs after it, per the function\'s own existing ordering comment',
    async run() {
      const src = readFileSync(EVALUATE_RULES_PATH, 'utf8');
      const fanoutModeIdx = src.indexOf("const mode = isSelfAlert ? 'self' : (toPhone ? 'third-party-phone' : 'third-party-email');");
      const taskActionsCallIdx = src.indexOf('await executeTaskActions(');
      expectTruthy(fanoutModeIdx > -1, 'primary fan-out mode logic must still exist, unchanged');
      expectTruthy(taskActionsCallIdx > -1, 'the executeTaskActions call must still exist');
      expectTruthy(
        fanoutModeIdx < taskActionsCallIdx,
        'the primary alert fan-out must still run before task_actions execution (ordering unchanged by this fix)',
      );
    },
  },
];
