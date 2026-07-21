/**
 * Session 2026-07-21 — B10o: a location alert combining a self-reminder
 * task with a third-party notification confirmed the third-party message
 * but never mentioned the user's own self-task in the spoken/displayed
 * readback.
 *
 * docs/B10O_PHASE1_PROBLEM_DEFINITION_2026-07-21.md (root cause: the
 * 2026-07-17 B10h/B10j readback fix added third-party naming to 2 of 5
 * confirmation-generating sites in hooks/useOrchestrator.ts, but never
 * extended it to also name the self-task) → docs/B10O_PHASE1A_ARCHITECTURE_
 * COMPLETENESS_2026-07-21.md (found 3 more affected sites; confirmed Shared
 * Core and Voice are not affected) → docs/B10O_PHASE2_CHANGE_PLAN_2026-07-21.md
 * (fix: extract a shared lib/alertReadback.ts helper, used by all 5 sites) →
 * docs/B10O_PHASE3_TECHNICAL_REVIEW_2026-07-21.md.
 *
 * These are pure unit tests against lib/alertReadback.ts directly — no
 * network calls, no Edge Function round trip. The helper is synchronous,
 * deterministic, and side-effect free by contract, so this is a stronger
 * and faster check than a live classifier call would be for this specific
 * fix (which is entirely readback-text construction, not classification).
 */

import { expectEqual, expectFalsy } from '../lib/assertions';
import type { TestCase } from '../lib/types';
import { buildAlertReadbackSuffix, formatThirdPartyClause } from '../../lib/alertReadback';

