-- 2026-05-21 (Wael) — F6a Phase 2 Step 4: cron analyze-new-tickets.
--
-- Schedules pg_cron to call dispatch-ticket-analysis every minute. The
-- dispatcher Edge Function scans tickets WHERE status='new' AND
-- hubspot_ticket_id IS NOT NULL AND created_at >= its internal
-- baseline ('2026-05-21T05:00:00Z'), then invokes analyze-ticket on
-- up to 5 qualifying tickets per firing (BATCH_LIMIT throttle).
--
-- Anon JWT pattern mirrors evaluate-rules-every-minute cron — gateway
-- pass-through; dispatcher itself uses SUPABASE_SERVICE_ROLE_KEY env
-- var to invoke analyze-ticket server-to-server.

SELECT cron.schedule(
  'analyze-new-tickets-every-minute',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/dispatch-ticket-analysis',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoZ3lwcGJ4Z21qcndkcGR1YmN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NTc3MDYsImV4cCI6MjA4OTMzMzcwNn0.I4w141wZlfxOCxDEcsNcgsatHcsXtPOvGV-X5oM3VuQ"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
