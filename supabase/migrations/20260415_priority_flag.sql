-- Priority flag — allows Robert to mark any item as important
-- Items flagged as priority trigger a phone call instead of SMS
-- "What's important?" queries all 3 tables for is_priority = true

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS is_priority boolean DEFAULT false;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS is_priority boolean DEFAULT false;
ALTER TABLE knowledge_fragments ADD COLUMN IF NOT EXISTS is_priority boolean DEFAULT false;
