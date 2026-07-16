# Session Handoff — 2026-07-16 — F19 Track B-1e/B9z closed, parity audit corrected, B10a found (serious, Phase 1 approved), architecture initiative started

## Next session priority (explicit): B10a Phase 2 — design the fix

`docs/B10A_PHASE1_PROBLEM_DEFINITION_2026-07-16.md` is written and Approved (9.8/10 confidence). Root cause proven: voice silently redirects third-party time-trigger SMS/WhatsApp alerts to the user's own phone instead of the named contact — a 2026-05-24 fallback (`naavi-voice-server/src/index.js:4725-4739`, "B4y") runs before a 2026-07-06 fix (`:4755-4787`, F12 named-recipient resolution) and unconditionally satisfies F12's guard condition first, so resolution never runs whenever a real contact is named. Location-trigger alerts are confirmed unaffected. Start next session by reading that document, then write Phase 2 — two candidate approaches are already sketched in its §6, but the fail-open-vs-fail-closed policy question is deliberately left as an explicit Phase 2 decision, not pre-selected by Phase 1.

**Do not re-run F19 Track B-1d's original live-test procedure — it's what surfaced B10a, and B10a supersedes it with sharper evidence. Don't reopen 1d as if unresolved.**

---

## What happened this session, in order

### Part 1 — F19 Track B-1e: root cause found and fixed

1. Continued from a prior handoff's stated priority (F19 Track B Phase 2, planning 1e's investigation). Ran the widened 1e/barge-in diagnostic logging (already shipped) live, twice, on production voice.
2. Live trace showed the confirm-gate loop was **not** caused by either of Phase 1's original two hypotheses (STT/barge-in corruption, prompt-level ambiguity) — found via direct Railway log tracing that `naavi-voice-server` executed the `SET_ACTION_RULE` write as a fire-and-forget background action *after* speaking, discarding the result. Root cause written up as Phase 1's third and fourth revisions (`docs/F19_TRACKB_PHASE1_PROBLEM_DEFINITION_2026-07-15.md`).
3. Fourth revision also corrected an earlier wrong citation: the 409 conflict's actual cause was `action_rules_user_label_unique` (a constraint with no git-tracked origin and no `enabled` scoping), not the datetime-based index originally suspected — this became B9z (below).
4. Designed and implemented the fix: `naavi-voice-server/src/action_rule_confirm_gate.js` (new file, mirrors the already-proven `list_confirm_gate.js` pattern) — time-trigger `SET_ACTION_RULE` now stores as pending on proposal, executes exactly once on explicit "yes," speaks the real result. Shipped as commit `74a05d6`. Verified live, twice, with clean transcripts — confirm-gate fires once, truthful result both times.
5. Governance: Phase 1 (4 revisions) → Phase 2 (4 revisions, including §5a's two-question design analysis: truthfulness of feedback vs. conversation control) → Phase 3 (7 review rounds total across the whole Track B lifecycle) → Phase 4 (implementation) → all Approved.

### Part 2 — B9z: spun out, full 7-phase lifecycle, closed

6. While verifying 1e's fix live, found `action_rules_user_label_unique` blocking a legitimate alert recreation — a **disabled** row from the prior day still collided with a new insert sharing its label. Per a rule agreed in advance (Phase 2 §5b's predefined outcome table), this became its own ticket: **B9z**.
7. Full lifecycle, all Approved: `docs/B9Z_PHASE1_PROBLEM_DEFINITION_2026-07-16.md` (root cause — the constraint has no `enabled=true` scoping and no git-tracked origin) → Phase 2 (chose the minimal fix, explicitly deferred a broader dedup-key redesign) → Phase 3 (2 rounds — pre-migration verification query + rollback + a 6th acceptance criterion added) → Phase 4 (migration applied to staging by me directly via `supabase db query`, then production by Wael via SQL editor, both verified byte-identical) → Phase 5 (evidence package, split into 5A implementation / 5B behavior verification per review feedback — all 4 remaining acceptance criteria tested via SQL simulation on staging, all passed) → Phase 6 (post-coding review) → Phase 7 (automated: found and fixed a real test-isolation bug in my own new tests along the way, commit `b044d1c`; manual: two real voice calls, both confirmed working).
8. Migration: `supabase/migrations/20260716000000_scope_action_rules_label_unique.sql` (commit `29105ed`) — first git-tracked record of this constraint, closes one instance of T1a.

### Part 3 — Parity audit corrected, F19 holding-list entry corrected

