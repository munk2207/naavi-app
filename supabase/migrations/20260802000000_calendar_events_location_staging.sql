-- Calendar Context Reliability (Ticket A) — staging schema drift fix.
--
-- Staging's calendar_events table was missing the `location` column that
-- production already has, causing lib/calendar.ts's fetchTodayEvents /
-- fetchUpcomingEvents queries to error on staging (PostgREST: "column
-- calendar_events.location does not exist"), silently caught, returning
-- zero calendar events. This broke both the mobile Brief widget's own
-- calendar display and, downstream, naavi-chat's fallback to the client's
-- cached brief for any travel-time question whose phrasing didn't trigger
-- naavi-chat's own independent live calendar fetch.
--
-- Definition verified against production via PostgREST's OpenAPI schema
-- introspection (2026-08-02) — NOT assumed:
--   "location": { "default": "", "format": "text", "type": "string" }
--   Not present in the `required` array → nullable.
-- Matched exactly here: nullable text, default ''.
--
-- Staging only. Production already has this column — this file is written
-- with IF NOT EXISTS so it can also be applied safely to any environment
-- that already has the column, without failing.
--
-- See docs/CALENDAR_CONTEXT_RELIABILITY_PHASE3_TECHNICAL_REVIEW_2026-08-02.md
-- for the full governance record and the 7 mandatory review changes this
-- migration incorporates.

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS location text DEFAULT '';
