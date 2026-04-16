-- 20260416_pending_actions.sql
--
-- Generic follow-up queue for items the user still needs to complete.
-- First consumer: voice recording Q&A (title + participants) that was skipped
-- or interrupted.
--
-- Designed to extend to mobile + other surfaces by adding new `type` values
-- without schema changes (e.g. 'contact_completion', 'note_review').

CREATE TABLE IF NOT EXISTS public.pending_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type            text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolution_data jsonb,
  reminder_count  int NOT NULL DEFAULT 0,
  snooze_until    timestamptz
);

-- Partial index for the hot read path: unresolved items for a user+type.
-- Morning-call follow-up query hits this; mobile pending-list query too.
CREATE INDEX IF NOT EXISTS pending_actions_user_type_unresolved_idx
  ON public.pending_actions (user_id, type)
  WHERE resolved_at IS NULL;

-- Row Level Security
ALTER TABLE public.pending_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own pending actions"
  ON public.pending_actions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users insert own pending actions"
  ON public.pending_actions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own pending actions"
  ON public.pending_actions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role (used by voice server + edge functions) bypasses RLS by default.
