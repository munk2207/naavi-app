-- Morning Call Cron Job — April 15, 2026
--
-- Runs trigger-morning-call every minute on Supabase's servers.
-- Checks if it's time for Robert's morning brief, then initiates
-- a Twilio outbound call to deliver calendar, weather, emails, reminders.

SELECT cron.schedule(
  'trigger-morning-call-every-minute',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/trigger-morning-call',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoZ3lwcGJ4Z21qcndkcGR1YmN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NTc3MDYsImV4cCI6MjA4OTMzMzcwNn0.I4w141wZlfxOCxDEcsNcgsatHcsXtPOvGV-X5oM3VuQ"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
