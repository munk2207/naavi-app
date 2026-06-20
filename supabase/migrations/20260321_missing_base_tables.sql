-- Missing base tables — created manually in production without migrations.
-- This file recreates them for staging and new environments.
-- Must run before any migration that ALTERs these tables.

-- calendar_events
CREATE TABLE IF NOT EXISTS calendar_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  google_event_id text,
  title           text,
  description     text,
  start_time      timestamptz,
  end_time        timestamptz,
  is_priority     boolean     NOT NULL DEFAULT false,
  is_all_day      boolean     NOT NULL DEFAULT false,
  start_date      date,
  end_date        date,
  item_type       text        NOT NULL DEFAULT 'event',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, google_event_id)
);
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own calendar events"
  ON calendar_events FOR ALL USING (auth.uid() = user_id);

-- contacts
CREATE TABLE IF NOT EXISTS contacts (
  id         uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid  REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text,
  email      text,
  phone      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own contacts"
  ON contacts FOR ALL USING (auth.uid() = user_id);

-- gmail_messages
CREATE TABLE IF NOT EXISTS gmail_messages (
  id               uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid  REFERENCES auth.users(id) ON DELETE CASCADE,
  gmail_message_id text,
  thread_id        text,
  subject          text,
  sender_name      text,
  sender_email     text,
  snippet          text,
  body_text        text,
  received_at      timestamptz,
  is_unread        boolean NOT NULL DEFAULT false,
  is_important     boolean NOT NULL DEFAULT false,
  is_tier1         boolean NOT NULL DEFAULT false,
  signal_strength  text,
  labels           text[],
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, gmail_message_id)
);
ALTER TABLE gmail_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own gmail messages"
  ON gmail_messages FOR ALL USING (auth.uid() = user_id);

-- knowledge_fragments
CREATE TABLE IF NOT EXISTS knowledge_fragments (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid    REFERENCES auth.users(id) ON DELETE CASCADE,
  type           text,
  content        text,
  classification text,
  confidence     float,
  source         text,
  embedding      vector(1536),
  is_priority    boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE knowledge_fragments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own knowledge"
  ON knowledge_fragments FOR ALL USING (auth.uid() = user_id);

-- naavi_notes
CREATE TABLE IF NOT EXISTS naavi_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title         text,
  web_view_link text,
  is_deleted    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE naavi_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own notes"
  ON naavi_notes FOR ALL USING (auth.uid() = user_id);

-- push_subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint  text UNIQUE,
  p256dh    text,
  auth      text,
  platform  text NOT NULL DEFAULT 'web',
  fcm_token text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own push subscriptions"
  ON push_subscriptions FOR ALL USING (auth.uid() = user_id);
