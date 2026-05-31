-- brief_windows — per-user briefing schedule (2026-05-31).
--
-- Replaces the single morning_call_enabled + morning_call_time pair with a
-- JSONB column that stores settings for all four brief windows independently.
-- Each window has: enabled (bool), time (HH:MM), channels (text[]).
--
-- Default preserves existing behavior: morning on, all channels, 08:00.
-- Other windows default to off so no existing user receives unexpected calls.
--
-- Backward compat: trigger-morning-call falls back to morning_call_enabled +
-- morning_call_time when brief_windows IS NULL (users who have never opened
-- the new Briefings settings page).

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS brief_windows JSONB
  DEFAULT '{
    "morning":  {"enabled": true,  "time": "08:00", "channels": ["voice","sms","whatsapp","email","push"]},
    "midday":   {"enabled": false, "time": "12:00", "channels": ["push"]},
    "evening":  {"enabled": false, "time": "17:00", "channels": ["push"]},
    "night":    {"enabled": false, "time": "20:00", "channels": ["push"]}
  }'::jsonb;
