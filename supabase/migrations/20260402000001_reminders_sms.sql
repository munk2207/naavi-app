-- Reminders SMS — April 2, 2026
--
-- Adds phone_number, user_id, fired columns to reminders table
-- so check-reminders Edge Function can send Twilio SMS when due.

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS fired        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fired_at     timestamptz;

-- Index for fast due-reminder queries
CREATE INDEX IF NOT EXISTS reminders_due_idx
  ON reminders (fired, datetime)
  WHERE fired = false;

-- RLS
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own reminders" ON reminders;
CREATE POLICY "Users can manage their own reminders"
  ON reminders FOR ALL
  USING (auth.uid() = user_id);
