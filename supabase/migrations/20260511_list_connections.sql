-- F1a — Lists wired to events (Wael 2026-05-11).
--
-- Spec: docs/F1A_LISTS_AND_CONNECTIONS_SPEC.md (locked 2026-05-09).
--
-- list_connections wires ONE list to MANY entities. Each entity (alert,
-- calendar event, email, contact, etc.) can have AT MOST ONE list at a
-- time. The cardinality is enforced at the DB layer via the partial
-- UNIQUE index on (entity_type, entity_id) below.
--
-- Cascade behavior (per spec):
--   - Delete an entity → connection removed silently (each entity is the
--     authority over its OWN connection). For action_rules and lists,
--     the FK ON DELETE CASCADE handles this for in-DB entities. For
--     external entities (Gmail message_id, Google Calendar event_id),
--     application code cleans up via a periodic sweep — the FK doesn't
--     reach into Google.
--   - Delete a list → cascade deletes all connections (FK ON DELETE CASCADE).
--     Per spec the user is warned by the application FIRST, listing every
--     entity affected, before the DELETE statement runs.
--
-- Data-integrity layers (CLAUDE.md FOUR LAYERS):
--   1. UNIQUE (entity_type, entity_id) — physical impossibility of an
--      entity having two lists.
--      NOT NULL on every column the app reads.
--      CHECK on entity_type to bound the allowed values.
--   2. Single write entry — manage-list-connections Edge Function owns
--      all connect/disconnect writes. No direct client INSERTs.
--   3. RLS: SELECT for owner, ALL for service role. Authenticated users
--      cannot INSERT/UPDATE/DELETE directly — must go through the Edge
--      Function (which runs as service_role).
--   4. Tests in tests/catalogue/data-integrity.ts cover dupe-entity
--      blocked, same-list-many-entities allowed, RLS lockdown.
--
-- The data migration that converts existing action_config.tasks[] and
-- action_config.list_name into list_connections rows ships as a separate
-- migration file (20260511_migrate_alert_tasks_to_lists.sql or as a
-- one-shot Edge Function call) — this file is schema-only.

CREATE TABLE IF NOT EXISTS list_connections (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  list_id      uuid         NOT NULL REFERENCES lists(id)      ON DELETE CASCADE,
  entity_type  text         NOT NULL,
  entity_id    text         NOT NULL,
  created_at   timestamptz  NOT NULL DEFAULT now(),

  -- Bound the entity_type to the entities Naavi knows how to surface a
  -- list against. Adding new types later is one ALTER away.
  CONSTRAINT list_connections_entity_type_known CHECK (
    entity_type IN (
      'action_rule',          -- alerts (location, time, email, calendar, etc.)
      'calendar_event',       -- Google Calendar event id
      'gmail_message',        -- Gmail message id
      'contact',              -- contacts table id
      'document',             -- documents table id
      'reminder',             -- reminders table id
      'sent_message',         -- sent_messages table id
      'knowledge_fragment',   -- knowledge_fragments table id
      'list'                  -- list-to-list (e.g., parent list of sub-lists)
    )
  )
);

-- Cardinality enforcement: each entity has at most ONE list.
CREATE UNIQUE INDEX IF NOT EXISTS idx_list_connections_one_list_per_entity
  ON list_connections (entity_type, entity_id);

-- Hot path: "what's connected to this list?" / "which lists does this user have wired?"
CREATE INDEX IF NOT EXISTS idx_list_connections_list_id ON list_connections (list_id);
CREATE INDEX IF NOT EXISTS idx_list_connections_user_id ON list_connections (user_id);

ALTER TABLE list_connections ENABLE ROW LEVEL SECURITY;

-- Users can READ their own connections (for the mobile UI's "Connected to:"
-- line on list-detail and alert-detail screens).
CREATE POLICY list_connections_user_select
  ON list_connections FOR SELECT
  USING (auth.uid() = user_id);

-- Writes go ONLY through service_role (manage-list-connections Edge Function).
-- No FOR ALL policy for authenticated users — CLAUDE.md data-integrity layer 3.
CREATE POLICY list_connections_service_role_all
  ON list_connections FOR ALL
  USING (auth.role() = 'service_role');
