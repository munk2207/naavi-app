-- F2b — demo line SMS opt-out suppression list.
--
-- TCPA compliance gate for the zero-friction demo line (1-888-91-NAAVI).
-- The demo CTA SMS and the new reminder-confirmation SMS both promise
-- "Reply STOP to opt out" — this table is what makes that promise real.
-- Before F2b, no SMS in the app (demo or real-user) had any app-level
-- opt-out enforcement; this table does not retrofit the existing demo CTA
-- SMS path, only the new reminder path (see F2b Phase 2 plan, "No Extra
-- Changes Rule").
--
-- Checked by:
--   - create-demo-reminder Edge Function, before inserting a reminder row
--   - evaluate-rules::fireAction(), immediately before sending, for any
--     action_rules row with action_config.source = 'demo_line'
-- Written by:
--   - naavi-voice-server's inbound SMS webhook, when a demo caller's
--     number replies STOP

CREATE TABLE IF NOT EXISTS demo_optouts (
  phone       text         PRIMARY KEY,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT demo_optouts_phone_nonempty CHECK (length(phone) > 0)
);

-- RLS: service-role only. The voice server and Edge Functions write/read
-- this with the service-role key; no client ever touches it directly.
ALTER TABLE demo_optouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY demo_optouts_service_role_all
  ON demo_optouts
  FOR ALL
  USING (auth.role() = 'service_role');
