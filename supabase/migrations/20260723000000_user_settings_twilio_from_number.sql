-- Per-user outbound Twilio sender number, optional.
-- NULL for every existing user (Wael, Huss) — evaluate-rules/check-reminders
-- fall back to the shared TWILIO_FROM_NUMBER exactly as before. Only set for
-- accounts that need their own dedicated sending identity (e.g. the YouTube
-- demo account), via the existing config.from_number override chain — see
-- evaluate-rules/index.ts and check-reminders/index.ts, 2026-07-23.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS twilio_from_number text;
