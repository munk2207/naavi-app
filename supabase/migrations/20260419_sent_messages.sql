-- sent_messages: persistent record of every SMS / WhatsApp / email Naavi
-- sends on behalf of a user. Feeds Global Search ("did I text Sarah
-- yesterday?", "what did I tell the doctor last week?") and gives Naavi
-- an audit trail of its outbound actions.

CREATE TABLE IF NOT EXISTS sent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email')),
  to_name text,
  to_phone text,
  to_email text,
  subject text,
  body text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  delivery_status text NOT NULL DEFAULT 'sent'
    CHECK (delivery_status IN ('sent', 'delivered', 'failed', 'queued')),
  provider_sid text,
  source text, -- 'mobile' | 'voice' | 'automation' | 'cron'
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Most queries are "my recent messages" — index accordingly.
CREATE INDEX IF NOT EXISTS idx_sent_messages_user_sent_at
  ON sent_messages (user_id, sent_at DESC);

-- Global Search uses ILIKE on body + recipient. A trigram index makes that
-- fast at scale without embedding cost.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_sent_messages_body_trgm
  ON sent_messages USING gin (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sent_messages_to_name_trgm
  ON sent_messages USING gin (to_name gin_trgm_ops);

-- RLS — users see only their own sent messages. Service role (Edge
-- Functions with service key) bypasses RLS and can insert on behalf of
-- anyone, which is how send-sms / send-email will write rows.
ALTER TABLE sent_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own sent messages" ON sent_messages;
CREATE POLICY "Users read own sent messages" ON sent_messages
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own sent messages" ON sent_messages;
CREATE POLICY "Users insert own sent messages" ON sent_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- No UPDATE/DELETE policies — sent history is append-only from the user's
-- perspective. Service role can still update delivery_status via webhook
-- because it bypasses RLS.
