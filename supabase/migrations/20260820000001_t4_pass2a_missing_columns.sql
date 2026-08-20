-- T4 Pass 2a (2026-08-20) — the 10 columns staging is missing.
--
-- WHERE THIS CAME FROM. Wael called production and staging within a minute of
-- each other. Production greeted him normally. Staging announced "this is our
-- first call" and played a 30-second onboarding monologue he could not
-- interrupt — on EVERY call. One missing column caused it.
--
-- WHAT PASS 1 DID NOT DO. Pass 1 fixed constraint definitions: it made staging
-- REJECT what production rejects. It restored no capability. This migration is
-- where staging gets missing function back.
--
-- Every definition below was read from production's own catalogue and verified
-- immediately before this file was written: present in production, absent from
-- staging, exact type and default. Not chosen — copied.
--
-- SAFE BY CONSTRUCTION. All ten are ADD COLUMN IF NOT EXISTS, all nullable or
-- defaulted. No existing row is touched, no table is rewritten, and no write
-- path can break — adding a nullable column cannot invalidate an insert that
-- already worked.
--
-- APPLIED TO BOTH ENVIRONMENTS. On production every statement is a no-op, since
-- all ten already exist there. Applying it to both is what keeps the migration
-- HISTORY aligned — a staging-only migration would leave staging carrying a
-- file production has never seen, which is the drift this work item exists to
-- end. (Pass 1 originally said "staging only"; the Phase 2 review corrected it.)
--
-- Governance: T4 Pass 2, Phase 3 approved 2a and gated 2b and 2c. Authorized
-- scope is this file only — no tables, no RLS, no secrets, no cron jobs.

-- ── user_settings ─────────────────────────────────────────────────────────

-- ⭐ B11c. The voice server WRITES this at dispatch so the onboarding script
-- plays once per user, ever. Without the column the write fails silently and
-- the read fails outright (PostgREST rejects the WHOLE query when any selected
-- column is missing), so isFirstCall never becomes false and every caller hears
-- the full 30-second script forever. It also made B11f's pause/resume feature
-- untestable, because the first 30 seconds of every test call could not be
-- interrupted.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS first_call_completed_at timestamptz;

-- Deepgram keyterm boosting. Absent, staging transcribes names measurably worse
-- than production — which matters for the open B4b investigation into dropped
-- leading words, since that work was being observed on staging.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS voice_keyterms text[] DEFAULT '{}'::text[];

-- Morning-call state. All three are required for the feature to run at all.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS morning_call_status text DEFAULT 'pending'::text;
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS morning_call_attempts integer DEFAULT 0;
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS morning_call_last_attempt timestamptz;

-- ── documents ─────────────────────────────────────────────────────────────

-- OCR pipeline output. extract-document-text writes both: the recognised text,
-- and the Drive id of the .ocr.txt sidecar it uploads alongside the original.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS extracted_text text;
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS ocr_sidecar_drive_file_id text;

-- ── reminders ─────────────────────────────────────────────────────────────

-- Provenance: which surface created the reminder. Defaults to 'voice' in
-- production, matching where reminders are actually written from today.
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'voice'::text;

-- ── row age ───────────────────────────────────────────────────────────────

-- Both default now(), so existing rows get no value and new rows do. Nothing is
-- backfilled: inventing a creation time for a row whose age is unknown would be
-- fabricating data, and a NULL that honestly says "not recorded" is better than
-- a timestamp that is wrong.
ALTER TABLE public.user_tokens
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
