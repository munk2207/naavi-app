-- ============================================================================
-- V57.13.3 — drop user_places + add action_rules location dedup
--
-- Wael 2026-05-07: "Let me suggest removing memory completely" + "if Robert
-- wants to be alerted every time, he can add it as recurring; next time
-- Naavi can check and say 'you already have one'".
--
-- The cache (user_places) was a constant source of bugs and complexity. With
-- it gone, the memory model collapses to one concept: action_rules. The
-- alerts ARE the saved places. action_rules.trigger_config.resolved_lat/
-- resolved_lng holds the coords. Geofencing already reads from action_rules.
--
-- Net change:
--   - DROP TABLE user_places (with all its rows, indexes, RLS policies)
--   - Add UNIQUE INDEX on action_rules for (user_id, location-coords) so
--     the same physical place can't have TWO enabled location alerts for
--     one user. Disabled rules don't block re-creation.
--   - Pre-INSERT, the orchestrator queries this index's rows to detect
--     duplicates and prompts the user instead of silently failing.
--
-- Snapshot before this migration: backups/action_rules-2026-05-07T20-47-02-582Z.json
-- (12 rows, 3 users, 0 existing duplicates).
-- ============================================================================

BEGIN;

-- 1. Drop user_places. CASCADE removes any RLS policies, indexes, and
--    constraints. No FK dependencies in other tables (action_rules's
--    `place_alias` field in trigger_config was speculative — never
--    actually FK-linked).
DROP TABLE IF EXISTS user_places CASCADE;

-- 2. Action_rules location dedup — partial unique index keyed on
--    (user_id, trigger_type, rounded coords) but only for ENABLED
--    location rules with non-null resolved coordinates.
--
--    Why partial: disabled rules + non-location rules don't need the
--    constraint, and filtering them out prevents false conflicts when
--    a user's old one_shot=true rule fires and gets auto-disabled.
CREATE UNIQUE INDEX IF NOT EXISTS action_rules_unique_enabled_location
  ON action_rules (
    user_id,
    trigger_type,
    ROUND((trigger_config->>'resolved_lat')::numeric, 5),
    ROUND((trigger_config->>'resolved_lng')::numeric, 5)
  )
  WHERE trigger_type = 'location'
    AND enabled = true
    AND (trigger_config->>'resolved_lat') IS NOT NULL
    AND (trigger_config->>'resolved_lng') IS NOT NULL;

COMMIT;
