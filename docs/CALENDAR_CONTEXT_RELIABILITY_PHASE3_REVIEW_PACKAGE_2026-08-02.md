# Calendar Context Reliability (Ticket A) — Phase 3 — External Technical Review Package

**Date:** 2026-08-02
**Governance version:** v4.0
**For:** External Technical Reviewer (ChatGPT), per governance §1 and §3 Phase 3.
**Prior phases (full detail on request):** `docs/CALENDAR_CONTEXT_RELIABILITY_PHASE0_INTENT_APPROVAL_2026-08-02.md` through `PHASE2_CHANGE_PLAN_2026-08-02.md`.
**Scope, per Wael's approval:** Alternative 1 only (the schema fix). Alternative 2 (architectural change to always-live-fetch for travel requests) is explicitly deferred, not part of this authorization.

Condensed per governance §14's Cost-Aware AI Collaboration.

## What's broken, and why this review is happening despite Low risk

Staging's `calendar_events` table is missing a `location` column that production has. `lib/calendar.ts`'s `fetchTodayEvents`/`fetchUpcomingEvents` (used by the mobile Brief widget) select it explicitly; the query errors on staging, is caught, and silently returns zero calendar events. Proven via live `client_diagnostics` data from a real phone session: `brief_count: 2` on every turn, never including calendar events, across two app sessions. This is why `naavi-chat` falls back to a permanently calendar-empty client brief whenever a phrase doesn't trigger its own independent live fetch — the mechanism behind the false "I don't see that event" failures investigated this session.

Classified Low risk (Phase 2), but this is a **Database schema** change — Protected Core (§4) — so review is mandatory regardless of risk tier, per §4's own text ("Any modification touching the Protected Core automatically requires technical review before coding and after implementation").

## Proposed change

One additive migration, staging only:
```sql
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS location text;
```
Matches the column already present and working on production. No data migration, no existing-row impact, no application code changes — `lib/calendar.ts`'s existing queries already expect this column and simply start succeeding once it exists.

## Alternatives considered (Phase 2)

- **Alternative 2** (always live-fetch for travel-time requests, removing the `LIVE_CALENDAR_RE`-gated dependency on the client brief) — evaluated, not rejected, explicitly deferred by Wael to its own future architecture decision. Not part of this authorization.
- Doing nothing was not viable — this is a proven, active data-integrity defect affecting the mobile Brief widget's own on-screen calendar display, not just this investigation's chat symptom.

## Isolation / hidden coupling

`calendar_events.location` is read by: `lib/calendar.ts` (`fetchTodayEvents`, `fetchUpcomingEvents`, `deleteCalendarEvent`), `lib/memory.ts::getCalendarEventsForPerson`, `assistant-fulfillment/index.ts`. All currently error on staging and will simply start succeeding — a strict fix, not a new behavior needing individual re-verification. `naavi-chat`'s `fetchLiveCalendarEvents` reads Google's live `location` field directly (unrelated column, unaffected either way).

## Regression risk

Additive-only (`ADD COLUMN IF NOT EXISTS`) — cannot break any existing row, query, or write path that doesn't already reference this column. Reversible via `DROP COLUMN` with zero data loss (the column doesn't exist today; nothing to lose by removing it again).

## Rollback

`ALTER TABLE calendar_events DROP COLUMN IF EXISTS location;` — safe, no dependent data.

## What we're asking you to evaluate

Per governance §3 Phase 3 / §13 Gates 3-4: is this genuinely the minimal, correct fix for the proven root cause; is the Protected-Core review appropriate given the Low risk classification (or should risk be reassessed); any hidden coupling missed above. Please conclude with a decision (Approved / Approved with Mandatory Changes / Rejected) and, if not Rejected, Implementation Boundaries Confirmed per §3 Phase 3.

---

**Status:** Submitted for external review. No code/migration applied yet.
