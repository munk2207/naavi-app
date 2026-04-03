-- Reminders Cron Job — April 2, 2026
--
-- Runs check-reminders every minute on Supabase's servers.
-- Completely server-side — fires Twilio SMS when a reminder is due
-- regardless of whether Robert has the app open.

SELECT cron.schedule(
  'check-reminders-every-minute',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/check-reminders',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoZ3lwcGJ4Z21qcndkcGR1YmN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NTc3MDYsImV4cCI6MjA4OTMzMzcwNn0.I4w141wZlfxOCxDEcsNcgsatHcsXtPOvGV-X5oM3VuQ"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
