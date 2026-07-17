/**
 * Session 2026-07-09 — F15 Defect B fix: buildActionConfirm's location
 * branch (naavi-chat/index.ts) now forwards a Haiku-extracted recipient
 * (params.to_name / params.to) into action_config.to, guarded so it is a
 * no-op when no recipient was extracted.
 *
 * Root cause and evidence: docs/F15_PHASE1_PROBLEM_DEFINITION_2026-07-09.md
 * (fourth revision, Evidence B9-B11). Fix design: docs/F15_PHASE2_CHANGE_PLAN_2026-07-09.md §2.5-2.8.
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a rather than silently
 * absorbed: buildActionConfirm lives inside supabase/functions/naavi-chat/index.ts,
 * a Deno Edge Function (calls Deno.serve(...) at module scope). It cannot be
 * safely imported into this Node/tsx test runner without a structural
 * refactor (extracting buildActionConfirm into an environment-agnostic
 * shared module) that is outside this fix's approved scope. These tests are
 * therefore source-pattern assertions against the literal code text — the
 * same style already established and accepted for the entire F12 test
 * catalogue (see tests/catalogue/session-2026-07-06-f12-high-risk-wiring.ts's
 * own docstring, and F15 Phase 1 §3's discussion of this exact limitation).
 * They verify the guard clause exists in the correct location with the
 * correct shape and ordering — they do NOT execute the real function and
 * compare byte-for-byte output, which the external review round on
 * 2026-07-09 asked for. That stronger test was not achievable without either
 * (a) a live network call against the deployed staging endpoint from the
 * automated suite (a different test style than anything else in this
 * catalogue), or (b) the module refactor noted above. Flagged here rather
 * than silently downgraded; Wael has visibility to require (a) or (b) later
 * if this gap proves insufficient in practice.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const NAAVI_CHAT_PATH = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');

export const session2026_07_09_f15DefectBTests: TestCase[] = [
  {
    id: 'f15.location-branch-forwards-recipient-into-action-config',
    category: 'rules',
    description: 'buildActionConfirm\'s location branch reads a Haiku-extracted recipient (to_name/to) into action_config.to, fixing the F15 Defect B root cause (Phase 1 Evidence B10/B11)',
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');

      // Isolate the tt === 'location' branch specifically, not the whole file,
      // so this test cannot pass by matching an unrelated occurrence of these
      // strings elsewhere (e.g. the time-trigger fast path, which has its own,
      // pre-existing to_name handling that this fix deliberately does not touch).
      const locBranchStart = src.indexOf("if (tt === 'location') {");
      expectTruthy(locBranchStart >= 0, 'location branch (tt === \'location\') must exist in buildActionConfirm');
      const locBranchEnd = src.indexOf('\n      }', locBranchStart);
      expectTruthy(locBranchEnd > locBranchStart, 'must find the closing brace of the location branch');
      const locBranch = src.slice(locBranchStart, locBranchEnd);

      expectTruthy(
        locBranch.includes('haikuToName') && /to_name\s*\?\?.*\.to\b/.test(locBranch),
        'location branch must read params.to_name (falling back to params.to) into a local variable',
      );
      expectTruthy(
        locBranch.includes('baseActionConfig.to = haikuToName'),
        'location branch must assign the extracted recipient into baseActionConfig.to',
      );

      // Ordering: the assignment must happen before the action object is
      // constructed and returned, or it would have no effect.
      const assignIdx = locBranch.indexOf('baseActionConfig.to = haikuToName');
      const returnIdx = locBranch.indexOf('actions: [{ type: \'SET_ACTION_RULE\'');
      expectTruthy(assignIdx >= 0 && returnIdx > assignIdx, 'recipient assignment must occur before the action is constructed and returned');
    },
  },
  {
    id: 'f15.location-branch-recipient-forwarding-is-guarded-no-op-by-default',
    category: 'rules',
    description: 'the recipient-forwarding addition is structurally guarded (only fires when a recipient was extracted AND none already present) so existing no-recipient location alerts are unaffected — the strongest form of "no regression" achievable via source assertion, per the byte-for-byte behavioral test this coverage gap note discloses as not yet done',
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      const locBranchStart = src.indexOf("if (tt === 'location') {");
      const locBranchEnd = src.indexOf('\n      }', locBranchStart);
      const locBranch = src.slice(locBranchStart, locBranchEnd);

      // The exact guard shape: only assigns when haikuToName is truthy AND
      // action_config.to isn't already set (never overwrites an explicit
      // action_config.to a caller may have supplied some other way).
      expectTruthy(
        /if\s*\(\s*haikuToName\s*&&\s*!baseActionConfig\.to\s*\)\s*\{/.test(locBranch),
        'the recipient assignment must be gated behind `if (haikuToName && !baseActionConfig.to)` — additive only, never unconditional',
      );

      // haikuToName itself is derived with String(...).trim() over an
      // optional field, so absence (undefined/missing) always yields '' —
      // a falsy guard input — for any params object that never had
      // to_name/to (i.e. every pre-fix location alert with no recipient).
      expectTruthy(
        /String\(\s*\(params as any\)\.to_name\s*\?\?\s*\(params as any\)\.to\s*\?\?\s*['"]{2}\s*\)\.trim\(\)/.test(locBranch)
        || /String\(\s*\(params as any\)\.to_name\s*\?\?\s*\(params as any\)\.to\s*\)\.trim\(\)/.test(locBranch),
        'haikuToName must default to an empty string when neither to_name nor to is present, guaranteeing the guard is false (no-op) for every existing recipient-less location alert',
      );
    },
  },
];
