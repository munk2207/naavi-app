# Calendar Cache Synchronization Integrity (Ticket C) — Phase 5 — Evidence Package

**Date:** 2026-08-02
**Governance version:** v4.0
**Phase 3:** Approved with Mandatory Changes — `docs/CALENDAR_CACHE_SYNC_INTEGRITY_PHASE3_TECHNICAL_REVIEW_2026-08-02.md`

## Summary

Fix 1 (add `attendees` column) and Fix 2/3 (atomic sync + structured logging) implemented and deployed to staging. Verified end-to-end against Robert's real, working Google account: sync now writes successfully (previously always silently failed), correctly prunes only after a fully successful reconciliation, and the previously-restored synthetic-ID rows were correctly replaced by authentic, live-synced data with real Google-issued IDs.

## Files Changed

1. `supabase/migrations/20260802000001_calendar_events_attendees_staging.sql` — new migration, staging only.
2. `supabase/functions/sync-google-calendar/index.ts` — atomic-sync gating + structured logging.
3. `tests/catalogue/calendar.ts` — 2 new regression tests, auto-registered via the existing `...calendarTests` spread in `tests/runner.ts` (no runner.ts edit needed, same pattern as the prior work item).

## Mandatory Change 1 — "Successful writes" defined precisely

Implemented as: a per-user `syncOk` flag (`sync-google-calendar/index.ts`, declared near the top of the per-user loop), set to `false` by a single `markFailure(reason)` helper called from **every** point that can leave the reconciliation incomplete:
- A calendar's event-page fetch returning non-OK mid-pagination (`!res.ok` → `break`) — previously just a `console.warn`, now also `markFailure`.
- Any individual event upsert returning an error.
- A task list's fetch returning non-OK — previously just `continue`, now also `markFailure`.
- Any individual task upsert returning an error.

**Explicitly not treated as failure:** the Tasks API returning a non-OK status for the *whole* Tasks scope (existing, expected "scope not granted yet" case, `index.ts:267-269` in the pre-fix version) — there's nothing to reconcile in that case, so it doesn't block prune of the (unrelated) calendar events.

## Mandatory Change 2 — Reframed as overall-sync-success, not literal every-write

Implemented via the single `syncOk` boolean plus `markFailure()` — the prune step checks `syncOk`, not a per-item count, matching the reviewer's requested wording: *"the synchronization run completed successfully for that user without unrecovered write errors."*

## Mandatory Change 3 — Abort reason in logging

`markFailure(reason)` captures the *first* failure reason (subsequent failures are still counted via `writeErrorCount` but don't overwrite the original reason — the first cause is usually the most actionable). Logged explicitly:
```
[sync-calendar] user=<id> fetched=<n> written=<n> failed=<n> sync_ok=<bool> prune=<ran|skipped> pruned=<n|n/a> reason="<abort reason>" deleted=<[...]>
```
Also returned in the HTTP response body per user: `{ user_id, events, tasks, sync_ok, abort_reason?, pruned }`.

## Mandatory Change 4 — API contract clarified

Documented directly in the function's header comment: the overall HTTP response is always 200 (unchanged from before — matches the existing per-user-loop pattern where one user's failure was already isolated via try/catch). Per-user failure is communicated via `sync_ok: false` and `abort_reason` inside `results[i]`, not via the response status code.

## Mandatory Change 5 — Expanded regression tests

Two tests added to `tests/catalogue/calendar.ts`:
- `calendar.sync-atomic-response-contract` — asserts `sync_ok` (boolean) and `pruned` (number or null) are present in the per-user result shape.
- `calendar.sync-successful-run-prunes-normally` — asserts that when `sync_ok === true`, `pruned` is a number (prune actually ran) — confirms the atomicity gate doesn't block the healthy case.

