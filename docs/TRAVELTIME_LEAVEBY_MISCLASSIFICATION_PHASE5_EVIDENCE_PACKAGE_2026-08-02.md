# Travel-Time / Leave-By Misclassification — Phase 5 — Evidence Package

**Date:** 2026-08-02
**Governance version:** v4.0
**Phase 3:** Approved with Mandatory Changes — `docs/TRAVELTIME_LEAVEBY_MISCLASSIFICATION_PHASE3_TECHNICAL_REVIEW_2026-08-02.md`
**Implementation scope:** exactly the 3 files authorized in Phase 3's Implementation Boundaries. No other file touched.

## Summary

Added a meaning-based "travel-planning exclusion" to `naavi-chat`'s `classifyIntent` prompt so leave-by/travel-time questions ("what time should I leave...", "when should I head out...", "how early do I need to go...") are never classified `READ_CALENDAR` or `CALENDAR_SEARCH` — they now return no Level A intent and fall through to the full Claude/RULE 7 path, which is the only system that knows how to call `fetch_travel_time`. Extended `tests/catalogue/calendar.ts` with 4 new regression tests covering both deterministic-handler boundaries, per Phase 3's Mandatory Changes 1-5. Deployed to **staging only**, per Phase 2 Amendment 7 and Phase 3's Implementation Boundaries. Production is untouched.

## Files Changed

1. `supabase/functions/naavi-chat/index.ts` — added one new instruction paragraph to `classifyIntent`'s system prompt (net +2 lines in `git diff --stat`, the paragraph itself is one large added block; no existing lines removed).
2. `tests/catalogue/calendar.ts` — added 4 new test cases + 1 local helper function + 2 pattern constants (+177/-1 lines).
3. `tests/runner.ts` — **no edit needed.** `calendarTests` is already spread wholesale (`...calendarTests`) into `ALL_TESTS`; the new tests in `calendar.ts` are automatically registered by that existing mechanism. Confirmed live in the test run below (new test IDs appeared in the run without any runner.ts change).

## Git Diff

```
$ git diff --stat -- supabase/functions/naavi-chat/index.ts tests/catalogue/calendar.ts
 supabase/functions/naavi-chat/index.ts |   2 +
 tests/catalogue/calendar.ts            | 177 ++++++++++++++++++++++++++++++++-
 2 files changed, 178 insertions(+), 1 deletion(-)
```

Full diff available via `git diff` in the working tree — not yet committed (matches this session's established pattern for `resolve-place`, which was also deployed before commit).

**The exact instruction added to `classifyIntent`** (per Phase 3 Mandatory Changes 1-3 — explicit fallback, `CALENDAR_SEARCH` boundary protection, meaning-based not keyword-only):

> TRAVEL-PLANNING EXCLUSION (checked before applying CALENDAR_SEARCH or READ_CALENDAR above): questions asking when the user should leave, depart, head out, begin travelling, or how early they must go to reach a calendar event are travel-planning requests — not calendar reads and not calendar searches, even when they name a specific event. This classifier has no travel-time tool; only the main assistant does. Never classify these as READ_CALENDAR or CALENDAR_SEARCH. Instead return level:"B" with no Level A intent, so the request reaches the main assistant, which calculates the real travel time and leave-by time. This is a meaning-based exclusion, not a fixed phrase list... Contrast — these are NOT travel-planning and keep their normal classification: "When is my dentist appointment" (asks when the event itself occurs, not when to leave for it) → still CALENDAR_SEARCH. "What do I have today" / "what's coming up" (no specific event, no travel question) → still READ_CALENDAR.

## Deployment Evidence (Phase 3 Mandatory Change 6)

Deployed to **staging** (`xugvnfudofuskxoknhve`) only:

```
naavi-chat | version: 91 | deployed: 2026-08-02, 5:34:43 a.m. EST | sha: 6cd3116e6bc3d7237efb9509e1bbdbabb09329679e76ac3005ad0e1f9e922aa9
```

This deploy contains the uncommitted local edit above (confirmed — the test run below, against this exact deployment, shows the new classifier behavior live). Not deployed to production; production `naavi-chat` is unchanged from before this session, per Phase 2 Amendment 7 / Phase 3's Implementation Boundaries.

## Tests Executed — Full Trial Distribution (Non-Determinism Rule)

Run via `npm run test:auto -- --grep calendar`, targeted at **STAGING** (banner-confirmed), test user `mynaavi2207@gmail.com` (`ae1f3438-e132-422a-9b0b-7b8819119b46`). Report: `tests/results/2026-08-02T09-36-22-292Z.md`.

### `calendar.travel-planning-excluded-from-level-a` — routing-level, 4 phrases × 3 trials = 12 calls — **PASS**

Every trial for every phrase avoided both `READ_CALENDAR_PATTERN` and `CALENDAR_SEARCH_PATTERN` — no partial/inconsistent result across any of the 12 calls (per Mandatory Change 7, a single inconsistent trial would have failed the test outright, not been retried).

### `calendar.read-calendar-negative-controls` — 3 phrases × 3 trials = 9 calls — **PASS**

All 9 calls matched `READ_CALENDAR_PATTERN`, none hedged. Confirms the exclusion did not over-fire on genuinely generic reads.

### `calendar.calendar-search-boundary-preserved` — 1 phrase ("When is my dentist appointment?") × 3 trials — **PASS**

All 3 calls matched `CALENDAR_SEARCH_PATTERN`. Confirms Mandatory Change 2's boundary case holds.

### `calendar.travel-planning-outcome-level-chain` — two-layer evidence (Mandatory Change 5) — **routing-level PASS, outcome-level SKIPPED**

- **Routing-level** (reported separately, per Mandatory Change 5): PASSED — response was neither `READ_CALENDAR` nor `CALENDAR_SEARCH` pattern.
- **Tool-invocation**: no `FETCH_TRAVEL_TIME` action was present in Claude's response for this specific call.
- **Outcome-level** (calendar event resolution → `resolve-place` → `get-travel-time` → real duration): **not exercised**, test reported `TestSkippedError`, not a failure — because no `FETCH_TRAVEL_TIME` action was emitted to chain from. Root cause: the test account's Google Calendar OAuth token on staging is currently invalid (`"Token refresh failed: invalid_grant"` — same error also caused `calendar.create-event` to skip and 2 unrelated pre-existing `b10r.*` tests to error, in the same run — see Known Issues below). Claude had no live "dentist appointment" event to reason about, so it could not emit a travel-time action for either the classifier fix or the underlying data to be exercised.
- **What this does and doesn't prove:** the routing-level fix is proven live against the real deployed classifier. The full backend chain (`resolve-place` → `get-travel-time`) was already proven working earlier this session (both were fixed and independently live-tested against real addresses, see this session's prior work). The one thing not freshly re-proven together in one chained call is Claude actually emitting `FETCH_TRAVEL_TIME` for this exact test account's data, purely because that account's calendar connection is currently broken for an unrelated, pre-existing reason. **The mobile app's own live TRAVEL TIME card (destination, 47 min, 53.6 km, leave by 8:08 a.m., Open in Google Maps) was already confirmed by direct screenshot on this session's Wael-owned account before this fix**, and the routing bug is now confirmed fixed on the classifier that gated it — the missing piece is only a fresh, single, chained proof on the specific `mynaavi2207@gmail.com` auto-tester account, blocked by an unrelated OAuth issue on that account.

