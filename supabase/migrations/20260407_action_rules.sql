-- ============================================================================
-- Unified Trigger-Action Rules
--
-- One table for all automated rules: email triggers, time triggers,
-- calendar triggers → email, SMS, or WhatsApp actions.
-- ============================================================================

CREATE TABLE action_rules (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What triggers this rule
  trigger_type    text        NOT NULL CHECK (trigger_type IN ('email', 'time', 'calendar')),
  trigger_config  jsonb       NOT NULL,
  -- email:    { "from_name": "Sandra", "from_email": null, "subject_keyword": null }
  -- time:     { "datetime": "2026-04-08T15:00:00" }
  -- calendar: { "event_match": "Sandra", "timing": "before", "minutes": 30 }

  -- What action to take when triggered
  action_type     text        NOT NULL CHECK (action_type IN ('email', 'sms', 'whatsapp')),
  action_config   jsonb       NOT NULL,
  -- email:    { "to_name": "John", "to_email": "john@example.com", "subject": "...", "body": "..." }
  -- sms:      { "to_name": "John", "to_phone": "+1234567890", "body": "..." }
  -- whatsapp: { "to_name": "John", "to_phone": "+1234567890", "body": "..." }

  label           text        NOT NULL,     -- "When Sandra emails → WhatsApp John"
  one_shot        boolean     DEFAULT false, -- true = fire once then disable
  enabled         boolean     DEFAULT true,
  last_fired_at   timestamptz,
  created_at      timestamptz DEFAULT now() NOT NULL
);

-- Dedup log — prevents re-firing for the same trigger event
CREATE TABLE action_rule_log (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id         uuid        NOT NULL REFERENCES action_rules(id) ON DELETE CASCADE,
  trigger_ref     text        NOT NULL,    -- gmail_message_id, event_id, or datetime string
  fired_at        timestamptz DEFAULT now() NOT NULL,
  UNIQUE (rule_id, trigger_ref)
);

-- Index for fast cron queries
CREATE INDEX idx_action_rules_enabled ON action_rules (enabled, trigger_type) WHERE enabled = true;
CREATE INDEX idx_action_rule_log_rule ON action_rule_log (rule_id);

-- Row Level Security
ALTER TABLE action_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_rule_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own rules"
  ON action_rules FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users see own logs"
  ON action_rule_log FOR ALL
  USING (rule_id IN (SELECT id FROM action_rules WHERE user_id = auth.uid()));

-- Service role needs full access for the cron Edge Function
CREATE POLICY "Service role full access rules"
  ON action_rules FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access logs"
  ON action_rule_log FOR ALL
  USING (auth.role() = 'service_role');
