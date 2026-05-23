-- Geofence Health Check — daily at 12:00 UTC (8 AM EST during DST, 7 AM EST during standard time)
--
-- B4o (Wael 2026-05-23) — server-side safety net for users who don't open the
-- app frequently enough for the in-app reprompt (B4l) or banner (B4n) to
-- trigger. Pings Supabase Edge Function geofence-health-check daily; the
-- function finds users with active location rules but no recent
-- syncGeofences-end registered>0 event in the last 24h and notifies them
-- via push + SMS so they reopen the app and re-arm permissions.
--
-- Schedule rationale: 8 AM EST (12:00 UTC during DST) is early enough that
-- users get the notification before their typical "drive to Costco" hours
-- but late enough not to wake them up. In standard time (Nov-Mar) this
-- fires at 7 AM EST — still acceptable.
--
-- The cron-job ANON key is the project's public anon JWT, same as used by
-- every other cron in this directory (evaluate-rules, gmail-sync, check-
-- reminders, etc.). The Edge Function uses its own internal SUPABASE_
-- SERVICE_ROLE_KEY for the DB queries + downstream send-push/send-sms calls.

SELECT cron.schedule(
  'geofence-health-check-daily',
  '0 12 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/geofence-health-check',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoZ3lwcGJ4Z21qcndkcGR1YmN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NTc3MDYsImV4cCI6MjA4OTMzMzcwNn0.I4w141wZlfxOCxDEcsNcgsatHcsXtPOvGV-X5oM3VuQ"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
