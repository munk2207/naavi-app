-- Cron: check-ticket-replies every minute (2026-06-01)
SELECT cron.schedule(
  'check-ticket-replies-every-minute',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/check-ticket-replies',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoZ3lwcGJ4Z21qcndkcGR1YmN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NTc3MDYsImV4cCI6MjA4OTMzMzcwNn0.I4w141wZlfxOCxDEcsNcgsatHcsXtPOvGV-X5oM3VuQ"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
