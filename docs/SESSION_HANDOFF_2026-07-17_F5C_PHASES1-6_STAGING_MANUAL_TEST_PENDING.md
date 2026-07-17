# Session Handoff — 2026-07-17 (continued) — F5c Phases 1-6 complete and Approved, deployed to staging, manual verification of the core fix still pending

## ⭐⭐⭐ Next session priority (explicit): finish F5c's manual verification, then decide on production

**This session took F5c from "no Phase 1 written" through all six governance phases (all Approved), implemented the fix, deployed it to staging, and started live manual testing. Two of three required manual tests passed. The single most important test — does the fix actually refuse to send when a name is genuinely ambiguous — has NOT been run successfully yet.** Do not re-derive the governance chain; read this handoff and the six Phase docs, then continue from "What's left" below.

**Full governance record, in order (all in `docs/`):**
`F5C_PHASE1_PROBLEM_DEFINITION_2026-07-17.md` → `F5C_PHASE2_CHANGE_PLAN_2026-07-17.md` → `F5C_PHASE3_TECHNICAL_REVIEW_2026-07-17.md` → `F5C_PHASE5_EVIDENCE_2026-07-17.md` → `F5C_PHASE6_TECHNICAL_REVIEW_2026-07-17.md`. All Approved. (No separate "Phase 4" doc — Phase 4 is the implementation act itself; see the note in `project_naavi_f5c_taskactions_defect.md` memory about two old, mislabeled files elsewhere in `docs/`.)

**The fix, in one sentence:** `supabase/functions/evaluate-rules/index.ts`'s F5c block (fire-time `task_actions[].to_name` resolution) now refuses to guess — it requires exactly one `lookup-contact` match before sending, rejects names under 2 characters as defense-in-depth, and logs one of four distinct reasons (`name_too_short`, `zero_matches`, `ambiguous_multiple_matches`, `no_resolved_destination`) whenever it doesn't send.

---

## What's left (in order)

1. **Run the one test that actually proves the fix works: a genuinely ambiguous name reaching fire time unresolved, and confirming nothing gets sent.** Two attempts this session failed to reach this condition (see "What went wrong with testing," below) for reasons that have nothing to do with the fix itself. A plan for the next attempt is laid out below — don't re-derive it from scratch.
2. Once that passes: the other two Phase 5 manual tests (safe single-match path sends correctly; primary self-alert fires regardless of task_action outcome) **already passed this session** — see evidence below. No need to repeat unless something regresses.
3. Only after all three pass, and only on Wael's own explicit instruction, promote to production (`hhgyppbxgmjrwdpdubcx`).
4. **Commit everything.** As of this handoff, nothing beyond Phase 1 is committed — the code fix, the new test file, `tests/runner.ts`'s registration, and all of Phase 2/3/5/6 docs are still sitting uncommitted in the working tree. Ask Wael before committing (per his standing rule, don't assume "go with deploy" or "go" on a phase covers committing too — it hasn't, this session, and he corrected that assumption once already).

---

## Current state, precisely

- **Code change:** `supabase/functions/evaluate-rules/index.ts`, F5c block only, +19/-2 lines. Matches Phase 3's Implementation Boundaries exactly. Syntax-checked (`npx tsc --noEmit`, zero TS1xxx errors).
- **Tests:** `tests/catalogue/session-2026-07-17-f5c-taskactions-resolution.ts` (5 new tests), registered in `tests/runner.ts`. Full `npm run test:auto`: 431 tests, 426 passed, 0 failed, 3 errored (pre-existing/unrelated), 2 skipped (pre-existing/unrelated). Satisfies Rule 15a.
- **Deployed:** staging only (`xugvnfudofuskxoknhve`), via `npx supabase functions deploy evaluate-rules --no-verify-jwt --project-ref xugvnfudofuskxoknhve`, confirmed success. **Production untouched.**
- **Committed:** only Phase 1 (`f1f95cb`). Everything else — the code fix, the test file, `tests/runner.ts`, and Phase 2/3/5/6 docs — is uncommitted.
- **Holding list:** two new items logged this session, both found incidentally while manually testing F5c, neither part of F5c's own scope — **B10e** (duplicate SMS sends on a combined self-reminder + `task_actions` alert) and **B10f** (staging's alert-firing clock runs several minutes late and inconsistently). Both open, neither root-caused, neither has a Phase 1.

