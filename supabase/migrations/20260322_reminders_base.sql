-- Reminders base table
-- Created manually in production; this migration recreates it for staging/new environments.
-- Must run BEFORE any migration that ALTERs the reminders table.

CREATE TABLE IF NOT EXISTS reminders (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  title      text        NOT NULL,
  datetime   text,
  phone_number text,
  fired      boolean     NOT NULL DEFAULT false,
  fired_at   timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own reminders"
  ON reminders FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders (fired, datetime) WHERE fired = false;
