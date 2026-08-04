# Calendar Context Reliability (Ticket A) — Phase 3 — External Technical Review

**Date:** 2026-08-02
**Governance version:** v4.0
**Reviewed:** `docs/CALENDAR_CONTEXT_RELIABILITY_PHASE3_REVIEW_PACKAGE_2026-08-02.md`

## Decision: APPROVED WITH MANDATORY CHANGES

The proposed schema repair is the correct minimal fix for the proven Ticket A root cause. Low-risk classification remains appropriate despite the mandatory Protected-Core review: additive, nullable, no data transformation, aligns staging with the already-working production schema.

## Mandatory Changes

1. **Version-controlled migration, not dashboard/ad hoc SQL.** New file under `supabase/migrations/`:
   ```sql
   ALTER TABLE public.calendar_events
   ADD COLUMN IF NOT EXISTS location text;
   ```
   Schema-qualified (`public.calendar_events`) to avoid relying on session search path.

2. **Confirm production's exact column definition before finalizing** — data type, nullability, default value, generated-column status. The review package only asserted `text`; Phase 4 must record direct evidence of production's real definition, not assume it.

3. **Verify staging doesn't already store this under a different column name** (`event_location`, `location_name`, `address`, `venue`) before applying — unlikely given the proven query failure, but must be checked, not assumed, to avoid creating two competing representations.

4. **Correct the rollback claim.** "Zero data loss" is only true before anything writes to the new column. Once populated, `DROP COLUMN` is destructive. Rollback section must instead read: *dropping the column is structurally simple, but data-destructive after any values have been written — inspect for non-null values and preserve them if needed before rollback.*

5. **Don't assume every dependent path is proven just because the query stops erroring.** Requires targeted verification: `fetchTodayEvents` returns calendar events; `fetchUpcomingEvents` returns calendar events; the mobile Brief displays calendar events; `brief_items` sent by the app includes calendar entries; a named-event request no longer fails due to an empty brief. `deleteCalendarEvent`, `getCalendarEventsForPerson`, `assistant-fulfillment` only need a compatibility check on their queries, not full functional testing, unless they write/transform `location`.

6. **Verify read and write behavior separately.** Adding the column repairs reads; it does not by itself prove the sync path populates `location`. Phase 5 evidence must show: whether existing staged rows remain `NULL`; whether a calendar refresh/sync backfills the field; whether newly synced events write their location; whether the Brief stays correct for events that legitimately have no location. A query returning `location: null` proves schema compatibility, not data synchronization.

7. **Staging only.** Not applied to production (already has the column). Written with `IF NOT EXISTS` so the migration file represents intended schema consistently without failing if later applied where the column already exists.

## Technical Assessment

- **Minimality:** Pass — direct schema-contract violation, restoring it is necessary regardless of any future travel-time-context redesign.
- **Risk classification:** Low is appropriate — Protected Core determines the review requirement, not the technical risk level. Primary risks are operational: wrong project, definitions not actually matching, assuming auto-population, rollback-after-write.
- **Hidden coupling:** application code already treats `calendar_events.location` as part of the table contract — this migration repairs an environment violating an existing contract, it does not introduce a new one.
- **Alternative 2:** correctly deferred — architectural reliability improvement, doesn't remove the need to repair the broken schema/Brief widget either way.

## Implementation Boundaries Confirmed

Authorized only for:
1. One new version-controlled migration under `supabase/migrations/` — `public.calendar_events.location`, `ADD COLUMN IF NOT EXISTS`, matching verified production definition.
2. Staging database application of that migration — target project confirmed before execution.
3. Validation and evidence only — schema parity, calendar reads, Brief population, actual `brief_items`, synchronization behavior, named-event reproduction.

**No application-code changes authorized under Ticket A.** No changes authorized to: `lib/calendar.ts`, mobile application logic, `naavi-chat`, `LIVE_CALENDAR_RE`, travel-time routing, voice server, `global-search`, production database schema, calendar event-selection semantics.

---

**Status:** Review received and recorded. Per governance §3's Phase-Gate Approval Rule, this reviewer verdict is not itself authorization to begin Phase 4 — Wael's own separate, explicit go-ahead is required next.