**Both run and PASS** against Robert's account (working Google token):
```
calendar.sync-atomic-response-contract        ✓ PASS
calendar.sync-successful-run-prunes-normally  ✓ PASS
✓ 2 passed   ✗ 0 failed   ⨯ 0 errored   ○ 0 skipped
```
Against the standard auto-tester account (`mynaavi2207@gmail.com`, `TEST_USER_ID`), both tests **skip cleanly** (`TestSkippedError`) — that account's Google token is separately known to be invalid/expired, unrelated to this fix, same condition documented in the prior work item's evidence package. No crash, no false pass, no false fail.

**Coverage gap, acknowledged per Rule 15a** (documented in the test file's header, not silently omitted): the four "negative control" cases the reviewer listed — write failure is logged, abort reason is logged, no rows deleted after a failed write, and the direct "prune blocked after failed write" case — are **not** exercised by a live, forced failure in the auto-tester. `sync-google-calendar` has no dependency-injection or failure-simulation hook, and deliberately breaking schema or tokens to manufacture a real failure would itself be destructive to shared staging data (exactly the category of action this whole ticket exists to prevent). Instead, this was verified by direct source read: every failure site (event-page fetch, event upsert, task-list fetch, task upsert) calls the same single `markFailure()` helper that gates the prune step — one code path, not several independently-implemented checks that could drift out of sync with each other. Flagging this explicitly for Wael rather than claiming full coverage.

## Mandatory Change 6 — Overstated claim softened

The phrase "structurally impossible" was never committed to code or a governance doc as a permanent claim — it appeared only in chat discussion and was corrected in the Phase 3 review itself. The code's own comment (`sync-google-calendar/index.ts`, above the prune block) uses the reviewer's precise wording: *"This does not make every future synchronization failure impossible; it eliminates this specific asymmetric failure mode (write failed, delete ran anyway)."*

## Live Verification — Fix 1 Confirmed

Migration applied, verified: `attendees | jsonb | is_nullable: YES | column_default: null` — exact match to production (re-confirmed via PostgREST OpenAPI introspection immediately before writing the migration, same discipline as Ticket A).

## Live Verification — Fix 2/3 Confirmed, Real Data

Ran the fixed `sync-google-calendar` for Robert (real account, real Google Calendar):
```json
{ "user_id": "f1bc46b8-...", "events": 61, "tasks": 0, "sync_ok": true, "pruned": 10 }
```
- **61 events written successfully** — previously always 0 (every write silently failed on the missing `attendees` column, root-caused in Phase 1).
- **`sync_ok: true`** — correctly identified as a fully successful reconciliation.
- **`pruned: 10`** — exactly the 10 synthetic-ID rows manually restored during the incident recovery, correctly identified as not matching any live Google ID once a real, complete sync could finally run.

Confirmed directly afterward: "Gym class" and "Team standup" are present again, now under **real, Google-issued IDs** (`jl1s4vndrjs18mo7nbqprof6k4_20260802T100000Z`, `cd009iesnmree60g80gmp045l4_20260802T130000Z` — Google's standard recurring-instance ID format), not the synthetic placeholders — the cache is now genuinely, correctly synced for the first time this session, not just manually patched.

## Rollback

- `attendees` column: `ALTER TABLE public.calendar_events DROP COLUMN IF EXISTS attendees;` — destructive once populated (now populated, per the verification above) — same caveat as Ticket A's `location` rollback.
- `sync-google-calendar` code: revert to the pre-Ticket-C deployed version. No data migration needed to roll back the code itself.

## Known Risks

- The "negative control" failure-blocks-prune path is verified by source read, not by a live forced-failure test (see Mandatory Change 5's coverage-gap note) — acceptable given no safe way to manufacture a real failure exists, but worth surfacing explicitly rather than claiming complete test coverage.
- Voice (confirmed downstream reader of this table, not a writer, per Phase 1A) was not separately re-tested here — it doesn't call this function and has no reason to be affected, but wasn't independently re-verified post-fix.

---

**Status:** Ready for Phase 6 — External Technical Review (after coding).
