-- Schedule fire-pending-dwells every minute (Wael 2026-05-11).
--
-- Pairs with the pending_dwell_fires table + report-location-event
-- defer logic shipped same day. The cron picks up rows where fire_at
-- has passed, locks them via fired_at, and POSTs back to
-- report-location-event with from_pending_dwell=true to run the
-- existing fan-out.
--
-- Cadence: every minute. Matches evaluate-rules cadence — both fire
-- user-facing alerts and benefit from minute-level precision. Could
-- coalesce into one cron later if cost matters, but the latency budget
-- is tight on geofence arrivals so a separate per-minute tick is worth
-- it for now.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fire-pending-dwells-every-minute') THEN
    PERFORM cron.unschedule('fire-pending-dwells-every-minute');
  END IF;
END
$$;

SELECT cron.schedule(
  'fire-pending-dwells-every-minute',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/fire-pending-dwells',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
