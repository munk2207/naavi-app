/**
 * B11l — "text me" resolved to a stranger, and the confirmation card labelled
 * him "me".
 *
 * Wael said "text me" on the production app while running T12 Phase 7. Google
 * People API substring-matched the two letters "me" inside the surname
 * "Mehelmy", and the draft card rendered:
 *
 *     To: me (+1 438 765 0528)
 *
 * — a real stranger's real number, labelled with the user's own word for
 * themselves. He caught it by reading the digits and declining to press Send.
 * Re-measured live against production 2026-09-01: still 9 matches on that
 * account, the same stranger on top, while "Wael" returns his own number
 * correctly. The right record was available the whole time.
 *
 * TWO defects with independent root causes:
 *   A — "me" reached contact search at all. It denotes the user, whose number
 *       is on the same account making the request.
 *   B — the card echoed the user's word instead of naming who was matched.
 *       "To: me" reads as self-evidently safe; only the digits gave it away.
 *
 * B is why A was dangerous: CLAUDE.md Rule 12 requires a readback so the user
 * can "detect mis-resolutions immediately", and here the readback asserted the
 * wrong recipient in the user's own vocabulary.
 *
 * MOBILE ONLY. Voice was tested live three times (2026-09-01) and never once
 * guessed a recipient — it asks who, or asks when. Withdrawn from scope at
 * Phase 0 on that positive evidence, not on an absence of evidence.
 *
 * docs/B11L_PHASE0_INTENT_2026-09-01.md →
 * docs/B11L_PHASE1_PROBLEM_DEFINITION_2026-09-01.md →
 * docs/B11L_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-09-01.md (the defect
 * originates in Shared Core, not the client; two construction sites) →
 * docs/B11L_PHASE2_CHANGE_PLAN_2026-09-01.md v3 (contract: `to` is NOT
 * overwritten) → docs/B11L_PHASE3_TECHNICAL_REVIEW_2026-09-01.md
 *
 * Source-assertion tests. Coverage gaps acknowledged at the bottom.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const NAAVI_CHAT_PATH = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');

/** The helper, isolated from the rest of the file. */
function selfBranch(src: string): string {
  const start = src.indexOf('const SELF_RECIPIENT_TOKENS');
  const end   = src.indexOf('// ── Fallback speech for tool-only Claude responses', start);
  return start > -1 && end > start ? src.slice(start, end) : '';
}

/** The same branch with `//` comment lines stripped — assertions about what the
 *  code DOES, not what it says. The comments name lookup-contact in order to
 *  explain why it is absent, which a raw-source assertion cannot tell apart
 *  from code that calls it. */
