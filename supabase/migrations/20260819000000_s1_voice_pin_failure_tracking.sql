-- S1 Track D (2026-08-19) — failure tracking and user-controlled lockdown for
-- the voice PIN path.
--
-- WHY THIS IS NOW POSSIBLE AT ALL: before S1 Track A, a failed PIN attempt
-- could not be attributed to anyone. The entered PIN was tested against every
-- account, so a failure meant "matched nobody" — there was no account to
-- charge it to. Now the caller claims an identity (last-4) before the PIN is
-- checked, so a failure belongs to exactly one account and can be counted,
-- alerted on, and acted upon.
--
-- All three columns are ADDITIVE with safe defaults. No existing column is
-- altered and nothing is dropped, so an un-deployed or rolled-back Track D
-- leaves behaviour exactly as it was.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS voice_pin_failed_count      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_pin_failed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS voice_unregistered_blocked  boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN user_settings.voice_pin_failed_count IS
  'S1 Track D — consecutive failed voice-PIN attempts against THIS account. '
  'Reset to 0 on successful PIN authentication. Failures older than the 7-day '
  'window (see voice_pin_failed_at) are not counted toward the alert threshold. '
  'Reset is on successful PIN auth only: a call from the registered phone proves '
  'the person is present but says nothing about who made the earlier attempts, '
  'so it must not erase that signal.';

COMMENT ON COLUMN user_settings.voice_pin_failed_at IS
  'S1 Track D — timestamp of the most recent failed voice-PIN attempt. Used to '
  'age out stale failures. The window is 7 days, not 24 hours: a short window is '
  'trivially evaded by pacing attempts, and does not survive a user who checks '
  'SMS every couple of days (Wael, 2026-08-19).';

COMMENT ON COLUMN user_settings.voice_unregistered_blocked IS
  'S1 Track D — when true, calls from an unregistered phone are refused for this '
  'account even with a correct PIN. Set by the user replying BLOCK to the alert '
  'SMS. Cleared ONLY from the mobile app, deliberately: the recovery channel must '
  'be stronger than the attacked one, so an attacker working the phone line '
  'cannot undo it. Never set automatically — auto-lockout would hand an attacker '
  'a denial-of-service against the real owner (bank model, Wael 2026-08-19).';

-- Deliberately NOT indexed. These columns are only ever read by user_id, which
-- is already the primary access path on this table. An index here would be
-- write cost for no read benefit.