9. Wael pointed out a real gap in my own process: I hadn't updated `docs/MOBILE_VS_VOICE_PARITY_AUDIT_2026-06-12.md` to reflect that B9z/1e's confirm-gate fix is voice-only — mobile's equivalent `SET_ACTION_RULE` creation code (`useOrchestrator.ts`) was never touched or checked against the same defect class. Fixed (commit `d1e81ed`) — flagged as genuinely unverified, not assumed broken or assumed safe.
10. F19's own holding-list entry was stale (still said "Phase 1 complete, Phase 2 not started" despite most of it closing this session). Corrected (commit `3fc42d6`) to show exactly what's closed vs. still open.

### Part 4 — The bigger architecture conversation

11. Wael made an architectural point, proven by the session's own events: Mobile and Voice are two independently-built systems that happen to share a database, not one core with two entry points. Confirmed with concrete evidence (duplicate confirm-gates, duplicate write paths, duplicate tool schemas).
12. Discussed three possible directions: full centralization (shared service), auto-synced duplicates (shared library + sync mechanism), or hybrid split by complexity. Agreed the right first step is an inventory before choosing.
13. Wrote `docs/CORE_VS_ENTRY_POINT_INVENTORY_2026-07-16.md` — **explicitly in plain, non-technical language** per Wael's direct request (he needs to personally read and use this, not just have it exist). Covers every capability, shared vs. duplicated, verified vs. assumed, rough complexity to unify. Most rows marked "believed shared, not personally re-verified this session" — an honesty flag, not a claim.
14. **This initiative has not started implementation in any way — inventory only, no decision made between the three options.**

### Part 5 — F19 Track B-1d finally tested — found B10a instead

15. Ran F19 Track B-1d's own live-test procedure (a real call, "Text Bob when I arrive at Costco" for location — worked correctly, confirms 1c). Then tested the equivalent for a **time-trigger**: "Text Bob... in 3 minutes."
16. This surfaced a real, more serious bug: the SMS went to Wael's own phone, not Bob's — despite Bob being correctly found by the pre-context contact lookup and Claude correctly emitting `to:"Bob"`. Traced via full Railway log evidence (contact lookup → Claude tool call → confirm-gate → execution → stored row → actual delivery) to an exact two-line ordering defect between a 2026-05-24 fallback and a 2026-07-06 fix. Written up as **B10a**, `docs/B10A_PHASE1_PROBLEM_DEFINITION_2026-07-16.md`, reviewed and Approved (9.8/10 confidence), four editorial refinements adopted.
17. Along the way, discovered (and resolved) a real distraction: Wael's Google OAuth connection had gone stale (`invalid_grant`) mid-session — required reconnecting via Settings. Also confirmed the F8c scope-check modal (`checkGrantedScopes`) is reactive (warns after a failed grant) not proactive (can't warn before the very first attempt) — a known, real UX gap, not investigated further.

---

## What did NOT happen this session

- B10a has no Phase 2 yet — root cause proven, fix not designed or implemented.
- The architecture initiative has no decision and no implementation — inventory only.
- F19 Track C (1f, mobile promotion to production) — still not started, still blocked on F17 Phase 7.
- F17 Phase 7 — should be re-opened (what it was frozen on is now closed) but has **not** been re-run this session. Don't assume it passes.
- The barge-in/STT truncation bug (`project_naavi_deepgram_first_word_truncation`) — still open, pre-existing since April, reproduced again this session, not fixed.
- B9y's digit-capture inconsistency (distinct from the now-fixed confirm-loop symptom) — still not root-caused, reproduced twice this session, confirmed intermittent (second identical attempt captured correctly).
- Mobile's `useOrchestrator.ts` — not checked against B9z's defect class, not checked against B10a's defect class either. Both are open questions about mobile, not assumptions in either direction.

---

## State at handoff

| Item | Status |
|---|---|
| F19 Track A | Closed (prior session) |
| F19 Track B-1c | Closed (prior session) |
| F19 Track B-1e | **Closed this session** — confirm-gate shipped, verified live twice |
| B9z | **Closed this session** — full 7-phase lifecycle, Approved throughout |
| F19 Track B-1d | **Superseded by B10a** — do not reopen or re-run its original procedure |
| B10a | **Phase 1 Approved. Phase 2 not started — next session's priority.** |
| F19 Track C / 1f (mobile promotion) | Not started, blocked on F17 Phase 7 |
| F17 Phase 7 | Should be re-opened (blocker cleared), not yet re-run |
| Barge-in/STT truncation bug | Open, pre-existing, unfixed |
| B9y digit-capture inconsistency | Open, pre-existing, confirmed intermittent |
| Mobile vs. Voice architecture initiative | Inventory written, no decision made, no implementation started |
| Parity audit | Corrected and current as of this session |

