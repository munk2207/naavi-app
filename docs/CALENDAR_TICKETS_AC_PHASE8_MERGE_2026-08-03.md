# Calendar Tickets A & C — Phase 8 — Merge

**Date:** 2026-08-03
**Governance version:** v4.0
**Phase 7:** Complete — `docs/CALENDAR_TICKETS_AC_PHASE7_REVIEW_PACKAGE_2026-08-02.md` (reviewer response received 2026-08-03: no blocking concerns).
**Wael's Phase 8 approval:** given 2026-08-03 ("Yes, approved").

## Tickets closed

**Ticket A — Calendar Context Reliability.** Staging migration `20260802000000_calendar_events_location_staging.sql` (`calendar_events.location text DEFAULT ''`, matching production's pre-existing definition). Production was never affected by this defect — it already had the column. Mobile Brief confirmed displaying real calendar events with real addresses post-fix (live screenshot, 2026-08-02).

**Ticket C — Calendar Cache Synchronization Integrity.** `sync-google-calendar` atomic-sync / prune-safety fix (prune only runs when the sync's writes succeeded; failures are reported per-user via `sync_ok`/`abort_reason` instead of silently pruning against incomplete data) + staging migration `20260802000001_calendar_events_attendees_staging.sql`. Deployed to **both staging and production** — the production deploy happened via an earlier miscommunication ("go to production" was meant for staging only), was not rolled back, and was separately confirmed to be a safe, working, no-op-on-success change on production (production's writes were never broken by the schema gap that triggered this ticket — that gap only existed on staging).

## Checklist per governance §3, Phase 8 — Merge

- ✓ Automated tests pass — `tests/catalogue/calendar.ts` (6 tests across both tickets: travel-planning exclusion, negative controls, calendar-search boundary, outcome-level chain, sync atomic-response-contract, sync successful-run-prunes-normally).
- ✓ Manual validation passes — staging sync re-run clean (`sync_ok: true`), mobile Brief confirmed live by Wael, production behavior confirmed live by Wael (voice test, correct schedule read-back — see caveat below).
- ✓ External review completed — Phase 3 (before coding, both tickets) and Phase 6 (after coding, both tickets) Approved with Mandatory Changes/Follow-Up, all addressed; Phase 7 package Approved with no blocking concerns.
- N/A — No intentional architectural change was made in this work item (additive columns + a safety gate inside an existing function). Architecture Reference update not required for Phase 8.
- N/A — No newer Architecture Reference has superseded the version in effect at Phase 1A.

**Caveat on the live voice-call evidence:** the 2026-08-03 live voice test (correct schedule read-back for `mynaavi2207@gmail.com`) demonstrated that production's calendar pipeline works end-to-end, but the specific defect it fixed was a separate bug (phone-number collision in `naavi-voice-server`'s caller lookup), not Ticket A or C — recorded at the time, not retroactively reinterpreted. Ticket C's production deploy is a genuine, verified improvement on its own evidence (the successful staging syncs, the mobile Brief confirmation, and direct behavioral confirmation that production's `sync-google-calendar` now returns the `sync_ok`/`pruned` response shape) — it does not need the voice test's causation to be true to be considered complete.

## Separate Follow-Up Items (Not Blocking) — status at close

1. **Voice staging environment.** Tracked: holding list item 18 (`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`), Tier 5, not started.
2. **Voice caller-resolution (duplicate phone number / `.limit(1)` lookup).** Tracked: background task `task_b77ce85e`. Immediate symptom (the specific duplicate that caused a live wrong-account resolution) already fixed and confirmed 2026-08-03; the underlying unordered-query hardening remains open.
3. **Synchronization health monitoring.** Newly tracked at this closure — see background task spawned below (was a Phase 6 Mandatory Follow-Up note, not previously turned into a tracked task).

## Status

**Both tickets CLOSED, 2026-08-03.** Full record: Ticket A — `docs/CALENDAR_CONTEXT_RELIABILITY_*_2026-08-02.md`; Ticket C — `docs/CALENDAR_CACHE_SYNC_INTEGRITY_*_2026-08-02.md`; incident report — `docs/CALENDAR_CONTEXT_RELIABILITY_INCIDENT_SYNC_DELETION_2026-08-02.md`; this document is the Phase 8 closure record for both.
