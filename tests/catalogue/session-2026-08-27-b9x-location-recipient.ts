/**
 * Session 2026-08-27 — B9x: a location alert meant for another person was
 * saved with the person's name as plain text and no phone number behind it,
 * and at fire time report-location-event:765 read "no addresses" as "this is
 * a self-alert" and delivered it to the user instead.
 *
 * This is not theoretical. Rule bb48e478 fired 2026-07-19 at 7:58 PM EST and
 * sent SMS, WhatsApp and a voice call to the user's own number, body "You've
 * arrived at Office." The intended recipient got nothing, and nothing on the
 * user's phone could have told them a message had just vanished — the rule
 * had no body either, so the self-alert fallback supplied one.
 *
 * docs/B9X_PHASE1_PROBLEM_DEFINITION_V2_2026-08-26.md (root cause: the prompt
 * promised "the server resolves the contact"; no server did) →
 * docs/B9X_PHASE1A_ARCHITECTURE_COMPLETENESS_V2_2026-08-26.md (mobile has
 * THREE location-creation paths, two skip resolution; voice already correct)
 * → docs/B9X_PHASE2_CHANGE_PLAN_V2_2026-08-26.md →
 * docs/B9X_PHASE3_TECHNICAL_REVIEW_2026-08-26.md (reviewer: approved with
 * mandatory changes — resolve-recipient on the location branch only, primary
 * recipient only, time branch untouched).
 *
 * Source-assertion tests. Coverage gaps acknowledged at the bottom.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const NAAVI_CHAT_PATH = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');
const PROMPT_PATH     = join(process.cwd(), 'supabase', 'functions', 'get-naavi-prompt', 'index.ts');

/** The B9x location branch, isolated from the rest of the file. */
function locationBranch(src: string): string {
  const start = src.indexOf('// ── B9x — Location-trigger recipient resolution');
  const end   = src.indexOf('// ── Time-trigger contact resolution (Turn 1 confirm)', start);
  return start > -1 && end > start ? src.slice(start, end) : '';
}

/**
 * The same branch with `//` comment lines removed, for assertions about what
 * the code DOES rather than what it says. The branch's own comments name
 * task_actions in order to explain why they are excluded — an assertion over
 * raw source cannot tell that apart from code that resolves them.
 */
