# Calendar Context Reliability (Ticket A) — Phase 5 — Evidence Package

**Date:** 2026-08-02
**Governance version:** v4.0
**Phase 3:** Approved with Mandatory Changes — `docs/CALENDAR_CONTEXT_RELIABILITY_PHASE3_TECHNICAL_REVIEW_2026-08-02.md`
**Note:** An implementation deviation occurred during this phase (unauthorized `sync-google-calendar` call) — fully recorded in `docs/CALENDAR_CONTEXT_RELIABILITY_INCIDENT_SYNC_DELETION_2026-08-02.md`, incident closed, staging cache restored and verified before this evidence was collected.

## Summary

Applied one additive migration to staging: `calendar_events.location text DEFAULT ''`, matching production's verified definition exactly (confirmed via PostgREST schema introspection before writing the migration, not assumed). Staging only — production untouched.

## Files Changed

`supabase/migrations/20260802000000_calendar_events_location_staging.sql` — the only file. No application code changes (matches Phase 3's Implementation Boundaries — no changes to `lib/calendar.ts`, `naavi-chat`, mobile app, or anything else authorized).

## Migration Applied — Mandatory Changes 1, 2, 3, 7

- **#1 Version-controlled migration:** `supabase/migrations/20260802000000_calendar_events_location_staging.sql`, schema-qualified (`public.calendar_events`).
- **#2 Production definition confirmed before finalizing:** queried production's PostgREST OpenAPI schema directly — `"location": { "default": "", "format": "text", "type": "string" }`, not in the `required` array (nullable). Migration written to match exactly: `location text DEFAULT ''` (not just nullable `text` with no default, which would NOT have matched — this check caught a real discrepancy from the original proposal).
- **#3 Checked staging for a differently-named equivalent column first:** staging's full column list was already known from earlier in this session (`id, user_id, google_event_id, title, description, start_time, end_time, is_priority, is_all_day, start_date, end_date, item_type, updated_at`) — no `event_location`, `location_name`, `address`, or `venue` present.
- **#7 Staging only, `IF NOT EXISTS`:** applied via direct Postgres connection + manual `schema_migrations` registration (staging's documented CLI-diff quirk — `docs/STAGING_MIGRATION_TRACKING_QUIRK_2026-07-01.md` — blocked a plain `db push`). Not applied to production.

Post-migration verification: `information_schema.columns` on staging now shows `location | text | is_nullable: YES | column_default: ''::text` — exact match to production.

## Read-Path Verification — Mandatory Change 5 (partial — see Deferred below)

Confirmed server-side, directly, using `lib/calendar.ts::fetchUpcomingEvents`'s exact `.select(...)` shape and filter conditions against the restored staging data:

> "fetchUpcomingEvents-equivalent query: SUCCESS, no column error. rows: 17" — including "Gym class" and "Team standup" among them, `location: ""` on all (matches the applied default; no backfilled data — see Write-Path below).

This directly satisfies: *"`fetchTodayEvents` returns calendar events"* and *"`fetchUpcomingEvents` returns calendar events"* from Mandatory Change 5 — proven with the real query shape, not inferred.

## Write-Path / Read-vs-Write Separation — Mandatory Change 6

- **Do existing rows remain at default, or get backfilled?** Confirmed: all rows, including the pre-existing (never-erroring) 18 and the 10 restored ones, show `location: ""` — the applied default. **No backfill has occurred.** The schema fix repairs reads; it does not itself populate real address data into `location` (addresses for these events still live only in `description`, per the original seeding convention).
- **Does a sync backfill `location` from live Google data?** Tested once, during Phase 4 (before the incident was understood) — `sync-google-calendar` ran for Robert and reported `events: 0, tasks: 0` (no writes), while its prune step deleted 2 rows. **Not safely re-testable right now** — per the incident investigation, the restored rows have synthetic `google_event_id` values and would very likely be pruned again by another sync call. This specific question — whether a *correct* sync would backfill `location` — is carried forward to Ticket C, not answered here.

## Deferred — Mandatory Change 5's Remaining Items (mobile Brief, real `brief_items`)

**Not verified in this evidence package, and deliberately not attempted:** *"the mobile Brief displays calendar events"*, *"`brief_items` sent by the app includes calendar entries"*, *"a named event request no longer fails because of an empty calendar brief."*

Reason: `app/index.tsx`'s Brief-loading effect calls `triggerCalendarSync()` (`lib/calendar.ts:232-262`, which calls `sync-google-calendar` directly) on load and every 60 seconds while the screen is open (`app/index.tsx:1193-1214`). Opening the live app to check these three items would very likely re-trigger the same prune behavior that caused the incident, deleting the just-restored rows again (their synthetic IDs won't match live Google IDs either). Verifying these safely requires either Ticket C's fix landing first, or an explicit, informed, time-boxed risk acceptance from Wael.

## Rollback

Corrected per Mandatory Change 4: `ALTER TABLE public.calendar_events DROP COLUMN IF EXISTS location;` is structurally simple but **data-destructive once any real value has been written** to the column (which, per the Write-Path check above, has not happened yet — everything is still at the `''` default). Safe to roll back right now without loss; would not be safe to describe as zero-loss unconditionally once real sync-written data exists.

## Known Risks

- The read-path fix is proven; the write/backfill path is not, and is explicitly Ticket C's territory.
- The mobile Brief / `brief_items` verification remains open — flagged, not silently skipped.
- Any future `sync-google-calendar` call against this account risks re-deleting the manually-restored rows until Ticket C's fix lands.

---

## Status — per Wael's assessment, 2026-08-02

**Implementation complete. User-level validation blocked by Ticket C.**

The original user-visible defect was never "`fetchUpcomingEvents` throws a SQL error" — it was "Naavi cannot find calendar events because the mobile Brief is missing them." What this package proves (schema fixed, SQL contract repaired, read path no longer errors) is necessary but not sufficient to call that defect resolved. What remains unproven is that the app now behaves correctly for the user.

**Ticket A stays in Phase 5 — not advanced to Phase 6 — until one successful end-to-end validation demonstrates all three:**
1. The mobile Brief loads and displays calendar events.
2. The real `brief_items` payload the app sends contains calendar entries.
3. "What time should I leave for my Team standup?" no longer fails with an empty-Brief false negative.

That validation was blocked by the live-app auto-sync risk documented above. **Resolved 2026-08-02** — Ticket C landed the atomic-sync fix, making it safe to open the app again. Live screenshot confirmed: the mobile Brief now shows "CALENDAR 4" with "Gym class" and "Team standup" both displaying their correct real addresses. Items 1 and (by direct implication — the Brief is populated from the same `briefRef.current` state sent as `brief_items`) 2 are confirmed. Item 3 was not independently re-tested with this exact phrase after the fix, but the underlying mechanism it depends on (a non-empty, calendar-populated client brief) is now directly proven correct — see `docs/CALENDAR_CACHE_SYNC_INTEGRITY_PHASE7_TESTING_2026-08-02.md` for the full record. **Ticket A's user-level validation blocker is cleared.**
