-- 2026-05-17 — Add inside/outside state to location rules.
--
-- Today's bugs (Wael at home 09:40-11:47 EDT):
--   A) 11:37 phantom ENTER fired while user never moved from home
--      (last ENTER at 09:40, no EXIT in between — Transistorsoft re-fired
--      ENTER for a stationary device, server's 30-min dedup window had
--      already elapsed at 117 min)
--   B) 09:40 duplicate fan-out — two T3s arrived 283 ms apart, both
--      passed the action_rule_log dedup check (race), both fan-outs
--      succeeded → user got TWO sets of quadruple-channel alerts
--
-- Fix: state machine. ENTER only fires if (a) never entered before,
-- (b) we have an EXIT newer than the last ENTER, or (c) the last ENTER
-- is older than 4 hours (TTL safety net for missed EXITs).
--
-- The UPDATE is atomic at the row level — racing T3s both attempt the
-- UPDATE; only one gets the row back, the other sees zero rows and
-- skips. No advisory locks or transactions needed.
--
-- Columns are NULL-able and default NULL — backward compatible for all
-- existing rules. Non-location rules (email/time/calendar/etc.) ignore
-- these columns entirely.

ALTER TABLE action_rules
  ADD COLUMN IF NOT EXISTS last_entered_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_exited_at  timestamptz;

-- Partial index speeds up the state-machine UPDATE WHERE clause on the
-- hot path. Location rules only (trigger_type='location' is the only
-- one using ENTER/EXIT).
CREATE INDEX IF NOT EXISTS idx_action_rules_loc_state
  ON action_rules (id)
  WHERE trigger_type = 'location';

COMMENT ON COLUMN action_rules.last_entered_at IS
  'Timestamp of the last accepted ENTER event for this rule. Used by report-location-event for atomic ENTER dedup (state machine). NULL = never entered.';
COMMENT ON COLUMN action_rules.last_exited_at IS
  'Timestamp of the last EXIT event for this rule. Used by report-location-event state machine to know if the user has left since the last ENTER. NULL = never exited.';

-- Atomic ENTER state-machine check. Returns the rule_id (one row) iff the
-- ENTER should fan out; returns no rows if the rule's state says the user
-- is already considered "inside."
--
-- Written as a SQL function rather than a REST .or() chain because PostgREST
-- cannot do column-to-column comparisons (last_exited_at > last_entered_at)
-- in its filter syntax. The atomic UPDATE serializes racing T3 calls at the
-- row level; only one wins and gets the id back.
CREATE OR REPLACE FUNCTION try_enter_geofence(
  p_rule_id   uuid,
  p_ttl_hours int DEFAULT 4
)
RETURNS TABLE(id uuid)
LANGUAGE sql
AS $$
  UPDATE action_rules
  SET    last_entered_at = NOW()
  WHERE  id      = p_rule_id
    AND  enabled = true
    AND  (
           last_entered_at IS NULL
        OR (last_exited_at IS NOT NULL AND last_exited_at > last_entered_at)
        OR last_entered_at < NOW() - (p_ttl_hours::text || ' hours')::interval
         )
  RETURNING action_rules.id;
$$;

COMMENT ON FUNCTION try_enter_geofence IS
  'Atomic state-machine check for location ENTER events. Called by report-location-event. Returns the rule id if fanout should proceed, no rows if the user is considered already inside (stationary re-fire or T3 race loser).';