---

## Documents produced this session (all in `docs/`, all committed and pushed)

`F19_TRACKB_PHASE1_PROBLEM_DEFINITION_2026-07-15.md` (3rd + 4th revisions), `F19_TRACKB_PHASE2_CHANGE_PLAN_2026-07-15.md` (3rd + 4th revisions), `F19_TRACKB_PHASE3_TECHNICAL_REVIEW_2026-07-15.md` (rounds 3-7), `B9Z_PHASE1_PROBLEM_DEFINITION_2026-07-16.md`, `B9Z_PHASE2_CHANGE_PLAN_2026-07-16.md`, `B9Z_PHASE3_TECHNICAL_REVIEW_2026-07-16.md`, `B9Z_PHASE5_EVIDENCE_2026-07-16.md`, `B9Z_PHASE6_TECHNICAL_REVIEW_2026-07-16.md`, `B9Z_PHASE7_TESTING_2026-07-16.md`, `B10A_PHASE1_PROBLEM_DEFINITION_2026-07-16.md`, `CORE_VS_ENTRY_POINT_INVENTORY_2026-07-16.md` (plain-language), `MOBILE_VS_VOICE_PARITY_AUDIT_2026-06-12.md` (corrected), `HOLDING_LIST_CLASSIFICATION_2026-06-11.md` (multiple corrections). Code: `naavi-voice-server/src/action_rule_confirm_gate.js` (new), `naavi-voice-server/src/index.js` (confirm-gate wiring, diagnostic logging added then removed), `supabase/migrations/20260716000000_scope_action_rules_label_unique.sql` (new), `tests/catalogue/data-integrity.ts` (4 new tests + an isolation-bug fix).

## Groundwork already done — don't re-derive

- **`tests/.env` has real production credentials** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TEST_USER_ID`) — I incorrectly checked the wrong `.env` file early this session and concluded I had no way to run the auto-tester myself. That was wrong; `npm run test:auto` (and direct `curl`/Edge-Function calls using the same credentials) are both available directly, no need to ask Wael to run things I can run myself.
- **Auto-tester is now 420 tests** (416 + 4 new B9z integrity tests), full run takes ~5 minutes. Current known-stale failures, unrelated to anything this session touched: `b6d.prompt-version-bumped-to-v98` and `session-2026-05-28.b6d-prompt-version-v100` (stale expected-version string), `voice.calendar-today-query` (wording mismatch, answer is correct), `f10a.website-nav-feedback-link-homepage-only`. Two pre-existing skips (Google OAuth not connected for the *test* user specifically — separate from Wael's own account issue below).
- **Staging DB access:** `npx supabase db query --db-url "postgresql://postgres.xugvnfudofuskxoknhve:NaaviStaging2026@aws-1-us-east-1.pooler.supabase.com:6543/postgres?prefer_simple_protocol=true" "<SQL>"` works directly for single-statement queries (multi-statement files fail with "cannot insert multiple commands into a prepared statement" — run statements separately). No equivalent direct access to production; production SQL still goes through Wael via the dashboard.
- **Bob (test contact) has one real card**, not two: name "Bob," phone `+13433332567`, email `aggan2207@gmail.com` (this looks like it could be confused for Wael's own info at a glance — it isn't; it's genuinely Bob's own saved email). An earlier hypothesis this session (that there might be two different "Bob" contacts) was wrong and was corrected once Wael showed the actual contact card.
- **Wael's Google OAuth token went stale mid-session** (`invalid_grant: Token has been expired or revoked`) — required reconnecting via Settings → Connected Services. The app's own scope-verification feature (`checkGrantedScopes` / F8c, `lib/supabase.ts:126`, `app/index.tsx:990-1002`) is confirmed working but **reactive only** — it can warn after an incomplete OAuth grant, but can't warn before the very first attempt, since there's nothing to check yet. This is a known, real, un-investigated UX gap (not the cause of the token going stale in the first place, which remains unexplained).
- **`naavi-voice-server`'s general (non-location) `SET_ACTION_RULE` handler** is the one with B10a's defect — the location-trigger handler (`:11375-11414`) is a structurally different code path, confirmed unaffected by direct read. Any future work on recipient resolution should check which handler is in scope before assuming a fix applies to both.
