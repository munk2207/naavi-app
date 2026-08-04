# Travel Event Selection Semantics (Ticket B) — Phase 5 — Evidence Package (Deterministic Redesign)

**Date:** 2026-08-04
**Governance version:** v4.0
**Phase 4:** Implemented per Wael's go-ahead ("Go ahead on Phase 4") on the deterministic pre-selection design approved in `docs/TRAVEL_EVENT_SELECTION_SEMANTICS_PHASE3_REVIEW_PACKAGE_2026-08-03.md`'s resubmission round.

## What shipped

`supabase/functions/naavi-chat/index.ts`:
1. `isUnnamedNextEventTravelTimeIntent` — deterministic classifier, exact intercept/do-not-intercept scope as specified in Phase 3's mandatory change.
2. `buildNextEventTravelTimeResponse` — takes `fetchLiveCalendarEvents`'s existing sorted/filtered result as-is (no additional sort or filter — single source of truth), selects index `[0]`, resolves address via `location` falling back to `description`, and either returns a travel-time response or an honest "I don't have an address" response. No LLM call for this request shape.
3. Early-return bypass wired in right after the existing B6e calendar-read bypass, same pattern.
4. `MobileBriefItem` extended with three new optional fields (`startISO`, `rawLocation`, `rawDescription`) so the bypass can consume the one existing fetch directly, per the single-source-of-truth requirement.
5. `get-naavi-prompt/index.ts` — **not touched**. RULE 7 stays exactly as the marker-gated version left it, serving voice and any mobile phrasing the new classifier doesn't catch.

## A real bug found and fixed during this implementation — full disclosure

The first deploy of the raw-field extension had a `ReferenceError: start is not defined` — a variable referenced across two nested `.map()` closures that don't share scope. This silently crashed `fetchLiveCalendarEvents` for **every** caller, including the pre-existing, unrelated "what's on my calendar" bypass — which is what caused the "empty calendar" symptom investigated over the previous few messages. That symptom was not a token issue, not a duplicated-implementation divergence, and not caused by anything pre-existing — it was this bug, introduced by this implementation, live for the duration it took to find it. Root-caused by temporary diagnostic instrumentation (written to `client_diagnostics`, fully removed before the final deploy below) that surfaced the exact stack trace. Fixed by reading `e.start?.dateTime` directly instead of the out-of-scope variable. Confirmed via `git diff --stat` that only the intended Ticket B changes remain in the final deployed version.

## Test results — staging, live, `f1bc46b8-a478-43ad-bf09-e138099c8847` (Robert)

Full `calendar` category run, 39 tests: **37 passed, 0 failed, 0 errored, 2 skipped** (both pre-existing, unrelated — no dentist appointment currently on the test calendar; no "Fatma Elmehelmy" contact on this staging account).

**Direct reproduction of the exact sequence that failed live on Wael's phone (Phase 7, previous round):**
- "Drive me to my next meeting" → Team standup, 340 Albert St, 9:00 AM.
- "Drive me to my next event" → **identical**: Team standup, 340 Albert St, 9:00 AM.

Both phrasings now produce the same result, deterministically, by construction — the exact defect that caused Phase 7 to fail the marker-gated design is resolved by removing the decision from the LLM entirely.

**Named-event lookup ("Drive me to team standup") still fails** — but this is the separately-tracked B10z bug (`LIVE_CALENDAR_RE` gap), explicitly out of Ticket B's scope, unaffected by and unrelated to this change.

## Regression check

No regressions across the full calendar suite — event creation, calendar-search boundary, sync integrity, birthday-year handling, multi-user resolution, and all pre-existing B6e/session-dated tests remain green.

---

**Status:** Phase 4 implementation complete, Phase 5 evidence gathered, deployed to staging. Ready for Phase 6 (External Technical Review, after coding) pending Wael's approval to proceed.
