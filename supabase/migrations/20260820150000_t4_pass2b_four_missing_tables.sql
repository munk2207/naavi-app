-- T4 Pass 2b — four tables production has and staging never had.
--
-- Staging is a reconstruction from the migration files, so it holds what those
-- files describe and nothing else. These four were created on production
-- outside that record, and every one of them is read or written by code that
-- ships today:
--
--   pending_disambig   naavi-chat/index.ts  — the "which one did you mean?" flow
--   people             lib/contacts.ts, lib/loadKeyterms.ts, lib/memory.ts
--   conversations      lib/supabase.ts      — conversation history
--   waitlist_signups   join-waitlist/index.ts — website signups
--
-- So this is not tidiness. Four code paths fail on staging today, quietly,
-- because the table simply is not there.
--
-- Definitions are copied from production's fingerprint exactly — types,
-- nullability, defaults, keys, indexes, and the RLS posture. Nothing is
-- redesigned on the way across. Where production is the authority on intent,
-- reproducing it is the only way to be sure staging behaves the same.
--
-- On the RLS intent, which was the gate holding this pass:
--   people and conversations have per-user policies keyed on auth.uid().
--   pending_disambig and waitlist_signups have RLS ENABLED and NO POLICIES —
--   which is not an oversight. It means no client reaches them at all; only the
--   service role does, which is exactly how naavi-chat and join-waitlist use
--   them. Copying that faithfully preserves a deliberate lockdown.
--
-- Idempotent throughout, so applying this to production is a no-op: production
-- already has all four.

BEGIN;

-- ── people ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.people (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  email        text,
  notes        text,
  phone        text,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  relationship text
);
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own people"   ON public.people;
DROP POLICY IF EXISTS "Users can insert own people" ON public.people;
DROP POLICY IF EXISTS "Users can update own people" ON public.people;
DROP POLICY IF EXISTS "Users can delete own people" ON public.people;
CREATE POLICY "Users can read own people"   ON public.people FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own people" ON public.people FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own people" ON public.people FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own people" ON public.people FOR DELETE USING (auth.uid() = user_id);

-- ── conversations ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turns        jsonb NOT NULL DEFAULT '[]'::jsonb,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at   timestamptz DEFAULT now(),
  session_date date NOT NULL DEFAULT CURRENT_DATE
);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own conversations" ON public.conversations;
CREATE POLICY "Users manage own conversations" ON public.conversations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_conversations_user_date
  ON public.conversations USING btree (user_id, session_date DESC);

-- ── pending_disambig ──────────────────────────────────────────────────────
-- RLS on, no policies: service role only. See the note at the top.
CREATE TABLE IF NOT EXISTS public.pending_disambig (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action     text NOT NULL,
  payload    jsonb NOT NULL,
  user_id    uuid NOT NULL,
  expires_at timestamptz DEFAULT (now() + '00:10:00'::interval)
);
ALTER TABLE public.pending_disambig ENABLE ROW LEVEL SECURITY;

-- ── waitlist_signups ──────────────────────────────────────────────────────
-- RLS on, no policies: service role only. See the note at the top.
CREATE TABLE IF NOT EXISTS public.waitlist_signups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,
  source     text DEFAULT 'website'::text,
  status     text DEFAULT 'pending'::text,
  comments   text,
  created_at timestamptz DEFAULT now(),
  invited_at timestamptz
);
ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_email_unique'
  ) THEN
    ALTER TABLE public.waitlist_signups ADD CONSTRAINT waitlist_email_unique UNIQUE (email);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS waitlist_status_idx
  ON public.waitlist_signups USING btree (status, created_at DESC);

COMMIT;