export const session2026_07_21_b10oLocationReadbackTests: TestCase[] = [
  {
    id: 'b10o.self-task-only',
    category: 'session-2026-07-21',
    description: 'A self-only task (no third party) produces only the self-task clause.',
    run: async () => {
      const out = buildAlertReadbackSuffix({ tasks: 'feed the cat' });
      expectEqual(out, ' Note: feed the cat.', 'self-task-only suffix');
    },
  },
  {
    id: 'b10o.third-party-only',
    category: 'session-2026-07-21',
    description: 'A third-party-only alert (no self-task) produces only the third-party clause — matches pre-existing B10h/B10j behavior exactly, unchanged.',
    run: async () => {
      const out = buildAlertReadbackSuffix({ to_name: 'Bob', body: "I'm home." });
      expectEqual(out, ' Bob will get "I\'m home.".', 'third-party-only suffix');
    },
  },
  {
    id: 'b10o.self-task-and-third-party-the-original-bug',
    category: 'session-2026-07-21',
    description: 'A hypothetical shape where tasks/to_name/body all coexist — both must appear, self-task first per the approved precedence.',
    run: async () => {
      const out = buildAlertReadbackSuffix({ tasks: 'feed the cat', to_name: 'Bob', body: "I'm home." });
      expectEqual(
        out,
        ' Note: feed the cat. Bob will get "I\'m home.".',
        'self-task + third-party combined suffix',
      );
    },
  },
  {
    id: 'b10o.self-task-and-third-party-the-REAL-original-bug',
    category: 'session-2026-07-21',
    description: 'Found via Phase 7 manual test on build 312, 2026-07-21 — the ACTUAL shape Claude produces for this scenario per get-naavi-prompt\'s LOCATION SELF-ALERT PRIMARY RULE: self-task text in `body`, third party in `task_actions`, NO top-level to_name/to. The original test above used an assumed/hypothetical shape that never matched live data — this test locks in the real one, which initially still failed after the first B10o/B10p ship (formatSelfTaskClause never read `body`).',
    run: async () => {
      const out = buildAlertReadbackSuffix({
        body: 'Feed the cat.',
        task_actions: [{ to_name: 'Bob', body: "I'm home." }],
      });
      expectEqual(
        out,
        ' Note: Feed the cat.. Bob will get "I\'m home.".',
        'body-as-self-task + task_actions third-party, the real live shape',
      );
    },
  },
  {
    id: 'b10o.body-belongs-to-top-level-recipient-not-self-task',
    category: 'session-2026-07-21',
    description: 'Regression guard for the body-fallback fix: when a top-level recipient (to_name/to) IS present, `body` belongs to that recipient (the original B10h shape) and must NOT also be treated as a self-task — no double-counting, no self-task clause appears.',
    run: async () => {
      const out = buildAlertReadbackSuffix({ to_name: 'Bob', body: "I'm home." });
      expectEqual(out, ' Bob will get "I\'m home.".', 'body stays third-party-only when to_name is present');
    },
  },
  {
    id: 'b10o.body-alone-with-no-recipient-signal-is-not-guessed-as-self-task',
    category: 'session-2026-07-21',
    description: 'Regression guard: `body` with neither a top-level recipient NOR task_actions present is an ambiguous/incomplete shape — must not be guessed as a self-task (fails safe to empty rather than inventing meaning for unclear data).',
    run: async () => {
      const out = buildAlertReadbackSuffix({ body: 'Feed the cat.' });
      expectEqual(out, '', 'ambiguous body-only shape produces no clause, not a guess');
    },
  },
  {
    id: 'b10o.self-task-and-task-actions-third-party',
    category: 'session-2026-07-21',
    description: 'Self-task combined with a task_actions-style third party (the B10j self-primary shape, not top-level to_name) — both must appear.',
    run: async () => {
      const out = buildAlertReadbackSuffix({
        tasks: 'lock the door',
        task_actions: [{ to_name: 'Bob', body: "I'm home." }],
      });
      expectEqual(
        out,
        ' Note: lock the door. Bob will get "I\'m home.".',
        'self-task + task_actions third-party suffix',
      );
    },
  },
  {
    id: 'b10o.neither-field-present',
    category: 'session-2026-07-21',
    description: 'Neither self-task nor third party present → empty suffix, no stray text.',
    run: async () => {
      const out = buildAlertReadbackSuffix({});
      expectEqual(out, '', 'empty suffix when nothing to name');
    },
  },
  {
    id: 'b10o.tasks-as-array-shape',
    category: 'session-2026-07-21',
    description: 'tasks field arriving as a string[] (the shape hooks/useOrchestrator.ts historically expected) is handled, not just the single-string shape the classifier prompt documents.',
    run: async () => {
      const out = buildAlertReadbackSuffix({ tasks: ['feed the cat', 'lock the door'] });
      expectEqual(out, ' Note: feed the cat and lock the door.', 'array-shaped tasks');
    },
  },
  {
    id: 'b10o.noun-phrase-task-text-reads-naturally',
    category: 'session-2026-07-21',
    description: 'Found live 2026-07-21: "Alert me at Costco with my shopping list" (no matching real list found, so "shopping list" is stored as plain task text, not a list_name attachment) — a noun phrase, not a verb phrase. The original "I\'ll remind you to {task}" template read badly ("I\'ll remind you to shopping list"); "Note: {task}" reads naturally for both phrasing styles.',
    run: async () => {
      const out = buildAlertReadbackSuffix({ tasks: 'shopping list' });
      expectEqual(out, ' Note: shopping list.', 'noun-phrase task text');
    },
  },
  {
    id: 'b10o.no-undefined-or-null-leakage',
    category: 'session-2026-07-21',
    description: 'Output invariant (Phase 3 review): never emit literal "undefined"/"null" for absent optional fields.',
    run: async () => {
      const out = buildAlertReadbackSuffix({ tasks: undefined, to_name: undefined, to: undefined, body: undefined, task_actions: undefined });
      expectFalsy(/undefined|null/i.test(out), 'no undefined/null leakage in suffix');
      expectEqual(out, '', 'fully-empty input produces empty suffix');
    },
  },
  {
    id: 'b10o.merged-branch-third-party-only-clause-avoids-self-task-duplication',
    category: 'session-2026-07-21',
    description: 'The "merged into existing alert" call site in hooks/useOrchestrator.ts uses formatThirdPartyClause alone (not the combined suffix) because its own headline already names the self-task — this locks in that the exported clause-only function excludes the self-task, so that call site cannot regress into double-naming it.',
    run: async () => {
      const out = formatThirdPartyClause({ tasks: 'feed the cat', to_name: 'Bob', body: "I'm home." });
      expectEqual(out, ' Bob will get "I\'m home.".', 'third-party-only clause excludes self-task');
    },
  },
  {
    id: 'b10o.does-not-mutate-input',
    category: 'session-2026-07-21',
    description: 'Functional contract (Phase 2/3): the helper must never mutate the actionConfig it receives.',
    run: async () => {
      const input = { tasks: 'feed the cat', to_name: 'Bob', body: "I'm home." };
      const snapshot = JSON.stringify(input);
      buildAlertReadbackSuffix(input);
      expectEqual(JSON.stringify(input), snapshot, 'actionConfig unchanged after call');
    },
  },
  {
    id: 'b10o.deterministic-repeat-calls',
    category: 'session-2026-07-21',
    description: 'Functional contract (Phase 2/3): identical input produces identical output across repeated calls.',
    run: async () => {
      const input = { tasks: 'feed the cat', to_name: 'Bob', body: "I'm home." };
      const first = buildAlertReadbackSuffix(input);
      const second = buildAlertReadbackSuffix(input);
      expectEqual(first, second, 'repeated calls with identical input match');
    },
  },
];