function locationBranchCode(src: string): string {
  return locationBranch(src)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

export const session2026_08_27_b9xLocationRecipientTests: TestCase[] = [
  // ── Negative controls — the bug must not return ──────────────────────────
  {
    id: 'b9x.location-branch-exists-and-resolves-server-side',
    category: 'rules',
    description: 'naavi-chat resolves a named location-alert recipient before the action leaves the server — the step the prompt has always claimed exists',
    async run() {
      const branch = locationBranch(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      expectTruthy(branch.length > 0, 'the B9x location branch must exist in naavi-chat');
      expectTruthy(
        branch.includes("a.type === 'SET_ACTION_RULE' && String(a.trigger_type ?? '') === 'location'"),
        'the branch must select location-trigger SET_ACTION_RULE actions',
      );
      expectTruthy(
        branch.includes("_locAC?.to ?? _locAC?.to_name"),
        'it must read BOTH action_config.to and to_name — reproduction bb48e478 stored `to`',
      );
    },
  },
  {
    id: 'b9x.uses-resolve-recipient-not-lookup-contact',
    category: 'rules',
    description: 'Phase 3 mandatory change 1 — the location branch calls resolve-recipient, which handles email recipients and literal phone/email; lookup-contact filters on c.phone and would reject an email-only contact on an email alert',
    async run() {
      const branch = locationBranch(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      expectTruthy(
        branch.includes('functions/v1/resolve-recipient'),
        'the location branch must call resolve-recipient',
      );
      expectTruthy(
        !branch.includes('functions/v1/lookup-contact'),
        'the location branch must NOT call lookup-contact — that was Option 1, rejected at Phase 3',
      );
      expectTruthy(
        branch.includes("mode: 'create'"),
        'resolve-recipient must be called in create mode',
      );
    },
  },
  {
    id: 'b9x.fails-closed-on-every-non-resolving-outcome',
    category: 'rules',
    description: 'ambiguous, not_found, invalid, a missing channel on a found contact, and an infrastructure error ALL drop the action — none may fall through to the self-alert path that misdelivered on 2026-07-19',
    async run() {
      const branch = locationBranch(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      expectTruthy(branch.includes("case 'ambiguous':"), 'ambiguous must be handled explicitly');
      expectTruthy(branch.includes('default:'), 'not_found/invalid/unknown must be handled by a default arm');
      expectTruthy(branch.includes('} catch (e) {'), 'an infrastructure error must be caught, not allowed to fall through');
      expectTruthy(
        branch.includes('if (locFailure) {') && branch.includes('actions: [], pendingThreads: []'),
        'every failure must return with actions: [] — the action is dropped, never emitted unresolved',
      );
      const failIdx    = branch.indexOf('if (locFailure) {');
      const successLog = branch.indexOf('B9x: resolved location recipient');
      expectTruthy(
        failIdx > -1 && successLog > failIdx,
        'the failure return must come BEFORE the success path — a failed resolution can never continue',
      );
    },
  },
  {
    id: 'b9x.contact-found-but-wrong-channel-fails-closed',
    category: 'rules',
    description: 'a contact resolved with no phone on an SMS alert (or no email on an email alert) fails closed — it must not leave the alert with no destination and fall through to self',
    async run() {
      const branch = locationBranch(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      expectTruthy(
        branch.includes('if (_locAC.to_phone || _locAC.to_email) {'),
        'resolved_contact must verify a destination was actually set before accepting it',
      );
      expectTruthy(
        branch.includes("there's no email address saved for them") &&
        branch.includes("there's no phone number saved for them"),
        'both channel-specific failure messages must exist',
      );
    },
  },
  {
    id: 'b9x.ambiguous-asks-for-full-name-and-embeds-no-pending-intent',
    category: 'rules',
    description: 'Wael 2026-08-27 — ambiguity asks for the full name and must NOT offer a numbered pick, because the pick path routes through Step 1.4 to manage-rules, which cannot write location rules (manage-rules:321) and would save one with no coordinates that never fires',
    async run() {
      const branch = locationBranch(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      expectTruthy(
        branch.includes("say their full name and I'll try again"),
        'ambiguous must ask for the full name',
      );
      expectTruthy(
        !branch.includes('awaitingDisambig') && !branch.includes('PENDING_INTENT'),
        'the location branch must NOT embed a disambiguation marker — the pick path cannot write location rules',
      );
    },
  },
  {
    id: 'b9x.does-not-resolve-task-actions',
    category: 'rules',
    description: 'Phase 3 mandatory change 3 — the location branch resolves ONLY the primary recipient. task_actions keep their existing fire-time resolution in _shared/task_actions.ts',
    async run() {
      const code = locationBranchCode(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      expectTruthy(
        !code.includes('task_actions'),
        'no CODE in the location branch may touch task_actions — explicitly excluded by the Phase 3 reviewer. (Comments naming it are expected: they record why it is excluded.)',
      );
      // And the fire-time owner must still be the only resolver.
      const taskActionsSrc = readFileSync(
        join(process.cwd(), 'supabase', 'functions', '_shared', 'task_actions.ts'), 'utf8',
      );
      expectTruthy(
        taskActionsSrc.includes("(ta.type === 'send_sms' && !ta.to_phone && ta.to_name)"),
        'fire-time task_actions resolution must remain in _shared/task_actions.ts, unchanged',
      );
    },
  },

  // ── Positive controls — nothing that works today may break ───────────────
  {
    id: 'b9x.self-override-checked-first',
    category: 'rules',
    description: 'F15 Defect A preserved — "email me at jane@x.com when I arrive" is a self-alert with a channel override and must never be treated as a third-party recipient',
    async run() {
      const branch = locationBranch(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      const overrideIdx = branch.indexOf('const hasSelfOverrideLoc = Boolean(');
      const guardIdx    = branch.indexOf('if (!hasSelfOverrideLoc && locToName');
      expectTruthy(overrideIdx > -1, 'self-override detection must exist');
      expectTruthy(guardIdx > overrideIdx, 'the resolution guard must check hasSelfOverrideLoc first');
    },
  },
  {
    id: 'b9x.only-engages-when-a-name-is-present-and-unresolved',
    category: 'rules',
    description: 'isolation — "alert me at Costco" (no recipient) and an already-resolved recipient both skip the branch entirely and stay single-turn',
    async run() {
      const branch = locationBranch(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      expectTruthy(
        branch.includes('!hasSelfOverrideLoc && locToName && !_locAC.to_phone && !_locAC.to_email'),
        'all four isolation conditions must be present in one guard',
      );
    },
  },
  {
    id: 'b9x.time-branch-left-unchanged',
    category: 'rules',
    description: 'Phase 3 mandatory change 2 — the existing time-trigger intercept keeps lookup-contact and its phone-only filter; B9x does not retrofit it',
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('functions/v1/lookup-contact'),
        'the time-trigger intercept must still call lookup-contact',
      );
      expectTruthy(
        src.includes('const withPhone = allC.filter((c: Record<string, any>) => c.phone);'),
        'the time branch phone-only filter must be untouched — deliberately out of B9x scope',
      );
    },
  },
  {
    id: 'b9x.rule23-location-exemption-untouched',
    category: 'prompt',
    description: 'the single-turn location exemption survives — B9x adds resolution, never confirmation. "Alert me at Costco" must not start asking for confirmation',
    async run() {
      const prompt = readFileSync(PROMPT_PATH, 'utf8');
      expectTruthy(
        prompt.includes('RULE 23 NEVER applies to location alerts'),
        'the RULE 23 location exemption must remain in the prompt',
      );
      expectTruthy(
        prompt.includes('LOCATION ALERTS — IMMEDIATE SINGLE-TURN PATH (exempt from RULE 23)'),
        'the immediate single-turn path must remain',
      );
    },
  },
  {
    id: 'b9x.prompt-describes-what-the-server-actually-does',
    category: 'prompt',
    description: 'the prompt now states that the server resolves the recipient and asks when it cannot — and tells Claude never to substitute the user\'s own contact details for a third party',
    async run() {
      const prompt = readFileSync(PROMPT_PATH, 'utf8');
      expectTruthy(
        prompt.includes('WHAT THE SERVER NOW ACTUALLY DOES WITH action_config.to ON A LOCATION ALERT'),
        'the B9x prompt annotation must exist',
      );
      expectTruthy(
        prompt.includes('never substitute ${userName}\'s own contact details for a third party'),
        'the prompt must forbid substituting the user for a third party — the exact shape of the 2026-07-19 misdelivery',
      );
      expectTruthy(
        prompt.includes("const PROMPT_VERSION = '2026-08-27-b9x"),
        'PROMPT_VERSION must be bumped for this change (CLAUDE.md, shared-prompt rule)',
      );
    },
  },
];

/**
 * Coverage gaps acknowledged
 * -------------------------
 * These are source-assertion tests. They prove the fix is SHAPED correctly;
 * they do not exercise a live Claude turn.
 *
 * Not covered here, and covered instead by the Phase 7 live tests:
 *   - That Claude actually emits action_config.to for a named recipient on a
 *     location alert (prompt-dependent — Non-Determinism Rule requires 3
 *     independent trials per behaviour-changing case).
 *   - That "alert me at Costco" still completes in one turn end to end.
 *   - The live staging creation test required by Wael's Rule 17 ruling:
 *     a location alert naming someone not in contacts must ask, not save.
 *
 * Reproduction 2 (rule dadde218) is NOT covered by this fix at all and no
 * test here claims otherwise. Its stored rule contained no recipient field of
 * any kind, so there is nothing for resolution to engage on. Cause unproven —
 * see Phase 1 v2 §5.
 */
