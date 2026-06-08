-- Fix reminder datetime column type — 2026-06-08
--
-- The datetime column was TEXT (or TIMESTAMP WITHOUT TIME ZONE).
-- check-reminders compared it against new Date().toISOString() (UTC string)
-- using string comparison → "09:45:00-04:00" < "13:15:00.000Z" → fired instantly.
--
-- Changing to TIMESTAMPTZ forces Postgres to do real timestamp comparison.
-- Values with offset (e.g. "2026-06-08T09:45:00-04:00") are correctly
-- converted to UTC internally (13:45 UTC) and compared properly.

ALTER TABLE reminders
  ALTER COLUMN datetime TYPE timestamptz
  USING datetime::timestamptz;
