/**
 * Session 2026-07-06 — F12 Phase 4, High-risk tier: caller wiring +
 * evaluate-rules fire-time re-resolution.
 *
 * Completes docs/F12_PHASE2_CHANGE_PLAN_2026-07-05.md — mobile and voice now
 * resolve recipients via resolve-recipient (create mode) instead of the
 * ad hoc lookupContact call (mobile) or no resolution at all (voice, Phase 1
 * Evidence A3). evaluate-rules re-resolves contact-based recipients fresh at
 * fire time (fire mode), per Wael's live-reference lifecycle decision, with
 * a distinct failure path for an unresolvable contact — never falling into
 * the noRecipient→self-alert branch that would silently misdirect the
 * message again.
 *
 * These are source-assertion tests (same pattern as the rest of the F12
 * catalogue) — they confirm the fix code exists and is shaped correctly,
 * not a live end-to-end call against real Google Contacts data.
 *
 * Scope note (reported per governance, not silently absorbed): the approved
 * plan described reusing "the existing DRAFT_MESSAGE picker UI pattern" for
 * ambiguous contacts at create time. No such interactive picker was found
 * wired into either useOrchestrator.ts or the voice server for
 * SET_ACTION_RULE — both surfaces instead block the rule and ask the user
 * to say a full name or literal address. See docs/F12_PHASE4_EVIDENCE_2026-07-06.md.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const ORCHESTRATOR_PATH = join(process.cwd(), 'hooks', 'useOrchestrator.ts');
const VOICE_SERVER_PATH = join(process.cwd(), 'naavi-voice-server', 'src', 'index.js');
const EVALUATE_RULES_PATH = join(process.cwd(), 'supabase', 'functions', 'evaluate-rules', 'index.ts');

export const session2026_07_06_f12HighRiskWiringTests: TestCase[] = [
  {
    id: 'f12.mobile-set-action-rule-uses-resolve-recipient-create-mode',
    category: 'contacts',
    description: 'useOrchestrator.ts SET_ACTION_RULE resolution calls resolve-recipient in create mode and handles all resolved kinds',
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(src.includes("{ mode: 'create', to: toName, user_id: session.user.id }"), 'must call resolve-recipient with create mode and the raw spoken/typed value');
      for (const kind of ["'literal_email'", "'literal_phone'", "'resolved_contact'", "'ambiguous'", "'not_found'"]) {
        expectTruthy(src.includes(`case ${kind}:`), `must handle resolve-recipient kind ${kind}`);
      }
    },
  },
  {
    id: 'f12.mobile-set-action-rule-blocks-on-unresolvable-recipient',
    category: 'contacts',
    description: 'mobile blocks rule creation (fails closed) on ambiguous/not_found/error rather than creating a rule with an unresolved destination',
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(src.includes('let recipientBlocked = false;'), 'must have a blocking flag distinct from silent continuation');
      expectTruthy(
        src.includes('if (recipientBlocked) {') && src.includes('continue;'),
        'must actually skip creating the rule when the recipient could not be cleanly resolved',
      );
    },
  },
  {
    id: 'f12.voice-set-action-rule-uses-resolve-recipient-both-paths',
    category: 'contacts',
    description: 'voice server calls resolve-recipient in create mode from both the main (non-location) handler and the location branch, fixing the total absence of resolution found in Phase 1 (Evidence A3)',
    async run() {
      const src = readFileSync(VOICE_SERVER_PATH, 'utf8');
      const createModeCalls = (src.match(/mode: 'create'/g) ?? []).length;
      expectTruthy(createModeCalls >= 2, `expected at least 2 create-mode resolve-recipient calls (main handler + location branch), found ${createModeCalls}`);
    },
  },
  {
    id: 'f12.voice-main-handler-fails-closed-on-unresolvable-recipient',
    category: 'contacts',
    description: 'voice main (non-location) SET_ACTION_RULE handler returns success:false instead of inserting a row when the recipient does not resolve cleanly',
    async run() {
      const src = readFileSync(VOICE_SERVER_PATH, 'utf8');
      expectTruthy(
        src.includes("return { success: false, error: resolved?.kind || 'resolve_failed' };"),
        'must return failure and skip the INSERT rather than creating a rule with an unresolved destination',
      );
    },
  },
  {
    id: 'f12.voice-location-branch-blocks-on-unresolvable-recipient',
    category: 'location',
    description: 'voice location branch speaks a clarification and continues (skips rule creation) on ambiguous/not_found, mirroring mobile',
    async run() {
      const src = readFileSync(VOICE_SERVER_PATH, 'utf8');
      expectTruthy(
        src.includes("You have more than one contact named ${toNameLoc}") &&
        src.includes("I don't have a contact named ${toNameLoc}"),
        'location branch must speak a clear clarification for ambiguous and not_found cases',
      );
    },
  },
  {
    id: 'f12.evaluate-rules-fire-mode-live-reresolution',
    category: 'rules',
    description: 'evaluate-rules::fireAction re-resolves a contact_id-based recipient fresh at fire time (live reference, not a frozen snapshot), per Wael\'s explicit lifecycle decision',
    async run() {
      const src = readFileSync(EVALUATE_RULES_PATH, 'utf8');
      expectTruthy(
        src.includes('if (config.contact_id) {'),
        'fireAction must check for contact_id and trigger fresh resolution',
      );
      expectTruthy(
        src.includes("mode: 'fire', contact_id: config.contact_id"),
        'must call resolve-recipient in fire mode with the canonical contact_id',
      );
    },
  },
  {
    id: 'f12.evaluate-rules-distinct-failure-not-self-alert',
    category: 'rules',
    description: 'an unresolvable contact_id (deleted/ambiguous) at fire time self-notifies honestly and never falls into the noRecipient self-alert branch',
    async run() {
      const src = readFileSync(EVALUATE_RULES_PATH, 'utf8');
      const recipientUnresolvableIdx = src.indexOf('if (recipientUnresolvable) {');
      const noRecipientIdx = src.indexOf('const noRecipient   = !toPhone && !toEmail;');
      expectTruthy(recipientUnresolvableIdx > -1, 'must have a distinct recipientUnresolvable branch');
      expectTruthy(noRecipientIdx > -1, 'noRecipient branch must still exist for the genuine no-recipient-specified case');
      expectTruthy(
        recipientUnresolvableIdx < noRecipientIdx,
        'the distinct failure branch must be checked and return before reaching the noRecipient self-alert logic, so it can never fall through',
      );
      expectTruthy(
        src.includes("couldn't send your alert") && src.includes('return true;'),
        'must self-notify with an honest failure message and return true (fully evaluated, no infinite retry)',
      );
    },
  },
];
