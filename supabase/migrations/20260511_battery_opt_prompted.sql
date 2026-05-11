-- In-app Battery Optimization prompt tracking (Wael 2026-05-11, AAB queue item 23).
--
-- Two columns gate the prompt:
--   battery_opt_prompted          — terminal accept flag. Set true when user
--                                   taps "Yes, open it" on the Naavi card.
--                                   Never prompt again once true.
--   battery_opt_last_prompted_date — calendar date last shown. Throttles to
--                                    at most one prompt per day for users
--                                    who tap "Not now" (Q2=2 — re-prompt at
--                                    next morning brief if location rules
--                                    still exist).
--
-- Design: project_naavi_battery_opt_inapp_prompt.md.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS battery_opt_prompted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS battery_opt_last_prompted_date date;

COMMENT ON COLUMN user_settings.battery_opt_prompted IS
  'True once the user has tapped "Yes, open it" on the in-app Battery Optimization prompt. Terminal — prompt never fires again. (Wael 2026-05-11)';
COMMENT ON COLUMN user_settings.battery_opt_last_prompted_date IS
  'Last calendar date the in-app Battery Optimization prompt was shown. Throttles to at most once per day for users who tap "Not now". (Wael 2026-05-11)';
