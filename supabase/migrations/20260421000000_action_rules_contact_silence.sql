-- Extend action_rules.trigger_type to accept 'contact_silence'.
--
-- Session 20: fires when a specific sender hasn't emailed within N days.
-- Config shape (stored in action_rules.trigger_config JSONB):
--   {
--     "from_name":        string,   // optional, ILIKE match on sender_name
--     "from_email":       string,   // optional, ILIKE match on sender_email
--     "days_silent":      number,   // required, lookback window
--     "fire_at_hour":     number,   // 0-23, default 7
--     "fire_at_timezone": string    // IANA tz, default America/Toronto
--   }
--
-- At least one of from_name or from_email required. If both set, they AND.

ALTER TABLE action_rules DROP CONSTRAINT action_rules_trigger_type_check;

ALTER TABLE action_rules ADD CONSTRAINT action_rules_trigger_type_check
  CHECK (trigger_type IN ('email', 'time', 'calendar', 'weather', 'contact_silence'));