function selfBranchCode(src: string): string {
  return selfBranch(src)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

export const b11lSelfRecipientTests: TestCase[] = [
  // ── The defect must not return ───────────────────────────────────────────
  {
    id: 'b11l.helper-exists-and-noops-for-non-drafts',
    category: 'rules',
    description: 'naavi-chat resolves a self-reference recipient server-side, and does nothing for any other action type',
    async run() {
      const branch = selfBranch(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      expectTruthy(branch.length > 0, 'resolveSelfRecipient must exist in naavi-chat');
      expectTruthy(
        branch.includes("if (action?.type !== 'DRAFT_MESSAGE') return { ok: true };"),
        'the helper must no-op for anything that is not a DRAFT_MESSAGE',
      );
    },
  },
  {
    id: 'b11l.whole-value-match-never-substring',
    category: 'rules',
    description: 'THE CORE CONTROL. The self-reference test is a whole-value match — substring matching is the exact mechanism of the bug being fixed ("me" inside "Mehelmy")',
    async run() {
      const code = selfBranchCode(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      expectTruthy(
        code.includes('SELF_RECIPIENT_TOKENS.has(rawTo.toLowerCase())'),
        'must match the whole trimmed value against a token set',
      );
      expectTruthy(
        !/rawTo\s*\.\s*includes\s*\(/.test(code) && !/\.startsWith\s*\(\s*['"]me/.test(code),
        'must NEVER substring- or prefix-match the recipient — that is the defect, not the fix',
      );
    },
  },
  {
    id: 'b11l.relationship-words-not-hijacked',
    category: 'rules',
    description: '"my wife" must keep reaching the relationship resolver — it is not a self-reference and must not be in the token set',
    async run() {
      const branch = selfBranch(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      const tokenBlock = branch.slice(0, branch.indexOf(']'));
      for (const forbidden of ['my wife', 'my husband', 'my son', 'my daughter', "'my'"]) {
        expectTruthy(
          !tokenBlock.includes(forbidden),
          `"${forbidden}" must not be a self-reference token — it belongs to relationship resolution`,
        );
      }
      expectTruthy(tokenBlock.includes("'me'") && tokenBlock.includes("'myself'"), 'the genuine self tokens must be present');
    },
  },
  {
    id: 'b11l.both-call-sites-wired',
    category: 'rules',
    description: 'THE §2e TRAP. naavi-chat builds DRAFT_MESSAGE in TWO places; a fix on one is invisible to every static check. B9x lost three live trials to exactly this',
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      const calls = src.match(/await resolveSelfRecipient\(/g) ?? [];
      expectTruthy(
        calls.length === 2,
        `resolveSelfRecipient must be awaited at exactly 2 call sites (deterministic path + Claude tool-use path); found ${calls.length}`,
      );
    },
  },
  {
    id: 'b11l.performs-no-contact-lookup',
    category: 'rules',
    description: 'This is NOT a second recipient handling — the B9x constraint at the Universal gate. The helper must never look a contact up',
    async run() {
      const code = selfBranchCode(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      for (const forbidden of ['lookup-contact', 'resolve-recipient', 'people.googleapis.com', 'searchContacts']) {
        expectTruthy(
          !code.includes(forbidden),
          `the helper must not call ${forbidden} — it rewrites a self token, it does not resolve contacts`,
        );
      }
    },
  },
  {
    id: 'b11l.to-is-never-overwritten',
    category: 'rules',
    description: 'THE CONTRACT (Phase 2 v3). `to` keeps meaning the requested recipient expression; resolution goes in separate fields. Overwriting it would silently hand a phone number to four consumers that expect a name',
    async run() {
      const code = selfBranchCode(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      expectTruthy(
        !/action\.to\s*=[^=]/.test(code),
        'the helper must NEVER assign action.to — that was v1 of the plan and was rejected on review',
      );
      expectTruthy(
        code.includes('action.to_phone =') && code.includes('action.to_email =') && code.includes("action.to_display = 'you'"),
        'resolution must land in to_phone / to_email, and the display identity in to_display',
      );
    },
  },
  {
    id: 'b11l.correct-source-per-destination',
    category: 'rules',
    description: 'Phone and email are NOT symmetric. user_settings has no email column — Phase 3 disproved that assumption, and Phase 2 v3 corrected it',
    async run() {
      const code = selfBranchCode(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      expectTruthy(
        code.includes("from('user_settings')") && code.includes("select('phone')"),
        'the phone destination must read user_settings.phone — the same column the time-trigger self-default reads',
      );
      expectTruthy(
        code.includes('auth.admin.getUserById(userId)'),
        'the email destination must read the account email via auth.admin.getUserById — user_settings has no email column',
      );
      expectTruthy(
        !code.includes("select('phone_numbers')") && !code.includes('phone_numbers'),
        'must use `phone`, not `phone_numbers` — that array exists to IDENTIFY a caller, not to send to them',
      );
    },
  },
  {
    id: 'b11l.admin-lookup-gated-to-email',
    category: 'rules',
    description: 'An SMS draft must not pay for an auth-admin round trip — the email lookup is gated behind channel === "email"',
    async run() {
      const code = selfBranchCode(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      const emailGate = code.indexOf("if (channel === 'email')");
      const adminCall = code.indexOf('auth.admin.getUserById');
      expectTruthy(emailGate > -1, 'there must be an explicit channel === "email" gate');
      expectTruthy(
        adminCall > emailGate,
        'the auth-admin call must sit inside the email branch, not run unconditionally',
      );
    },
  },
  {
    id: 'b11l.fails-closed-never-guesses',
    category: 'rules',
    description: 'Every failure path asks rather than sending. Falling through would return the caller to the contact search that produced this defect',
    async run() {
      const code = selfBranchCode(readFileSync(NAAVI_CHAT_PATH, 'utf8'));
      const failures = code.match(/return \{ ok: false, message: 'Who should I send the message to\?' \};/g) ?? [];
      expectTruthy(
        failures.length >= 3,
        `must fail closed on: no phone, no account email, and any thrown error. Found ${failures.length} of 3`,
      );
      expectTruthy(
        code.includes('catch (e)') && code.includes('console.error('),
        'the catch must log with context — AI Coding Discipline #21, no silent failures',
      );
    },
  },
];

/**
 * Coverage gaps acknowledged (Rule 15a).
 *
 * 1. These are SOURCE assertions, not behavioural ones. They prove the helper
 *    is written and wired at both sites; they cannot prove Claude routes
 *    "text me" to draft_message in the first place. That is a classifier
 *    decision and needs >= 3 live trials per the Non-Determinism Rule —
 *    carried as a Phase 7 requirement.
 *
 * 2. THE ORIGINAL DEFECT CANNOT BE REPRODUCED ON STAGING, AND A GREEN RUN HERE
 *    IS NOT EVIDENCE THAT IT IS FIXED. Measured 2026-08-21: lookup-contact for
 *    name="me" returns 0 results on both staging accounts and 9 on production.
 *    Same code, opposite outcome — the difference is the DATA. Staging's
 *    contact lists are deliberately controlled and hold no name containing
 *    "me", so nothing can match and nothing wrong can be offered. Verify
 *    against a contact list carrying a deliberate collision.
 *
 * 3. The mobile half — the card naming the matched contact, and send using the
 *    resolution already displayed — is client code the harness cannot reach.
 *    It needs a staging APK and a live test.
 *
 * 4. The compound auto-send path (useOrchestrator.ts:3230) sends with no card
 *    at all, and resolves the recipient AFTER consent was given. Not covered
 *    here; client-side, same gap as 3.
 */
