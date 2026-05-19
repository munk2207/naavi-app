-- 2026-05-19 — Movement check + cold-start grace columns on action_rules.
--
-- Pairs with the stationary-phantom rejection guard deployed in
-- report-location-event earlier today. Together the three layers form
-- the server-side defense against Transistorsoft phantom ENTER events:
--
--   1. Deep-inside guard (already live): rejects ENTER if reported coords
--      are within 30% radius of geofence center (phone parked at center,
--      not crossing boundary).
--
--   2. Movement check (this migration): rejects ENTER if reported coords
--      are within 50m of the PREVIOUS event's coords AND the previous
--      event was within 24h. Catches stationary phantoms anywhere inside
--      the geofence (not just at center). Server-side comparison; no
--      mobile change needed.
--
--   3. Cold-start grace (this migration): on the FIRST ever event for a
--      rule (no prior event coords), require reported coords to be near
--      the boundary (≥70% of radius from center). Catches the
--      Transistorsoft initial-state ENTER pattern where the SDK fires
--      "you're inside" immediately after rule registration while the
--      user is already in the geofence. Reuses the last_event_lat/lng
--      columns — no extra flag needed.

ALTER TABLE action_rules
  ADD COLUMN IF NOT EXISTS last_event_lat numeric,
  ADD COLUMN IF NOT EXISTS last_event_lng numeric,
  ADD COLUMN IF NOT EXISTS last_event_at  timestamptz;

COMMENT ON COLUMN action_rules.last_event_lat IS
  '2026-05-19 — Last reported lat from a non-rejected ENTER/EXIT/dwell event. Used by the movement check guard to detect stationary phantoms (no movement since last event).';
COMMENT ON COLUMN action_rules.last_event_lng IS
  '2026-05-19 — Last reported lng from a non-rejected ENTER/EXIT/dwell event. Pair with last_event_lat.';
COMMENT ON COLUMN action_rules.last_event_at IS
  '2026-05-19 — Timestamp of the last_event_lat/lng. Movement check only applies if this is within 24h (stale data falls through to other guards).';
