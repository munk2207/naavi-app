/**
 * Session 2026-07-14 — B9i-followup: a self-override time-trigger alert
 * ("WhatsApp me at X in 3 minutes") that needed a follow-up question (the
 * message body was missing, so Naavi asked "What should the message say?")
 * silently failed to save once the conversation had real history — clean
 * "Done. Alert set." confirmation, zero action_rules row written.
 *
 * Root cause, confirmed via direct server-side replay (not inferred): the
 * missing-body question returned NO PENDING_INTENT marker, so the user's
 * next reply had to be re-classified from scratch by Haiku using
 * conversation history alone. A short/fresh conversation classified
 * correctly; a longer, busier one (reproduced with ~10 prior filler turns)
 * routed to Claude's own tool-use reasoning instead, which sometimes
 * generated a plausible "Done." response without ever calling the tool.
 *
 * Fix: the missing-body branch now embeds a PENDING_INTENT with
 * awaitingField:'body' (datetime is left unfixed — it needs natural-language
 * time parsing that only the classifier does, unsafe to capture as literal
 * text). Step 1.4 now recognizes awaitingField:'body' regardless of
 * yes/no wording, captures the user's literal reply as the body, and
 * builds the confirm turn via a new shared helper
 * (buildSelfOverrideTimeConfirm) — the same helper the original "all
 * fields already present" branch now also uses, so both paths produce
 * identical confirm speech + marker shape.
 *
 * Verified via direct server-side replay against the deployed fix (not
 * just this source-pattern check): re-ran the exact 3-turn conversation
 * with 10 filler turns of prior history prepended — before the fix,
 * before/after action_rules count was 13/13 (no row written); after the
 * fix, 13/14 (row written with the correct body + self_override_whatsapp).
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a: naavi-chat/index.ts is a
 * Deno Edge Function that cannot be safely imported into this Node/tsx test
 * runner. This is a source-pattern assertion locking in the code shape;
 * the live replay above is what actually proved the fix works.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const NAAVI_CHAT_PATH = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');

export const session2026_07_14_b9iFollowupBodyMarkerTests: TestCase[] = [
  {
    id: 'b9i-followup.missing-body-embeds-awaiting-field-marker',
    category: 'rules',
    description: 'the missing-body question for a self-override time-trigger alert embeds a PENDING_INTENT with awaitingField instead of a bare speech-only question',
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');

      // Scope 1: the self-override branch's own missing-body question. There is
      // a second, unrelated "What should the message say?" a few lines below
      // for the THIRD-PARTY time-trigger case (has a to_name, calls
      // lookup-contact) — deliberately out of scope for this fix, so anchor
      // narrowly to the self-override branch instead of matching every
      // occurrence in the file.
      const selfOverrideBranchIdx = src.indexOf('if (!_ftToName && _ftHasSelfOverride) {');
      expectTruthy(selfOverrideBranchIdx !== -1, 'self-override branch not found');
      const selfOverrideBodyQuestionIdx = src.indexOf('const msg = `What should the message say?`;', selfOverrideBranchIdx);
      const selfOverrideThirdPartyBoundary = src.indexOf('if (!_ftToName) {', selfOverrideBranchIdx);
      expectTruthy(
        selfOverrideBodyQuestionIdx !== -1 && selfOverrideBodyQuestionIdx < selfOverrideThirdPartyBoundary,
        'self-override branch\'s missing-body question not found before the unrelated third-party branch',
      );
      const selfOverrideWindow = src.slice(selfOverrideBodyQuestionIdx, src.indexOf('return jsonResponse', selfOverrideBodyQuestionIdx) + 200);
      expectTruthy(
        selfOverrideWindow.includes("awaitingField: 'body'"),
        'B9i-followup fix: the self-override branch\'s "What should the message say?" response must embed a PENDING_INTENT with awaitingField:\'body\', not a bare speech-only question',
      );

      // Scope 2: Step 1.4's re-ask when the awaitingField answer comes back empty.
      const step14AwaitIdx = src.indexOf("pendingAwaitingField === 'body' && pending.intent === 'SET_ACTION_RULE'");
      expectTruthy(step14AwaitIdx !== -1, 'Step 1.4 awaitingField===\'body\' handler not found');
      const step14BodyQuestionIdx = src.indexOf('const msg = `What should the message say?`;', step14AwaitIdx);
      const step14Window = src.slice(step14BodyQuestionIdx, src.indexOf('return jsonResponse', step14BodyQuestionIdx) + 200);
      expectTruthy(
        step14BodyQuestionIdx !== -1 && step14Window.includes("awaitingField: 'body'"),
        'B9i-followup fix: Step 1.4\'s re-ask (when the awaitingField answer is empty) must also re-embed a PENDING_INTENT with awaitingField:\'body\'',
      );
    },
  },
  {
    id: 'b9i-followup.step14-captures-awaiting-body-deterministically',
    category: 'rules',
    description: 'Step 1.4 recognizes awaitingField:\'body\' and captures the next reply as the message body without needing yes/no wording',
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');

      expectTruthy(
        src.includes('const pendingAwaitingField = markerMatch14'),
        'B9i-followup fix: Step 1.4 must compute pendingAwaitingField from the PENDING_INTENT marker',
      );
      expectTruthy(
        /if \(YES_RE\.test\(userText\)[\s\S]{0,200}\|\| pendingAwaitingField\)/.test(src),
        'B9i-followup fix: the Step 1.4 entry gate must also trigger when pendingAwaitingField is set (not just yes/no/disambig replies)',
      );
      expectTruthy(
        src.includes("pendingAwaitingField === 'body' && pending.intent === 'SET_ACTION_RULE'"),
        'B9i-followup fix: Step 1.4 must handle awaitingField===\'body\' for SET_ACTION_RULE before falling through to Claude/Haiku re-classification',
      );
    },
  },
  {
    id: 'b9i-followup.shared-confirm-helper-used-by-both-paths',
    category: 'rules',
    description: 'both the initial self-override branch and Step 1.4\'s awaitingField resolver build the confirm turn via the same shared helper, avoiding drift',
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');

      expectTruthy(
        src.includes('function buildSelfOverrideTimeConfirm('),
        'B9i-followup fix: buildSelfOverrideTimeConfirm helper must exist',
      );
      const usages = src.split('buildSelfOverrideTimeConfirm(').length - 1;
      expectTruthy(
        usages >= 3,
        `B9i-followup fix: buildSelfOverrideTimeConfirm should be defined once and called from both the initial branch and Step 1.4 (expected >=3 occurrences of the identifier, found ${usages})`,
      );
    },
  },
];
