-- Gmail Sync Cron Job
--
-- Runs sync-gmail every 5 minutes on Supabase's servers.
-- Completely server-side — no dependency on Robert's device or app state.
-- Robert receives email alerts within ~5 minutes of an email arriving.
--
-- HOW TO RUN THIS:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Replace <YOUR_PROJECT_REF> with your project ref (found in Project Settings → General)
-- 3. Replace <YOUR_SERVICE_ROLE_KEY> with your service role key (Project Settings → API)
-- 4. Run the SQL
--
-- To change the interval in the future, unschedule and reschedule:
--   SELECT cron.unschedule('sync-gmail-every-5-minutes');
--   Then run this file again with a new cron expression:
--   '*/2 * * * *'  → every 2 minutes
--   '*/5 * * * *'  → every 5 minutes  (current)
--   '*/10 * * * *' → every 10 minutes
--
-- Requires pg_net and pg_cron extensions (enabled by default on Supabase).

SELECT cron.schedule(
  'sync-gmail-every-5-minutes',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/sync-gmail',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer <YOUR_SERVICE_ROLE_KEY>"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
