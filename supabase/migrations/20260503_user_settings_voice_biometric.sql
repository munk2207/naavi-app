-- Voice biometric (Azure Speaker Verification) — V57.11.0
-- azure_voice_profile_id: the Azure profile ID returned at enrollment time.
--   NULL = not enrolled. Used as the routing target for unknown-number callers
--   who claim to be this user via spoken phone number.
-- azure_voice_offered_at: timestamp of the last time Naavi asked this user
--   "want to set up voice ID?" — gates the prompt so we don't re-ask every call.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS azure_voice_profile_id text,
  ADD COLUMN IF NOT EXISTS azure_voice_offered_at timestamptz;
