# Travel Event Selection Semantics (Ticket B) — Phase 5 — Evidence Package

**Date:** 2026-08-03
**Governance version:** v4.0
**Phase 4:** Implemented per Wael's explicit go-ahead ("Confirm. incorporating the marker-absent regression test.") and the Implementation Boundaries Confirmed in `docs/TRAVEL_EVENT_SELECTION_SEMANTICS_PHASE3_REVIEW_PACKAGE_2026-08-03.md`.

## Files changed (exactly the two authorized, nothing else)

1. `supabase/functions/get-naavi-prompt/index.ts` — RULE 7's Step 0 and NEXT/UPCOMING/SOONEST section rewritten into a marker-gated conditional: **Path A** (freshness marker present) trusts the schedule's first entry directly, stated as a positive chronological-order rule with no semantic-type override permitted; **Path B** (marker absent) preserves the original STEP 1-6 walk/parse/compare instructions and both original worked examples verbatim, relabeled but not altered. The named-event branch is explicitly unchanged in both paths.
2. `supabase/functions/naavi-chat/index.ts` — the `## [user]'s upcoming schedule` header now conditionally includes the marker phrase "sorted chronologically, past events already removed," gated on `needsLiveCalendar` (true only when `fetchLiveCalendarEvents` — the proven-guaranteed path — actually ran, never on the unverified `opts.briefItems` fallback).
3. `tests/catalogue/calendar.ts` — three new regression tests (below), registered automatically via the existing `calendarTests` array export (no `tests/runner.ts` changes needed).

No voice-server files touched. No opportunistic refactoring, cleanup, or unrelated changes — confirmed against the Phase 3 Implementation Boundaries.

## Deployment

Both functions deployed to **staging only** (`xugvnfudofuskxoknhve`), per the authorized boundary. Production untouched.

## Test results — staging, live, `f1bc46b8-a478-43ad-bf09-e138099c8847` (Robert)

Full `calendar` category run (37 tests, includes all pre-existing calendar tests plus the 3 new ones — run together specifically to catch any regression the RULE 7 rewrite might cause elsewhere): **35 passed, 0 failed, 2 skipped.** Both skips are pre-existing, unrelated to this change (no dentist appointment currently on the test calendar; no "Fatma Elmehelmy" contact on this staging account — both documented gaps predating Ticket B).

**The 3 new tests, all PASS:**
- `calendar.next-event-deterministic-first-entry` — 3 trials of "Drive me to my next event," identical destination every time.
- `calendar.no-semantic-type-override` — "next event"/"next meeting"/"next appointment" all resolved to the identical destination, confirming no type-based filtering (Wael's Problem B decision holds).
- `calendar.named-event-branch-preserved` — "Drive me to Team standup" still selects Team standup specifically, confirming the unnamed-branch rewrite didn't regress the named-event branch.

## Coverage gap — acknowledged, not silently skipped (Rule 15a)

**Reviewer-required test 4 ("marker absent: RULE 7 does not use the new first-entry shortcut") was not exercised as a live trial.** Reason, verified this session: `LIVE_CALENDAR_RE` — the same regex that gates whether the marker is emitted — matches every phrasing that would trigger RULE 7's next-event logic in the first place, so on mobile the marker is always present exactly when it would matter; there is no natural mobile request that reaches Path B. On voice, the marker is provably always absent (voice's own calendar-context code is untouched by this ticket), but staging has no voice deployment to call live (same gap as Tickets A/C). A direct, marker-bypassing Claude API call was considered as a workaround but requires an `ANTHROPIC_API_KEY` not currently provisioned in `tests/.env`.

**What was done instead:** direct source comparison, confirming RULE 7's Path B text (STEP 1-6 and both original worked examples) is preserved verbatim from the pre-change version — nothing in the fallback branch was altered, only relabeled and placed behind the marker check. This is documented in the test file's own header comment (`tests/catalogue/calendar.ts`) so the gap stays visible to future sessions, not just this record.

**Wael's decision, 2026-08-03:** accepted — source verification stands as sufficient evidence for now. **Mandatory carry-forward note, verbatim, required in Phase 6:** "Marker-absent behavior is verified by source comparison, not by live execution. It must be re-tested when a staging voice environment or safe direct Claude test harness becomes available." Does not block Phase 6 or staging acceptance.

---

**Status:** Phase 5 CLOSED — approved by Wael 2026-08-03, coverage-gap decision recorded. Proceeding to Phase 6 (External Technical Review, after coding).