---

## Manual test results, this session (staging, real Twilio sends)

Per `docs/F5C_PHASE5_EVIDENCE_2026-07-17.md`, three manual tests are mandatory before this is operationally verified. All testing happened on the **Naavi Staging app**, staging test account `user_id = ae1f3438-e132-422a-9b0b-7b8819119b46`. **Note on this test account's contacts:** "Bob" and every "David" contact created this session resolve to the *same* phone number as the test account's own registered number — a test-data artifact (not a bug), which is why every send this session landed on the same physical device regardless of intended recipient. Don't be confused by that when reading `sent_messages` evidence in future sessions.

### Test 2 — safe path (exactly one match still sends correctly): **PASSED**
Rule `25c70a42` (task_actions: Bob → "goodnight", "David James" → "good morning") fired at 5:00 AM EST (13 min late, see B10f). Both resolved to their single real contact and sent — confirmed via `sent_messages`. (Sent twice each due to B10e's separate duplicate-send bug — the *resolution* was still correct both times, just the *send count* was wrong, an unrelated issue.)

### Test 3 — primary alert fires regardless of task_action outcome: **PASSED (partially, by coincidence)**
Same rule's primary self-reminder ("Check email") fired via SMS/WhatsApp/voice alongside the task_actions. Confirms ordering is intact. Not yet tested in the specific failure scenario (task_action fails closed AND primary still fires) — only tested where both succeeded. Worth a clean re-run once Test 1 is achieved, to see both outcomes in the same fire.

### Test 1 — genuinely ambiguous name is refused, nothing sent: **NOT YET ACHIEVED**

**Attempt 1:** "In 2 minutes, text A good morning" (single-message, no self-reminder attached). **Failed to test the fix at all** — this phrasing has no self-reminder, so the message routed through the *primary* recipient field (`to`/`to_phone`), not `task_actions`. The letter "A" was silently dropped as noise, and the whole thing became a self-alert. Confirmed via `sent_messages`: SMS+WhatsApp+voice, all to the user's own number, body "Good morning. To do: Good morning.." — nobody named "A" was ever contacted. Lesson: `task_actions` only gets created when a message combines a self-reminder AND a third-party send in the same request (per `get-naavi-prompt`'s own "SELF-ALERT PRIMARY RULE").

**Attempt 2:** "text david saying good morning" alone (no self-reminder) — same problem, routed to primary `to`/`to_phone` again, correctly showed a disambiguation picker (pre-existing, working code, not what this fix touches), Wael picked "David James."

**Attempt 3:** "Remind me in 2 minutes to check email, and text Bob goodnight, and text David good morning too" — correctly shaped as self-reminder + two `task_actions` entries. **Still didn't test ambiguity**, for a subtler reason: this was the *same ongoing chat conversation* as Attempt 2, and Naavi appears to carry forward conversational context — it used "David James" (the exact contact Wael had picked two messages earlier) instead of the bare ambiguous "David," so the fire-time lookup found exactly one match and sent successfully (this is Test 2's pass, above — a real, useful result, just not Test 1).

**Investigated, not resolved:** where does this cross-message "memory" of the David pick live? Checked `knowledge_fragments` and `pending_actions` on staging, scoped to the exact test user — both empty. Searched every `CREATE TABLE` in the entire migrations folder — no chat-history/conversation table exists anywhere in the schema. **Conclusion: no backend database table is responsible for this** (as far as this session's search could find) — it's most likely the mobile app's own client-side conversation state (or Claude's normal in-context conversation memory within one continuous chat thread), not something clearable from the Supabase side. Not conclusively proven either way — nobody tested a genuine full app force-close + reopen to see if the same context persists.

