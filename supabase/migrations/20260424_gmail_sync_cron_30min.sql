-- Reduce sync-gmail cadence from every 15 min → every 30 min
--
-- Cost reduction: cron runs flat regardless of user count, but each tier-1
-- email triggers Haiku classification + harvest + OCR. Halving the cron
-- frequency halves the per-user email-processing cost. Email-to-Naavi
-- latency goes from ~7-10 min avg to ~15-20 min — acceptable for a system
-- with intermittent test users.
--
-- Session 23, 2026-04-24.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-gmail-every-15-minutes') THEN
    PERFORM cron.unschedule('sync-gmail-every-15-minutes');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-gmail-every-30-minutes') THEN
    PERFORM cron.unschedule('sync-gmail-every-30-minutes');
  END IF;
END
$$;

SELECT cron.schedule(
  'sync-gmail-every-30-minutes',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/sync-gmail',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
