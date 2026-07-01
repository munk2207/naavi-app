-- Core user_settings columns added manually in production (no prior migration).
-- Added here so staging and new environments have them before later migrations
-- reference them (e.g. 20260513000001 reads `phone` for backfill).
--
-- NOTE: `supabase db push` on staging may report this version as a mismatch
-- ("Remote migration versions not found in local migrations directory").
-- This is a verified CLI diff false-positive, not real drift — do NOT run
-- `supabase migration repair --status reverted`. See
-- docs/STAGING_MIGRATION_TRACKING_QUIRK_2026-07-01.md before touching this.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS name         text,
  ADD COLUMN IF NOT EXISTS phone        text,
  ADD COLUMN IF NOT EXISTS email        text,
  ADD COLUMN IF NOT EXISTS push_token   text,
  ADD COLUMN IF NOT EXISTS brief_opt_in boolean NOT NULL DEFAULT true;