**Planned next attempt (not yet executed):** create three new contacts sharing a first name **that has never been mentioned anywhere in the existing staging conversation** — "Sarah" was agreed as the name (three contacts: Sarah + three different last names, mirroring the David setup). Wael was about to create them when the session ended. Then send, in the *same or a new* conversation (doesn't matter now, since "Sarah" carries no prior context either way): **"Remind me in 2 minutes to check email, and text Bob good morning, and text Sarah good morning too"** — Bob first (resolves cleanly, silently, at write time, per mobile's own existing first-entry-only resolution logic), Sarah second (mobile's write-time resolver only checks the *first* unresolved name in `task_actions`, so Sarah is left untouched and reaches fire time genuinely unresolved — this is the condition needed to exercise the actual F5c fire-time code).

**After sending:** check the `action_rules` row immediately (before it fires) to confirm Sarah's `task_actions` entry has no `to_phone` — use `scripts/diag-f5c-staging-test1.js` (already written this session, queries staging `action_rules` ordered by `created_at`). Then wait for it to fire — **expect several minutes' delay, not the scheduled time** (see B10f) — and check `scripts/diag-f5c-staging-test1-sent.js` for the result. **Pass condition: no `sent_messages` row for "Sarah" at all.** (Checking Edge Function logs for the `ambiguous_multiple_matches` line would be stronger evidence than absence-of-send alone, but wasn't attempted this session — Supabase dashboard → `evaluate-rules` → Logs, filtered to the firing time.)

---

## Reusable diagnostic scripts from this session (all in `scripts/`, all uncommitted)

- `diag-f5c-staging-test1.js` — pulls the 10 most recent staging `action_rules` rows (id, trigger, config). Use this to inspect a rule immediately after creating it, before it fires.
- `diag-f5c-staging-test1-sent.js` — pulls the 10 most recent staging `sent_messages` rows. Use this to check what actually fired.
- `diag-f5c-staging-knowledge.js` — checks `knowledge_fragments` for the test user (both content-filtered and unscoped-recent). Confirmed empty this session.
- `diag-f5c-staging-pending.js` — checks `pending_actions` for the test user. Confirmed empty this session.

All four read `STAGING_SUPABASE_URL`/`STAGING_SUPABASE_SERVICE_ROLE_KEY` from `tests/.env` (already present, verified working). Test user id is hardcoded in the pending/knowledge scripts as `ae1f3438-e132-422a-9b0b-7b8819119b46` — confirmed as the account behind every alert created this session, but reconfirm if a different staging account is used next time.

---

## Governance/process notes for next session — don't repeat these mistakes

- **Wael reinforced, twice this session, that document/reviewer approval of one phase is never permission to start the next phase's work.** Even "the reviewer said approved" doesn't authorize opening the next phase's document — that needs Wael's own separate, explicit word, every time. This is `feedback_governance_phase_gate_wait` in memory, and it was violated and corrected twice in this session alone before being internalized. Don't re-violate it next session.
- **Always show times in EST, never UTC** — violated once this session (mid-testing), corrected on the spot. `CLAUDE.md`'s existing rule, not new.
- **"Manual test" specifically means Wael performing the real end-user-facing action himself** — a script I run against the same staging backend, however real the infrastructure it hits, does not count, even if it's the closest thing to it. Confirmed explicitly by Wael this session. Don't conflate "scripted staging verification" with "Manual test" in any future Evidence Package.
- **Test message design matters more than it looks.** A message needs a self-reminder attached to produce a `task_actions` entry at all; and within an ongoing conversation, a previously-disambiguated name won't re-trigger ambiguity checking. Both of these cost real testing time this session — internalize them before designing the next test message rather than rediscovering them.

---

## Also open, not touched this session beyond logging

- **B10e** — duplicate SMS sends (task_actions entries sent twice, one self-alert channel duplicated) on staging. Found once, not reproduced independently, not root-caused.
- **B10f** — staging's alert-firing clock runs 3-13 minutes late and inconsistently. Found 3 times this session. Makes time-boxed manual testing unreliable without polling the DB directly (which is what this session did throughout).
- **F5c's own deferred items** (Phase 2 §5, Phase 3 §3) remain deferred, not started: mobile's first-entry-only `task_actions` resolution gap, giving voice its own write-time resolution, the upstream "why did 'abc' split into three letters" question, and the identity-resolution-service architectural idea.
