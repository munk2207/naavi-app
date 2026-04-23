-- Reduce sync-gmail cadence from every 5 min → every 15 min
--
-- Cost reduction: each tier-1 email triggers Haiku classification +
-- attachment harvest + OCR extraction. Running every 5 min means the
-- email pipeline fires 3x more often than needed. Every 15 min still
-- delivers new mail to Naavi within acceptable latency (~10 min avg).
--
-- Session 21, 2026-04-22.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-gmail-every-5-minutes') THEN
    PERFORM cron.unschedule('sync-gmail-every-5-minutes');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-gmail-every-15-minutes') THEN
    PERFORM cron.unschedule('sync-gmail-every-15-minutes');
  END IF;
END
$$;

SELECT cron.schedule(
  'sync-gmail-every-15-minutes',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/sync-gmail',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
