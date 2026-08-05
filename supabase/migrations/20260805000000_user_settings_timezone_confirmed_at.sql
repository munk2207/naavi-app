-- B10x Track 2 (Voice) — confirmation-state marker for user_settings.timezone.
-- The existing `timezone` column defaults to 'America/Toronto' for every
-- row, so presence alone can't distinguish "the user confirmed this" from
-- "never asked, still on the default." NULL = never confirmed (voice must
-- ask); non-null = `timezone` holds a value the user actually confirmed.
-- Timestamp (not boolean) for auditability, per external review 2026-08-05.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS timezone_confirmed_at timestamptz NULL;
