-- Reminders Cron Job — April 2, 2026
--
-- Runs check-reminders every minute on Supabase's servers.
-- Completely server-side — fires Twilio SMS when a reminder is due
-- regardless of whether Robert has the app open.
--
-- HOW TO RUN THIS:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Replace <YOUR_PROJECT_REF> with your project ref (Project Settings → General)
-- 3. Replace <YOUR_ANON_KEY> with your anon key (Project Settings → API)
-- 4. Run the SQL

SELECT cron.schedule(
  'check-reminders-every-minute',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/check-reminders',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer <YOUR_ANON_KEY>"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
