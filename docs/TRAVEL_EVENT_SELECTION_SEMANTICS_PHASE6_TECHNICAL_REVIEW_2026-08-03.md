# Travel Event Selection Semantics (Ticket B) — Phase 6 — External Technical Review Package (After Coding)

**Date:** 2026-08-03
**Governance version:** v4.0
**For:** External Technical Reviewer (ChatGPT), per governance §3 Phase 6.
**Prior phases:** Phase 0-5 in `docs/TRAVEL_EVENT_SELECTION_SEMANTICS_PHASE*_2026-08-0[2-3].md`. Implementation Boundaries authorized in Phase 3's resubmission decision (`PHASE3_REVIEW_PACKAGE`).

Note: these three files are uncommitted working-tree changes (no isolated commit exists yet — this session also carried Tickets A and C's own uncommitted changes on the same files/repo). The diff below is described directly from the actual edits made, not from a `git diff` that would mix in unrelated work.

## The Git Diff (described precisely — no isolated commit exists yet)

**1. `supabase/functions/get-naavi-prompt/index.ts` — RULE 7 rewritten (~63 net lines changed):**
- Added a new "SCHEDULE FRESHNESS MARKER" paragraph before Step 0, instructing Claude to check for the literal substring "sorted chronologically, past events already removed" in the schedule section header.
- Step 0 split into two named branches: named-event (unchanged) vs. unnamed-"next" (now points to the new Path A/B section).
- The former single "NEXT / UPCOMING / SOONEST" section is now two paths: **Path A** (marker present) — take the first listed event directly, with an explicit "event title/category/type must not override the first entry" rule and a 3-phrasing worked example (event/meeting/appointment all resolve to the same first entry). **Path B** (marker absent) — the original STEP 1-6 walk/parse/compare instructions, preserved verbatim, plus all three original worked examples, preserved verbatim, only relabeled "marker absent" for clarity.
- Net effect: zero deletions of working logic — the old logic still exists in full, now behind a condition, plus new logic added for the guaranteed case.

**2. `supabase/functions/naavi-chat/index.ts` — one conditional string, ~17 lines including comments:**
- The `## [userName]'s upcoming schedule` header is now built via a `scheduleHeader` variable: when `needsLiveCalendar` is true (meaning `fetchLiveCalendarEvents` — the function proven in Phase 1 to guarantee sort + past-filter — actually ran, not the unverified `opts.briefItems` fallback), the header includes the marker phrase; otherwise it's emitted exactly as before, unmarked.
- No change to `fetchLiveCalendarEvents` itself, no change to any other function.

**3. `tests/catalogue/calendar.ts` — 3 new tests + a documentation header (~110 of the 352 total diff lines are Ticket B's; the remainder are Ticket A/C's own earlier test additions from the same uncommitted session, already reviewed in their own Phase 5/6):**
- `calendar.next-event-deterministic-first-entry`, `calendar.no-semantic-type-override`, `calendar.named-event-branch-preserved` — described in Phase 5.
- A coverage-gap comment block documenting why reviewer-required test 4 (marker-absent) can't be live-tested, matching the Phase 5 record.

## Architecture impact

- **Ownership:** RULE 7 lives in `get-naavi-prompt` (Shared Core, unchanged ownership). The marker lives in `naavi-chat` (also unchanged ownership — this is Mobile's entry point into Shared Core, not a new component). No capability moved owner.
- **Duplication:** Not increased. The live-fetch capability (`naavi-chat` vs. voice) remains Duplicated exactly as before — this change adds no new independent implementation of anything; it adds one conditional to an existing shared prompt.
- **Entry-point responsibility:** `naavi-chat` still only translates (it decides whether to attach a marker string, a data-availability fact it already knows from having called the fetch itself) — it does not implement any new business logic; the actual event-selection decision remains entirely inside the shared prompt/Claude.
- **API contracts:** Unchanged. No request/response shape changed on any Edge Function.
- **Protected Core:** Calendar integration, already Protected Core, not expanded to a new area.

## Invalidated Planning Assumption (governance §3 Phase 6, mandatory disclosure)

**What Phase 2/3 assumed:** that reviewer-required test 4 (marker-absent behavior preservation) could be satisfied with some combination of live trials and/or prompt-text review, without fully specifying which.

**What Phase 4/5 discovered instead:** it cannot be live-tested through *any* natural request path on either surface. On mobile, `LIVE_CALENDAR_RE` — the exact regex gating the marker — also gates whether RULE 7's next-event logic is ever relevant, so a marker-absent state can never co-occur with a "next event" query through the real pipeline. On voice, the marker-absent state is real and permanent (by design — voice's code isn't touched), but staging has no voice deployment to call. This is a **planning assumption invalidated during implementation**, not an implementation error and not a scope cut — the assumption "some test is achievable" turned out to be architecturally false once actually attempted, not merely undone.

**Resolution:** source-comparison verification (old Path B text preserved verbatim, confirmed by direct diff of the actual edit) accepted by Wael as sufficient for now, with a mandatory carry-forward note: **"Marker-absent behavior is verified by source comparison, not by live execution. It must be re-tested when a staging voice environment or safe direct Claude test harness becomes available."** Does not block this Phase 6 or staging acceptance, per Wael's explicit decision, 2026-08-03.

## Regression risk

Full `calendar` test category re-run (37 tests, not just the 3 new ones) to catch any collateral effect of rewriting a large, heavily-shared prompt rule: **35 passed, 0 failed, 2 skipped** (both pre-existing, unrelated to this change — no dentist appointment currently on the test calendar, no "Fatma Elmehelmy" contact on this staging account). No regression detected in any calendar-adjacent behavior (event creation, calendar-search boundary, sync integrity, birthday-year handling, multi-user resolution).

## Isolation

RULE 7 is a single, self-contained instruction block. The marker-gate is additive (a new precondition check), not a restructuring of surrounding rules — RULE 6 and RULE 8 (immediately before/after) are untouched, confirmed by direct read of the surrounding text before and after the edit.

## Test coverage

See Phase 5 Evidence Package in full. Summary: 3/3 new tests pass; 0 regressions across the full calendar suite; 1 acknowledged, Wael-approved coverage gap (marker-absent live behavior) carried forward with a mandatory re-test note, not treated as resolved.

## What we're asking you to evaluate

Per governance §3 Phase 6: the four required verdicts (Technical Review, Architecture Completeness, Governance Compliance, Overall Recommendation). Please specifically assess whether the Invalidated Planning Assumption disclosure above is handled correctly per governance's own rule for this situation, and whether the marker-gated design itself is architecturally sound now that it's implemented (not just as planned).

---

## Reviewer Decision — received 2026-08-03 — APPROVED WITH MANDATORY FOLLOW-UP

- **Technical Review: PASS.** Marker-gated design confirmed sound — marker present uses the first already-sorted future event, marker absent preserves the original selection process, named-event selection stays separate. Full calendar suite: 35 passed, 0 failed.
- **Architecture Completeness: PASS.** `naavi-chat` states a fact it already knows (whether the supplied schedule is sorted/past-filtered); shared RULE 7 decides how to use that fact. Voice unchanged, receives no marker. No new duplication, no API changes.
- **Governance Compliance: PASS WITH NOTE.** The invalidated planning assumption was handled correctly — disclosed explicitly, not hidden as a skipped test, replaced with source-comparison evidence, accepted by Wael, carried forward for later live verification.

**Mandatory follow-ups:**
1. **Before production:** isolate the changes in a clean commit or reviewable patch. The working tree currently mixes Tickets A, B, and C — production promotion should not rely on a narrative description of which lines belong to Ticket B alone.
2. **Retain the open evidence note** verbatim: "Marker-absent behavior is verified by source comparison, not live execution, and must be tested when voice staging or a safe direct-Claude harness becomes available." Does not block Ticket B.

**Overall Recommendation:** Technically complete on staging, may proceed to Phase 7 user validation. Production promotion should follow only after the Ticket B diff is isolated and Wael's live testing confirms deterministic unnamed-event selection and preserved named-event behavior.

---

**Status:** Phase 6 CLOSED — Approved with Mandatory Follow-Up. Per governance §3's Phase-Gate Approval Rule, this reviewer verdict is not itself authorization for Phase 7 — awaiting Wael's own separate, explicit approval.
