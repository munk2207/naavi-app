/**
 * Session 2026-07-21 — B10p: location-alert confirmation reads as a single
 * run-on sentence carrying up to 2 distinct facts, instead of using the
 * app's own established numbered-list pattern for multi-part confirmations.
 *
 * docs/B10P_PHASE1_PROBLEM_DEFINITION_2026-07-21.md → docs/B10P_PHASE1A_
 * ARCHITECTURE_COMPLETENESS_2026-07-21.md (count-tier design question
 * surfaced) → docs/B10P_PHASE2_CHANGE_PLAN_2026-07-21.md (count-tier table:
 * 0/1 facts unchanged, 2+ facts numbered) → docs/B10P_PHASE3_TECHNICAL_
 * REVIEW_2026-07-21.md (hidden-coupling checks, implementation strategy).
 *
 * Per Phase 3's implementation strategy: (1) unit-test combineHeadlineAndFacts
 * in isolation [this file, part 1] — (2) verify each call site assembles its
 * facts[] correctly [this file, part 2] — (3) full regression suite —
 * (4) manual by-ear validation in Phase 7.
 */

import { expectEqual, expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';
import { combineHeadlineAndFacts, getAlertReadbackFacts } from '../../lib/alertReadback';
import { readFileSync } from 'fs';
import { join } from 'path';

const ORCHESTRATOR_PATH = join(process.cwd(), 'hooks', 'useOrchestrator.ts');

export const session2026_07_21_b10pLocationNumberedFactsTests: TestCase[] = [
  // ── Part 1: combineHeadlineAndFacts in isolation, full count-tier table ──

  {
    id: 'b10p.zero-facts-unchanged-sentence',
    category: 'session-2026-07-21',
    description: 'Count tier 0: no facts -> plain headline sentence, unchanged from pre-B10p behavior.',
    run: async () => {
      const out = combineHeadlineAndFacts('Alert set — one time you arrive at Home', []);
      expectEqual(out, 'Alert set — one time you arrive at Home.', 'zero-facts output');
    },
  },
  {
    id: 'b10p.one-fact-unchanged-sentence',
    category: 'session-2026-07-21',
    description: 'Count tier 1: a single fact -> headline + inline clause, unchanged from pre-B10p behavior (no numbering for one item).',
    run: async () => {
      const out = combineHeadlineAndFacts('Alert set — one time you arrive at Home', ['Note: feed the cat.']);
      expectEqual(out, 'Alert set — one time you arrive at Home. Note: feed the cat.', 'one-fact output');
    },
  },
  {
    id: 'b10p.two-facts-numbered-list-the-original-bug',
    category: 'session-2026-07-21',
    description: 'Count tier 2: the exact B10o-era scenario ("feed the cat" + "sms bob") now renders as a numbered list per the approved design, not a run-on sentence.',
    run: async () => {
      const out = combineHeadlineAndFacts(
        'Alert set — one time you arrive at Home',
        ['Note: feed the cat.', 'Bob will get "I\'m home.".'],
      );
      expectEqual(
        out,
        'Alert set — one time you arrive at Home:\n1. Note: feed the cat.\n2. Bob will get "I\'m home.".',
        'two-facts numbered output',
      );
    },
  },
  {
    id: 'b10p.three-plus-facts-same-numbered-treatment',
    category: 'session-2026-07-21',
    description: 'Count tier 3+: same numbered-list mechanism, no separate third format (not reachable with today\'s 2 fact types, but the mechanism must not break if a 3rd fact type is added later).',
    run: async () => {
      const out = combineHeadlineAndFacts('Alert set — one time you arrive at Home', ['Fact one.', 'Fact two.', 'Fact three.']);
      expectEqual(
        out,
        'Alert set — one time you arrive at Home:\n1. Fact one.\n2. Fact two.\n3. Fact three.',
        'three-facts numbered output',
      );
    },
  },
  {
    id: 'b10p.headline-whitespace-trimmed',
    category: 'session-2026-07-21',
    description: 'A headline with incidental surrounding whitespace is trimmed before use, not carried into the output verbatim.',
    run: async () => {
      const out = combineHeadlineAndFacts('  Alert set — one time you arrive at Home  ', []);
      expectEqual(out, 'Alert set — one time you arrive at Home.', 'trimmed headline');
    },
  },

  // ── getAlertReadbackFacts — clean array elements, no leading space ──

  {
    id: 'b10p.facts-array-no-leading-space',
    category: 'session-2026-07-21',
    description: 'getAlertReadbackFacts returns clean fragments (no leading space) unlike the suffix-oriented formatSelfTaskClause/formatThirdPartyClause, which are formatted for string concatenation.',
    run: async () => {
      const facts = getAlertReadbackFacts({ tasks: 'feed the cat', to_name: 'Bob', body: "I'm home." });
      expectEqual(facts.length, 2, 'both facts present');
      expectTruthy(!facts[0].startsWith(' '), 'self-task fact has no leading space');
      expectTruthy(!facts[1].startsWith(' '), 'third-party fact has no leading space');
      expectEqual(facts[0], 'Note: feed the cat.', 'self-task fact content, first per precedence');
      expectEqual(facts[1], 'Bob will get "I\'m home.".', 'third-party fact content, second per precedence');
    },
  },
  {
    id: 'b10p.facts-array-omits-absent-facts',
    category: 'session-2026-07-21',
    description: 'Absent facts are omitted from the array entirely, not returned as empty-string entries.',
    run: async () => {
      const facts = getAlertReadbackFacts({ tasks: 'feed the cat' });
      expectEqual(facts.length, 1, 'only the present fact is returned');
    },
  },

  // ── Part 2: each of the 4 call sites builds and uses the new mechanism ──
  // (structural checks — behavioral correctness is covered by the tests
  // above, which exercise the same underlying functions each site calls)

  {
    id: 'b10p.pendingLocationRef-commit-uses-combiner',
    category: 'session-2026-07-21',
    description: 'The pendingLocationRef "yes" commit path (new/reactivated variants) builds its facts array and calls combineHeadlineAndFacts, not the old string-concatenation suffix pattern.',
    run: async () => {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      const commitBlockIdx = src.indexOf('if (isYes && pending.resolved) {');
      const combinerCallIdx = src.indexOf('combineHeadlineAndFacts(', commitBlockIdx);
      expectTruthy(commitBlockIdx > -1, 'the pendingLocationRef "yes" commit block must exist');
      expectTruthy(combinerCallIdx > commitBlockIdx, 'the commit path must call combineHeadlineAndFacts for its new/reactivated speech');
    },
  },
  {
    id: 'b10p.memory-hit-uses-combiner',
    category: 'session-2026-07-21',
    description: 'The memory-hit direct insert path builds its facts array and calls combineHeadlineAndFacts.',
    run: async () => {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(
        src.includes('combineHeadlineAndFacts(`Alert set — ${modeText} you arrive at ${displayName}`'),
        'the memory-hit path must call combineHeadlineAndFacts with its own headline',
      );
    },
  },
  {
    id: 'b10p.clarification-memory-hit-uses-combiner',
    category: 'session-2026-07-21',
    description: 'The clarification-memory-hit path (previously entirely unstructured) now builds a facts array and calls combineHeadlineAndFacts too.',
    run: async () => {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      const clarifIdx = src.indexOf('clarifActionConfig');
      const combinerCallIdx = src.indexOf('combineHeadlineAndFacts(', clarifIdx);
      expectTruthy(clarifIdx > -1, 'the clarification-memory-hit action config variable must exist');
      expectTruthy(combinerCallIdx > clarifIdx, 'the clarification-memory-hit path must call combineHeadlineAndFacts');
    },
  },
  {
    id: 'b10p.rearm-uses-combiner',
    category: 'session-2026-07-21',
    description: 'reArmLocationRule builds a facts array and calls combineHeadlineAndFacts for its returned speech.',
    run: async () => {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      const rearmIdx = src.indexOf('async function reArmLocationRule(');
      const combinerCallIdx = src.indexOf('combineHeadlineAndFacts(', rearmIdx);
      expectTruthy(rearmIdx > -1, 'reArmLocationRule must exist');
      expectTruthy(combinerCallIdx > rearmIdx, 'reArmLocationRule must call combineHeadlineAndFacts');
    },
  },
  {
    id: 'b10p.merge-sites-remain-untouched',
    category: 'session-2026-07-21',
    description: 'The 2 merge-into-existing-alert sites are deliberately NOT converted (Phase 2/3 boundary) — confirms they still use the old addedDesc inline pattern, not the new combiner, so a future accidental "helpful" migration is caught as a test failure requiring explicit re-scoping.',
    run: async () => {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(src.includes('const addedDesc = recipientChanged'), 'name-match merge site must still use its own inline addedDesc pattern');
      expectTruthy(src.includes("const addedDesc = newListName ? `your ${newListName} list` : newTasks.join(', ');"), 'coord-hit merge site must still use its own inline addedDesc pattern');
    },
  },
];
