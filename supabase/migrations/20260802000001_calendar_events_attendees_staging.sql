-- Calendar Cache Synchronization Integrity (Ticket C) — Fix 1.
--
-- Staging's calendar_events table was also missing `attendees`, which
-- sync-google-calendar's upsert always includes (supabase/functions/
-- sync-google-calendar/index.ts:153). Every event write on staging has
-- therefore been failing silently (error captured, never logged, never
-- surfaced) for as long as this gap existed — while the function's prune
-- step, which does not depend on write success, kept running normally.
-- This is the root cause traced in
-- docs/CALENDAR_CACHE_SYNC_INTEGRITY_PHASE1_PROBLEM_DEFINITION_2026-08-02.md
-- and docs/CALENDAR_CONTEXT_RELIABILITY_INCIDENT_SYNC_DELETION_2026-08-02.md.
--
-- Definition verified against production via PostgREST's OpenAPI schema
-- introspection (2026-08-02) — NOT assumed:
--   "attendees": { "format": "jsonb" } — no default shown, not in the
--   `required` array → nullable jsonb, no default.
--
-- Staging only. Production already has this column — IF NOT EXISTS so this
-- file applies safely to any environment that already has it.
--
-- See docs/CALENDAR_CACHE_SYNC_INTEGRITY_PHASE3_TECHNICAL_REVIEW_2026-08-02.md
-- for the full governance record.

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS attendees jsonb;
