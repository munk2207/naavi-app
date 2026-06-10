-- ============================================================================
-- CLAUDE.md Compliance Fixes — 2026-05-25
--
-- Addresses findings from the compliance audit:
--   1. lists: index → UNIQUE constraint (prevents duplicate list names per user)
--   2. email_watch_rules: drop retired table (Rule 2 — one rule storage per domain)
--   3. contacts: deduplicate then add UNIQUE index on (user_id, lower(name))
--   4. action_rules: partial UNIQUE indexes for non-location trigger types
-- ============================================================================

-- ── 1. lists: UNIQUE constraint on (user_id, name) ───────────────────────────
DROP INDEX IF EXISTS idx_lists_user_name;

ALTER TABLE lists
  ADD CONSTRAINT lists_user_name_unique UNIQUE (user_id, name);

-- ── 2. Drop retired email_watch_rules table ───────────────────────────────────
DROP TABLE IF EXISTS email_watch_rules CASCADE;

-- ── 3. contacts: deduplicate then add UNIQUE index ───────────────────────────
-- Before adding the constraint, remove duplicate contacts keeping the oldest
-- row per (user_id, lower(name)). Duplicates were created by Claude issuing
-- repeated ADD_CONTACT calls for the same person.
DELETE FROM contacts
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, lower(name)) id
  FROM contacts
  ORDER BY user_id, lower(name), created_at ASC NULLS LAST
);

CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_name_unique
  ON contacts (user_id, lower(name));

-- ── 4. action_rules: partial UNIQUE indexes for non-location trigger types ────
-- email: deduplicate on (user_id, from_name, subject_keyword).
CREATE UNIQUE INDEX IF NOT EXISTS action_rules_unique_enabled_email
  ON action_rules (
    user_id,
    (trigger_config->>'from_name'),
    (trigger_config->>'subject_keyword')
  )
  WHERE trigger_type = 'email' AND enabled = true;

-- time: deduplicate on (user_id, datetime string).
CREATE UNIQUE INDEX IF NOT EXISTS action_rules_unique_enabled_time
  ON action_rules (
    user_id,
    (trigger_config->>'datetime')
  )
  WHERE trigger_type = 'time' AND enabled = true;

-- calendar: deduplicate on (user_id, event_match, timing, minutes).
CREATE UNIQUE INDEX IF NOT EXISTS action_rules_unique_enabled_calendar
  ON action_rules (
    user_id,
    (trigger_config->>'event_match'),
    (trigger_config->>'timing'),
    (trigger_config->>'minutes')
  )
  WHERE trigger_type = 'calendar' AND enabled = true;

-- weather: deduplicate on (user_id, condition, location).
CREATE UNIQUE INDEX IF NOT EXISTS action_rules_unique_enabled_weather
  ON action_rules (
    user_id,
    (trigger_config->>'condition'),
    (trigger_config->>'location')
  )
  WHERE trigger_type = 'weather' AND enabled = true;

-- contact_silence: deduplicate on (user_id, contact_id, silence_days).
CREATE UNIQUE INDEX IF NOT EXISTS action_rules_unique_enabled_contact_silence
  ON action_rules (
    user_id,
    (trigger_config->>'contact_id'),
    (trigger_config->>'silence_days')
  )
  WHERE trigger_type = 'contact_silence' AND enabled = true;
