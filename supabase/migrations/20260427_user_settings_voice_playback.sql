-- Add voice_playback toggle to user_settings.
-- When false, mobile mutes ALL TTS (chat replies, hands-free cues, etc.)
-- and hides the orange Stop button. Text replies still display normally.
-- Default true preserves existing behavior for users who haven't changed it.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS voice_playback BOOLEAN DEFAULT true;
