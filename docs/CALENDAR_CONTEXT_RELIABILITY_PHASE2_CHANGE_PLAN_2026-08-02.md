# Calendar Context Reliability (Ticket A) — Phase 2 — Change Planning

**Date:** 2026-08-02
**Governance version:** v4.0
**Scope note:** This ticket is now scoped to Ticket A only, per Wael's mandatory scoping change — the proven client-brief / staging-schema-drift defect. The event-selection-reasoning question is split out as Ticket B (`docs/TRAVEL_EVENT_SELECTION_SEMANTICS_PHASE0_INTENT_APPROVAL_2026-08-02.md`), not addressed here.

No code is written in this phase.

## Root Cause (recap, proven in Phase 1B)

Staging's `calendar_events` table is missing the `location` column (present on production). `lib/calendar.ts::fetchUpcomingEvents` (and `fetchTodayEvents`) selects it explicitly; the query fails on staging, is caught, and silently returns zero calendar events. The mobile app's Brief state therefore never contains calendar events on staging — confirmed via live `client_diagnostics` data (`brief_count: 2`, every turn, calendar-empty). This broken brief is what `naavi-chat` falls back to whenever a phrase doesn't match `LIVE_CALENDAR_RE`.

## Alternatives Considered

**Alternative 1 — Fix the schema drift (add the missing `location` column to staging).**
Directly repairs the root data-integrity defect: staging's schema stops silently diverging from production. This is not scoped to naavi-chat at all — the same broken query is what the mobile app's own Brief *screen* uses to show events on-screen (`app/index.tsx:1177`, `fetchUpcomingEvents`), so this defect is very likely also breaking the Brief widget's own calendar display on staging, independent of chat. Low architectural risk (adding a column that already exists on production, matching known-good schema), but does not address the deeper fragility Wael flagged.

**Alternative 2 — Remove the dependence on wording for travel-time-shaped requests (always do a live calendar fetch).**
Per Wael's explicit direction: today, correctness depends on whether the user's phrase happens to match `LIVE_CALENDAR_RE` — matching phrases get a fresh, independent, correctly-working fetch; non-matching phrases fall back to a client-cached brief that can be stale, incomplete, or (as proven) structurally broken on staging. Removing this branch for travel/leave-by-shaped requests specifically would make correctness independent of both the regex and the client brief's health. This is a real architectural change to `naavi-chat`'s request-handling, not a data fix — it needs its own Phase 1A-style Cross-Repository/Protected-Core review before being authorized for implementation.

**Alternative 3 — Both.** Alternative 1 is not optional — it is a data-integrity defect independent of any architectural decision, and fixes the Brief widget's own display bug as a side effect, not just this ticket's symptom. Alternative 2 is Wael's explicitly requested architectural hardening, evaluated here, not automatically bundled in.

**Recommendation:** Alternative 1 is necessary regardless — it is a schema drift affecting more than this ticket, and should not wait on an architectural decision. Alternative 2 is a real, separate, higher-risk change (Protected Core, calendar routing logic) that deserves its own explicit go/no-go from Wael before scoping further — not decided unilaterally here.

## Files That Would Change — Alternative 1 (schema fix)

| File | Classification | Modification |
|---|---|---|
| New migration file, e.g. `supabase/migrations/20260802_add_calendar_events_location_staging.sql` | Database | `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS location text;` — matches production's existing column. |

No application code changes required for Alternative 1 alone — `lib/calendar.ts`'s existing queries already expect this column; they simply start succeeding once it exists.

## Files That Would Change — Alternative 2 (architecture change), if approved

Not fully scoped here — this is presented as a recommendation for evaluation, not an authorized plan. If Wael approves pursuing it, it needs its own Phase 1A-equivalent pass (which call sites, which regex boundary, Cross-Repository check against voice) before Phase 2 can specify exact files.

## Risk Classification

**Alternative 1: Low.** Additive schema change (`ADD COLUMN IF NOT EXISTS`), matches an already-proven-safe production column, no data migration, no existing row impact, reversible (`DROP COLUMN`). Still Protected Core (Database schema, §4) — mandatory review applies regardless of risk tier.

**Alternative 2 (if pursued): Medium-High.** Changes request-routing behavior in a shared, Protected-Core Edge Function; needs its own full governance pass.

## Change Impact Matrix — Alternative 1

| Layer | Affected? | Details |
|---|---|---|
| Mobile | Yes (indirectly) | The mobile Brief widget's own calendar display should start working correctly on staging once this column exists — a bug fix, not a behavior change to authorized scope. |
| Voice | No | Voice does not read `calendar_events.location` (per architecture already on record — voice has its own independent Google Calendar reads). |
| Shared Core | No | This ticket's fix is a database schema correction, not an Edge Function change. |
| Database | Yes | The actual change — one additive column on staging's `calendar_events` table. |
| Cron | No | Not affected. |
| API contracts | No | No Edge Function contract changes. |
| Tests | Yes | A regression test confirming `calendar_events.location` is selectable on staging, and/or a test confirming the mobile Brief's calendar fetch no longer errors, should be added per Rule 15a. |

## Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** No.
- **Does this change modify an Entry Point?** No.
- **Does this change introduce new duplication?** No.
- **Does this change eliminate existing duplication?** No — the three independent calendar-read implementations found during this investigation (mobile Brief generation, `fetchLiveCalendarEvents`, `global-search`) are unaffected by this schema fix and are explicitly out of scope here — flagged separately as an Architecture Governance item, not addressed in this ticket.
- **Does this change modify Protected Core?** Yes — Database schema is Protected Core (§4). Mandatory review before and after applies.

## Regression Impact

- **Voice commands:** Not affected.
- **Geofencing:** Not affected.
- **Gmail integration:** Not affected.
- **Calendar integration:** Directly affected, as a fix — the mobile Brief's calendar fetch and `naavi-chat`'s fallback-to-client-brief path both start seeing real calendar data on staging.
- **Reminders:** Not affected.
- **SMS / call alerts:** Not affected.
- **Onboarding:** Not affected.
- **Staging build:** Not a client build; a staging *database* migration only.

## Regression Matrix

`calendar_events.location` is read by: `lib/calendar.ts` (`fetchTodayEvents`, `fetchUpcomingEvents`, `deleteCalendarEvent`), `lib/memory.ts::getCalendarEventsForPerson`, `assistant-fulfillment/index.ts`, `naavi-chat/index.ts::fetchLiveCalendarEvents` (reads Google's live `location` field directly, not this column — unaffected either way). All of these currently either error (staging) or work (production); adding the column brings staging in line with production for all of them, a strict improvement, not a new behavior to individually re-verify beyond confirming the queries stop erroring.

---

**Status:** Awaiting Wael's decision — proceed with Alternative 1 alone (necessary regardless), or authorize scoping Alternative 2 as well before implementation.
