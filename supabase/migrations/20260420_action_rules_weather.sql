-- Extend action_rules.trigger_type to accept 'weather'.
--
-- Session 20: first new alert trigger beyond email/time/calendar.
-- Config shape (stored in action_rules.trigger_config JSONB):
--   {
--     "condition": "rain" | "snow" | "temp_max_above" | "temp_min_below",
--     "threshold": number,        // % for rain/snow, °C for temp
--     "when":      "today" | "tomorrow" | "next_3_days" | "this_week" | "YYYY-MM-DD",
--     "city":      string,        // optional, defaults to "Ottawa"
--     "match":     "any" | "all"  // optional, defaults to "any" (multi-day only)
--   }
--
-- Handler logic + prompt RULE ship in a follow-up commit.

ALTER TABLE action_rules DROP CONSTRAINT action_rules_trigger_type_check;

ALTER TABLE action_rules ADD CONSTRAINT action_rules_trigger_type_check
  CHECK (trigger_type IN ('email', 'time', 'calendar', 'weather'));
