-- Reduce sync-gmail cadence from every 15 min → every 60 min
--
-- Cost reduction: with 100 beta users coming online, every 15 min = 96
-- cron ticks/day × N users × (Haiku per tier-1 email + harvest-attachment
-- + OCR). Even modest email volume becomes hundreds of dollars/day.
-- Every 60 min is acceptable testing latency; can revert per-user later.
--
-- 2026-04-30 cost audit: total month-to-date $581 across 2 users; mostly
-- from this pipeline. Reducing 4x cuts ~75% of sync-gmail-driven cost.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-gmail-every-15-minutes') THEN
    PERFORM cron.unschedule('sync-gmail-every-15-minutes');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-gmail-every-60-minutes') THEN
    PERFORM cron.unschedule('sync-gmail-every-60-minutes');
  END IF;
END
$$;

SELECT cron.schedule(
  'sync-gmail-every-60-minutes',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/sync-gmail',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
