-- Sync Active Email Alerts — every 5 minutes
--
-- Targeted, cost-bounded fast path for users with an active email-trigger
-- alert. Mirrors the cost-discipline already established for the live-Q&A
-- email read (naavi-chat's fetchLiveRecentEmails — "cost-tuned: not every
-- turn"): only pay the sync cost for users who actually need it, not
-- everyone. Users with no active email alert are unaffected — they stay on
-- the existing sync-gmail-every-30/60-minutes cadence.
--
-- B10q follow-up (2026-07-21) — a user who sets up "alert me when I get an
-- email from Bob" could otherwise wait up to 30 minutes for the general
-- sync-gmail cadence to notice it, a real UX gap for a feature framed as an
-- "alert." sync-active-email-alerts/index.ts queries action_rules for
-- trigger_type='email' AND enabled=true, and calls sync-gmail with
-- target_user_id set (existing, already-supported parameter) for just those
-- users.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ MADE FAIL-SAFE 2026-08-20 (T4). READ THIS BEFORE CHANGING IT BACK.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This file used to call cron.schedule() unconditionally, with a hardcoded
-- STAGING url and an unfilled <SERVICE_ROLE_KEY> placeholder.
--
-- The original header warned about exactly that: "STAGING ONLY… has NOT been
-- applied to production and must not be without Wael's explicit approval…
-- Update the project ref/URL below before ever applying to production."
--
-- The warning was correct and completely ineffective, because `supabase db
-- push` does not read comments. It applies every migration the target
-- database has not recorded. Production is 18 migrations behind (measured
-- 2026-08-20), so a single routine push would have run this file and left
-- PRODUCTION calling a STAGING endpoint every five minutes, forever, with a
-- placeholder where the auth header should be.
--
-- Found while preparing T4's production catch-up. Nothing had gone wrong yet;
-- it was waiting for the first person to run an ordinary command.
--
-- THE FIX: the guard below makes this file a NO-OP unless the operator
-- explicitly opts in for this session. A comment asks a human to notice. A
-- guard does not need them to.
--
-- To run it deliberately:
--     SET LOCAL t4.allow_env_specific_cron = 'yes';
--     -- and replace the url + key below with the CORRECT ones for the target
--
-- The live staging cron was registered directly, not from this file, so
-- skipping it changes nothing about the running system.
--
-- Do NOT commit a real service-role key here.

DO $$
BEGIN
  IF coalesce(current_setting('t4.allow_env_specific_cron', true), '') <> 'yes' THEN
    RAISE NOTICE
      'SKIPPED sync-active-email-alerts cron: this migration hardcodes an '
      'environment-specific URL and key. Set t4.allow_env_specific_cron to '
      'yes, with the correct values for THIS database, to run it.';
    RETURN;
  END IF;

  -- Idempotent: unschedule any existing job of this name before creating it,
  -- so a re-run cannot leave two jobs firing on the same schedule.
  PERFORM cron.unschedule('sync-active-email-alerts-every-5-minutes')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'sync-active-email-alerts-every-5-minutes'
  );

  PERFORM cron.schedule(
    'sync-active-email-alerts-every-5-minutes',
    '*/5 * * * *',
    $job$
      SELECT net.http_post(
        url     := 'https://xugvnfudofuskxoknhve.supabase.co/functions/v1/sync-active-email-alerts',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
        body    := '{}'::jsonb
      );
    $job$
  );
END $$;