### Sibling-intent spot-check (Phase 2 Regression Matrix requirement)

Direct live calls against the same fixed staging deployment:
- `"Did I get any email from Tom"` → 200, correct `GMAIL_SEARCH`-style deterministic reply (3 matching emails listed) — unaffected.
- `"What are my upcoming reminders"` → 200, correct `REMINDER_READ`-style deterministic reply ("You don't have any upcoming reminders.") — unaffected.

### Pre-existing negative controls (already in `calendar.ts` before this change) — unaffected

- `calendar.read-today-no-hedging` — PASS
- `calendar.read-coming-up-no-hedging` — PASS

### Full run summary

27 passed, 0 failed, 2 errored (pre-existing, unrelated — see below), 3 skipped (2 pre-existing OAuth-gated, 1 new test's outcome-level layer, explained above).

## Known Issues Found During Testing — Out of Scope, Not Regressions

`b10r.calendar-recurring-birthday-anniversary-no-year` and `b10r.calendar-year-strip-false-positive-avoidance` both errored: `create-calendar-event ... expected 2xx status, got 500`. Root cause, same run: `"Token refresh failed: {\"error\":\"invalid_grant\"...}"` — the staging test account's Google Calendar OAuth token is currently invalid. This is the same condition that skipped `calendar.create-event` and blocked the outcome-level chain above. **Not caused by this change** — nothing in this implementation touches OAuth, tokens, or `create-calendar-event`, and this failure mode is orthogonal to the classifier prompt. Per governance's No Extra Changes Rule (Phase 4), this is reported here, not fixed under this work item.

## Manual Tests Required

Per governance Phase 7, live manual validation is still required before this item can be considered fully closed:
1. **Mobile app, staging build, live test** of the two original reproduction phrases ("What time should I leave for my dentist appointment?", "What time i should leave for my next meeting?") — confirm the TRAVEL TIME card now renders, matching the fix's intent, not just the routing-level automated proof above.
2. **Live voice call test** (Phase 1A / Phase 3 Mandatory Change 8) — confirm voice is unaffected, as the code-level finding indicated but never live-verified. A failure here returns to analysis, does not authorize a voice code change.

## Rollback Instructions

Single-file, single-paragraph change, staging only:
1. `git diff supabase/functions/naavi-chat/index.ts` to see the exact added block; revert by removing the "TRAVEL-PLANNING EXCLUSION" paragraph (or `git checkout -- supabase/functions/naavi-chat/index.ts` if uncommitted).
2. Redeploy: `npx supabase functions deploy naavi-chat --no-verify-jwt --project-ref xugvnfudofuskxoknhve`.
3. No database, no client app, no production impact to unwind — nothing else changes state.

## Known Risks

- The classifier is a live LLM call; the 3-trial results above are a snapshot, not a permanent guarantee — the new regression tests in `tests/catalogue/calendar.ts` now run on every `npm run test:auto`, which is the ongoing safety net per Rule 15a.
- The outcome-level chain for this specific test account remains unproven until the account's OAuth token is refreshed (unrelated, pre-existing issue).
- Voice remains code-level-verified only, per Phase 1A/Phase 3 — pending the required live call test.

---

**Status:** Ready for Phase 6 — External Technical Review (after coding).
