-- community_members: fast local DB for MyNaavi community contacts.
-- Enables two-phase search (community first, Google Contacts fallback).
-- contact_data stores raw People API fields (names, emailAddresses, phoneNumbers).
-- contact_hash stores SHA-256 of deterministically sorted contact_data for
-- stale-while-revalidate freshness checks (hash mismatch → full row replacement).

CREATE TABLE IF NOT EXISTS community_members (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_name  text        NOT NULL,
  name           text        NOT NULL,
  email          text,
  phone          text,
  contact_data   jsonb       NOT NULL,
  contact_hash   text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_members_user_resource_unique UNIQUE (user_id, resource_name)
);

-- RLS: users read their own rows; all writes go through service_role (naavi-chat)
ALTER TABLE community_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "community_members_select_own"
  ON community_members FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "community_members_service_role_all"
  ON community_members FOR ALL
  USING (auth.role() = 'service_role');

-- Fast lookup by user
CREATE INDEX IF NOT EXISTS community_members_user_id_idx
  ON community_members (user_id);
