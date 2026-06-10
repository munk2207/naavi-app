-- 2026-05-17 — Make calendar_events able to represent all-day events faithfully.
--
-- Bug: Google sent Victoria Day as { start.date: "2026-05-18" } (all-day).
-- The sync wrote that into start_time (timestamptz). Postgres parsed the
-- bare date as midnight UTC May 18 — which is 8 PM EDT May 17. The brief
-- on the user's phone read it back and labeled it "Today — Victoria Day
-- at 8 PM" while the user's own Google Calendar correctly showed it on
-- May 18 all-day. Naavi reformatted truth to fit a column that only held
-- timestamps. CLAUDE.md Rule 18 forbids this — Naavi must present source
-- data as-is.
--
-- Fix: separate all-day from timed at the schema level.
--   - is_all_day boolean   — true when source said all-day (date-only)
--   - start_date date      — the all-day start (Google's start.date as-is)
--   - end_date   date      — the all-day end (Google end is exclusive)
--
-- For all-day rows: start_time / end_time are set to NULL so legacy brief
-- code that does `gte('start_time', today)` correctly excludes them
-- instead of showing them on the wrong day. New brief code reads start_date
-- and renders "All day" / multi-day ranges directly.

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS is_all_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date   date;

COMMENT ON COLUMN calendar_events.is_all_day IS
  'True when the source (Google or Naavi-created) said the event is all-day. start_date/end_date are authoritative; start_time/end_time are NULL.';
COMMENT ON COLUMN calendar_events.start_date IS
  'All-day event start date (Google''s start.date, as-is). NULL for timed events.';
COMMENT ON COLUMN calendar_events.end_date IS
  'All-day event end date (Google''s end.date, exclusive per Google convention). NULL for timed events.';

-- Index for the brief reader's "today's all-day events" query.
CREATE INDEX IF NOT EXISTS idx_calendar_events_all_day
  ON calendar_events (user_id, start_date)
  WHERE is_all_day = true;
