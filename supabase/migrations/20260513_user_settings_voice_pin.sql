-- Caller PIN for voice-server off-phone verification (Wael 2026-05-13)
--
-- Replaces the voice-biometric plan (Picovoice Eagle / HF WavLM, both
-- dropped — see project_naavi_caller_pin_chosen_over_biometric.md).
--
-- When a caller dials Naavi from a phone number that doesn't match any
-- user_settings.phone, the voice server prompts "What's your 4-digit
-- PIN?". On match, load that user's context. 3 failures per call →
-- hang up.
--
-- voice_pin_hash — bcrypt hash of the 4-digit PIN via pgcrypto crypt().
--   Plaintext PIN never stored; hash never sent to client.
-- voice_pin_set_at — when the PIN was last set / changed. Useful for
--   diagnostic and future "PIN older than N days, recommend rotation."

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS voice_pin_hash text,
  ADD COLUMN IF NOT EXISTS voice_pin_set_at timestamptz;

COMMENT ON COLUMN user_settings.voice_pin_hash IS
  'bcrypt hash of the user''s 4-digit voice PIN. Set/changed via manage-voice-pin Edge Function. NULL = no PIN set.';
COMMENT ON COLUMN user_settings.voice_pin_set_at IS
  'Timestamp of the last voice_pin_hash write. NULL when no PIN set.';
