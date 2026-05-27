-- ============================================================================
-- V57.22.5 — action_rules: ONE ROW PER PLACE (no enabled-filter on unique index)
--
-- Wael 2026-05-26: "If we keep every alert to the same location forever, it
-- creates an unusable list. The cleaner way is always keep one alert only.
-- Meaning if I have an alert at location A and it expires, it stays gray /
-- listed as expired. If a new alert at location A is created, just re-arm
-- the existing one. By doing that we have only one alert — either active
-- or expired — no possibility of duplicate."
--
-- This replaces V57.13.3's partial UNIQUE INDEX (which had WHERE enabled=true,
-- allowing multiple disabled rows at the same place to accumulate over time)
-- with a broader partial UNIQUE INDEX that applies to BOTH enabled and
-- disabled rows. After this migration there can be exactly one
-- action_rules row per (user_id, location coords).
--
-- Migration steps (idempotent, safe to re-run):
--   1. Cleanup existing duplicates — for each (user_id, rounded coords)
--      cluster with N > 1 location rows, keep the preferred row (enabled
--      row first; if no enabled row, the most-recent by created_at).
--      Delete the rest.
--   2. Drop the V57.13.3 partial index (`WHERE enabled = true`).
--   3. Create new partial index — no enabled filter. Applies to all
--      location rules with resolved coords.
--
-- Reference:
--   - 20260507_drop_user_places_action_rules_dedup.sql (V57.13.3 index
--     this migration supersedes).
--   - CLAUDE.md FOUNDATIONAL PRINCIPLE — "alerts ARE the saved-place memory".
-- ============================================================================

BEGIN;

-- 1. Cleanup — collapse each (user_id, rounded coords) cluster to ONE row.
--    Within each cluster the preferred survivor is:
--      a) An enabled row if one exists (treats enabled = NULL or TRUE as enabled).
--      b) Otherwise the most-recent row by created_at.
--    All other rows in the cluster are deleted.
--    Rows without resolved_lat/resolved_lng are not subject to the
--    constraint and are skipped by this cleanup.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        user_id,
        trigger_type,
        ROUND((trigger_config->>'resolved_lat')::numeric, 5),
        ROUND((trigger_config->>'resolved_lng')::numeric, 5)
      ORDER BY
        CASE WHEN enabled IS DISTINCT FROM FALSE THEN 0 ELSE 1 END,  -- enabled (or NULL) first
        created_at DESC NULLS LAST                                     -- then most-recent
    ) AS rn
  FROM action_rules
  WHERE trigger_type = 'location'
    AND (trigger_config->>'resolved_lat') IS NOT NULL
    AND (trigger_config->>'resolved_lng') IS NOT NULL
)
DELETE FROM action_rules
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- 2. Drop the V57.13.3 enabled-only partial index.
DROP INDEX IF EXISTS action_rules_unique_enabled_location;

-- 3. New broader partial index — applies to enabled AND disabled location
--    rules. Same column shape and rounding as V57.13.3, just without the
--    `enabled = true` filter. Result: one logical row per place, mutable
--    across enabled/disabled states via UPDATE (re-arm or expire).
CREATE UNIQUE INDEX IF NOT EXISTS action_rules_unique_location
  ON action_rules (
    user_id,
    trigger_type,
    ROUND((trigger_config->>'resolved_lat')::numeric, 5),
    ROUND((trigger_config->>'resolved_lng')::numeric, 5)
  )
  WHERE trigger_type = 'location'
    AND (trigger_config->>'resolved_lat') IS NOT NULL
    AND (trigger_config->>'resolved_lng') IS NOT NULL;

COMMIT;
