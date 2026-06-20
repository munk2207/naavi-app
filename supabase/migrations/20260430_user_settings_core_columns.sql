-- Core user_settings columns added manually in production (no prior migration).
-- Added here so staging and new environments have them before later migrations
-- reference them (e.g. 20260513000001 reads `phone` for backfill).

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS name         text,
  ADD COLUMN IF NOT EXISTS phone        text,
  ADD COLUMN IF NOT EXISTS email        text,
  ADD COLUMN IF NOT EXISTS push_token   text,
  ADD COLUMN IF NOT EXISTS brief_opt_in boolean NOT NULL DEFAULT true;
