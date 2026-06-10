-- Email Watch Rules
-- Robert can ask Naavi to alert him by SMS when an email arrives
-- from a specific person or with a specific word in the subject.

-- ─── email_watch_rules ────────────────────────────────────────────────────────
-- Each row is one alert rule Robert has set up.
-- At least one of from_name, from_email, or subject_keyword must be set.

CREATE TABLE IF NOT EXISTS email_watch_rules (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Match criteria (at least one must be non-null)
  from_name        text,        -- Partial, case-insensitive sender name match e.g. "John Smith"
  from_email       text,        -- Exact sender email match e.g. "john@acme.com"
  subject_keyword  text,        -- Partial, case-insensitive subject match e.g. "invoice"

  -- Where to send the alert
  phone_number     text        NOT NULL,  -- Robert's cell phone e.g. "+16135550123"

  -- Human-readable label shown in confirmations
  label            text        NOT NULL,  -- e.g. "Email from John Smith"

  is_active        boolean     DEFAULT true NOT NULL,
  created_at       timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE email_watch_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own email watch rules"
  ON email_watch_rules FOR ALL
  USING (auth.uid() = user_id);

-- ─── email_alert_log ─────────────────────────────────────────────────────────
-- Tracks which alerts have already been sent so we never SMS Robert twice
-- for the same email.

CREATE TABLE IF NOT EXISTS email_alert_log (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id          uuid        NOT NULL REFERENCES email_watch_rules(id) ON DELETE CASCADE,
  gmail_message_id text        NOT NULL,
  sent_at          timestamptz DEFAULT now() NOT NULL,

  UNIQUE (rule_id, gmail_message_id)
);

ALTER TABLE email_alert_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own alert logs"
  ON email_alert_log FOR SELECT
  USING (auth.uid() = user_id);
