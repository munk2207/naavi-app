-- ============================================================================
-- user_places — data integrity hardening (V57.13.1)
--
-- Wael 2026-05-07: enforce that corrupted location data CANNOT enter the DB.
-- Four-layer defense (see CLAUDE.md "DATA INTEGRITY — FOUR LAYERS"):
--
--   LAYER 1 — DB constraints (this migration):
--     - aliases text[] NOT NULL — multiple aliases per place, no row duplication
--     - address text — populated by Google Places at write time
--     - UNIQUE (user_id, ROUND(lat,5), ROUND(lng,5)) — same physical place
--       cannot exist twice for one user, ever
--     - CHECK lat∈[-90,90], lng∈[-180,180], radius_meters > 0
--   LAYER 2 — single write entry point (resolve-place Edge Function rewrite,
--     deployed in lockstep with this migration)
--   LAYER 3 — RLS lockdown (this migration): only service_role can write,
--     forcing all writes through Layer 2's validation pipeline
--   LAYER 4 — schema redesign (this migration): aliases array eliminates
--     "two rows per place" footgun by construction
--
-- Backward-compatible: keeps `alias` column populated (= aliases[1]) so any
-- legacy reader that still queries by alias keeps working until removed in
-- a follow-up cleanup migration.
--
-- Existing data: 42 rows across 2 users. Includes 4 Walmart duplicates
-- collapsed to 2 by this migration. Snapshot saved to
-- backups/user_places-2026-05-07T18-02-10-458Z.json + restore SQL.
-- ============================================================================

BEGIN;

-- ── 1. Add the new columns ──────────────────────────────────────────────────
-- aliases is the new lookup key (text[]). address gets populated by the
-- post-migration backfill script (reverse-geocode each lat/lng via Google
-- Places). NOT NULL on address is added in a follow-up migration after
-- backfill is verified.
ALTER TABLE user_places
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS address text;

-- ── 2. Backfill aliases from the legacy alias column ────────────────────────
UPDATE user_places SET aliases = ARRAY[alias] WHERE aliases = ARRAY[]::text[];

-- ── 3. Collapse duplicates by rounded coordinates ───────────────────────────
-- For each (user_id, rounded_lat, rounded_lng) group:
--   - Keep the OLDEST row (by created_at)
--   - Merge the alias arrays from all duplicates into the keeper's aliases
--   - Delete the others
WITH ranked AS (
  SELECT
    id,
    user_id,
    ROUND(lat::numeric, 5) AS rlat,
    ROUND(lng::numeric, 5) AS rlng,
    aliases,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, ROUND(lat::numeric, 5), ROUND(lng::numeric, 5)
      ORDER BY created_at ASC
    ) AS rn
  FROM user_places
),
keepers AS (
  SELECT id, user_id, rlat, rlng FROM ranked WHERE rn = 1
),
merged AS (
  -- For each coord group, the union of all aliases across all rows
  SELECT
    r.user_id,
    r.rlat,
    r.rlng,
    array_agg(DISTINCT a ORDER BY a) AS merged_aliases
  FROM ranked r
  CROSS JOIN LATERAL unnest(r.aliases) AS a
  GROUP BY r.user_id, r.rlat, r.rlng
)
UPDATE user_places up
   SET aliases = m.merged_aliases
  FROM keepers k
  JOIN merged  m
    ON m.user_id = k.user_id AND m.rlat = k.rlat AND m.rlng = k.rlng
 WHERE up.id = k.id;

-- Now delete the non-keepers
DELETE FROM user_places
 WHERE id IN (
   SELECT id FROM (
     SELECT
       id,
       ROW_NUMBER() OVER (
         PARTITION BY user_id, ROUND(lat::numeric, 5), ROUND(lng::numeric, 5)
         ORDER BY created_at ASC
       ) AS rn
     FROM user_places
   ) t
   WHERE t.rn > 1
 );

-- Keep alias column populated as aliases[1] for backward compat
UPDATE user_places SET alias = aliases[1] WHERE aliases[1] IS NOT NULL;

-- ── 4. Drop the legacy (user_id, alias) UNIQUE constraint ───────────────────
-- The new logical key is (user_id, rounded_coords). The alias column stays
-- as a display field (= aliases[1]) but no longer enforces uniqueness.
ALTER TABLE user_places DROP CONSTRAINT IF EXISTS user_places_user_id_alias_key;

-- ── 5. Add the new logical-key UNIQUE constraint on rounded coords ──────────
-- ROUND to 5 decimals = ~1.1 m precision. Two rows for the same physical
-- location are now physically impossible at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS user_places_unique_rounded_coords_idx
  ON user_places (user_id, ROUND(lat::numeric, 5), ROUND(lng::numeric, 5));

-- ── 6. Add CHECK constraints — coordinates and radius must be sane ──────────
-- PostgreSQL doesn't support `ADD CONSTRAINT IF NOT EXISTS` for CHECK
-- constraints (only for tables/columns/indexes). Use DO blocks for idempotency.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_places_lat_check') THEN
    ALTER TABLE user_places ADD CONSTRAINT user_places_lat_check CHECK (lat BETWEEN -90 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_places_lng_check') THEN
    ALTER TABLE user_places ADD CONSTRAINT user_places_lng_check CHECK (lng BETWEEN -180 AND 180);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_places_radius_check') THEN
    ALTER TABLE user_places ADD CONSTRAINT user_places_radius_check CHECK (radius_meters > 0);
  END IF;
END $$;

-- ── 7. RLS lockdown — only service_role may write ───────────────────────────
-- Original migration had a single FOR ALL policy ("Users manage own places")
-- that granted authenticated users INSERT/UPDATE/DELETE on their own rows.
-- That bypassed validation: a buggy mobile-app code path could insert junk
-- directly without going through resolve-place. We now restrict writes to
-- service_role (resolve-place runs as service_role); users keep SELECT.
DROP POLICY IF EXISTS "Users manage own places" ON user_places;

CREATE POLICY "Users read own places"
  ON user_places FOR SELECT
  USING (auth.uid() = user_id);

-- The "Service role full access places" policy from the original migration
-- already covers INSERT/UPDATE/DELETE for service_role. Verify it exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'user_places'
       AND policyname = 'Service role full access places'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "Service role full access places"
        ON user_places FOR ALL
        USING (auth.role() = 'service_role')
    $POL$;
  END IF;
END $$;

COMMIT;

-- ── Post-migration TODO (separate steps, not in this transaction) ───────────
-- 1. Run scripts/backfill_user_places_address.js to populate `address` for
--    all 40 existing rows via Google Places reverse geocoding.
-- 2. After backfill verified, ship a follow-up migration adding NOT NULL on
--    address. Until then the resolve-place Edge Function is responsible for
--    always populating address on new writes.
-- 3. Future: drop the legacy `alias` column once nothing reads from it.
