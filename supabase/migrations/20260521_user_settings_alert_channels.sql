-- 2026-05-21 (Wael) — F2g Phase 1: per-user alert channel preferences.
--
-- Reverses the 2026-04-21 CLAUDE.md ALERT FAN-OUT hard rule that
-- channel choice "is not a user preference — it's a reliability
-- guarantee" by introducing a per-USER (not per-rule) opt-out list.
-- Defaults to ALL 5 channels enabled, so no behavior changes for any
-- existing user. Users who explicitly opt out of channels via mobile
-- Settings (F2g Phase 2, ships in next AAB) get fewer alerts on those
-- channels. CHECK constraint enforces an at-least-one floor so a user
-- cannot disable all channels and silently miss alerts entirely.
--
-- Allowed channel values (must match channel names emitted by
-- evaluate-rules `fireAction()`):
--   sms, whatsapp, email, push, voice_call

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS alert_channels_enabled TEXT[]
    NOT NULL
    DEFAULT ARRAY['sms','whatsapp','email','push','voice_call'];

ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_alert_channels_at_least_one;

ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_alert_channels_at_least_one
    CHECK (array_length(alert_channels_enabled, 1) >= 1);

COMMENT ON COLUMN user_settings.alert_channels_enabled IS
  '2026-05-21 (F2g Phase 1). Per-user opt-in list for alert channels. Allowed values: sms, whatsapp, email, push, voice_call. fireAction() in evaluate-rules reads this array and only sends on channels present here. CHECK constraint enforces array_length >= 1 (cannot disable all channels). Default = all 5 enabled (no behavior change for existing users).';
