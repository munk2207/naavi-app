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
-- Staging note: user_places was dropped in migration 20260507000000. This DO
-- block skips gracefully if the table doesn't exist.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_places'
  ) THEN
    RAISE NOTICE 'user_places not found — skipping integrity migration (dropped by migration 000000).';
    RETURN;
  END IF;

  -- ── 1. Add the new columns ──────────────────────────────────────────────────
  ALTER TABLE user_places
    ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN IF NOT EXISTS address text;

  -- ── 2. Backfill aliases from the legacy alias column ───────────────────────
  UPDATE user_places SET aliases = ARRAY[alias] WHERE aliases = ARRAY[]::text[];

  -- ── 3. Collapse duplicates by rounded coordinates ──────────────────────────
  WITH ranked AS (
    SELECT id, user_id,
      ROUND(lat::numeric, 5) AS rlat, ROUND(lng::numeric, 5) AS rlng,
      aliases, created_at,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, ROUND(lat::numeric, 5), ROUND(lng::numeric, 5)
        ORDER BY created_at ASC) AS rn
    FROM user_places),
  keepers AS (SELECT id, user_id, rlat, rlng FROM ranked WHERE rn = 1),
  merged AS (
    SELECT r.user_id, r.rlat, r.rlng, array_agg(DISTINCT a ORDER BY a) AS merged_aliases
    FROM ranked r CROSS JOIN LATERAL unnest(r.aliases) AS a
    GROUP BY r.user_id, r.rlat, r.rlng)
  UPDATE user_places up SET aliases = m.merged_aliases
    FROM keepers k JOIN merged m ON m.user_id = k.user_id AND m.rlat = k.rlat AND m.rlng = k.rlng
   WHERE up.id = k.id;

  DELETE FROM user_places WHERE id IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY user_id, ROUND(lat::numeric, 5), ROUND(lng::numeric, 5)
        ORDER BY created_at ASC) AS rn
      FROM user_places) t WHERE t.rn > 1);

  UPDATE user_places SET alias = aliases[1] WHERE aliases[1] IS NOT NULL;

  ALTER TABLE user_places DROP CONSTRAINT IF EXISTS user_places_user_id_alias_key;

  CREATE UNIQUE INDEX IF NOT EXISTS user_places_unique_rounded_coords_idx
    ON user_places (user_id, ROUND(lat::numeric, 5), ROUND(lng::numeric, 5));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_places_lat_check') THEN
    ALTER TABLE user_places ADD CONSTRAINT user_places_lat_check CHECK (lat BETWEEN -90 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_places_lng_check') THEN
    ALTER TABLE user_places ADD CONSTRAINT user_places_lng_check CHECK (lng BETWEEN -180 AND 180);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_places_radius_check') THEN
    ALTER TABLE user_places ADD CONSTRAINT user_places_radius_check CHECK (radius_meters > 0);
  END IF;

  DROP POLICY IF EXISTS "Users manage own places" ON user_places;
  CREATE POLICY "Users read own places" ON user_places FOR SELECT USING (auth.uid() = user_id);

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_places'
      AND policyname='Service role full access places') THEN
    CREATE POLICY "Service role full access places" ON user_places FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;
