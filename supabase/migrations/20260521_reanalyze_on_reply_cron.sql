-- 2026-05-21 (Wael) — F6a Phase 2 Step 6: cron reanalyze-on-reply.
--
-- Schedules pg_cron to call dispatch-reanalyze-on-reply every minute.
-- The dispatcher Edge Function scans tickets WHERE status='drafted'
-- AND hubspot_ticket_id IS NOT NULL AND last_drafted_at IS NOT NULL,
-- checks HubSpot for inbound emails on each, and re-invokes
-- analyze-ticket when the customer has replied since our last draft.
--
-- Same anon JWT pattern + same throttle pattern as
-- analyze-new-tickets-every-minute (Step 4).

SELECT cron.schedule(
  'reanalyze-on-reply-every-minute',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/dispatch-reanalyze-on-reply',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoZ3lwcGJ4Z21qcndkcGR1YmN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NTc3MDYsImV4cCI6MjA4OTMzMzcwNn0.I4w141wZlfxOCxDEcsNcgsatHcsXtPOvGV-X5oM3VuQ"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
