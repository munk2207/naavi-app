-- Multi-phone identity — F1a Wave 2 Phase E (Wael 2026-05-13).
--
-- Lets a user register multiple phone numbers (primary + spouse phone +
-- backup family lines). Voice server recognizes any of them as the same
-- user, so losing a phone doesn't lock the user out of off-phone access.
-- Combined with the in-call PIN flow (shipped 2026-05-13), this covers
-- both the "borrowed family phone" case (no PIN needed — recognized) and
-- the "truly random phone" case (PIN entry).
--
-- Schema choice — single row per user with `phone_numbers text[]` rather
-- than a separate `user_phone_numbers` side table. Per CLAUDE.md
-- DATA INTEGRITY Layer 4: collapse "one row per X with multiple Xs"
-- into one row with an array column to eliminate the footgun by
-- construction. The existing `phone` column is preserved (one release
-- of dual-write) so morning-call code that reads `phone` directly keeps
-- working; `phone_numbers[0]` is the canonical primary.
--
-- Data-integrity layers:
--   1. NOT NULL on existing rows enforced by backfill below.
--      Cross-user uniqueness via the trigger at the bottom of this
--      migration (a literal UNIQUE INDEX on unnest() isn't supported
--      in Postgres; a BEFORE-trigger that raises on duplicates is the
--      idiomatic substitute and runs in the same transaction).
--   2. Voice server `getUserIdByPhone` is the single read entry point
--      for phone→user resolution. Settings.tsx is the single write
--      entry point for mobile-side edits.
--   3. RLS on user_settings already restricts to owner — unchanged.
--   4. Tests in tests/catalogue/data-integrity.ts will gain a
--      cross-user duplicate-phone test (separate commit).

-- Add the array column.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS phone_numbers text[];

-- Backfill from existing phone for users who already have one. Only
-- runs once — `phone_numbers IS NULL` guard prevents re-overwriting
-- on subsequent migration applies.
UPDATE user_settings
  SET phone_numbers = ARRAY[phone]
  WHERE phone IS NOT NULL
    AND phone <> ''
    AND phone_numbers IS NULL;

-- GIN index for fast `:caller = ANY(phone_numbers)` lookup. Without
-- this, every voice call would seq-scan user_settings.
CREATE INDEX IF NOT EXISTS idx_user_settings_phone_numbers
  ON user_settings USING GIN (phone_numbers);

-- Cross-user uniqueness — scan other rows on every INSERT/UPDATE
-- and raise if any element of NEW.phone_numbers is already claimed.
-- Layer 1 enforcement at the DB level; voice server can rely on
-- "one phone = one user" as an invariant.
CREATE OR REPLACE FUNCTION check_phone_numbers_unique()
RETURNS TRIGGER AS $$
DECLARE
  conflict_phone text;
BEGIN
  IF NEW.phone_numbers IS NULL OR array_length(NEW.phone_numbers, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT phone INTO conflict_phone
  FROM (
    SELECT unnest(phone_numbers) AS phone, user_id
    FROM user_settings
    WHERE user_id <> NEW.user_id
      AND phone_numbers IS NOT NULL
  ) others
  WHERE others.phone = ANY(NEW.phone_numbers)
  LIMIT 1;

  IF conflict_phone IS NOT NULL THEN
    RAISE EXCEPTION 'phone_number_already_registered: %', conflict_phone
      USING ERRCODE = '23505';   -- unique_violation
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop + recreate so re-applying the migration is safe.
DROP TRIGGER IF EXISTS trg_user_settings_phone_numbers_unique ON user_settings;
CREATE TRIGGER trg_user_settings_phone_numbers_unique
  BEFORE INSERT OR UPDATE OF phone_numbers ON user_settings
  FOR EACH ROW EXECUTE FUNCTION check_phone_numbers_unique();
