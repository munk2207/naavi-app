-- geofence_events: audit log for every geofence fire that passed all checks
-- and triggered the fan-out. Used to compare server-side fire time against
-- tester-reported arrival time for accuracy auditing.
--
-- Written by report-location-event after a successful fireLocationAction().
-- Read by Wael / staff via service role only (no user-facing read path yet).

CREATE TABLE IF NOT EXISTS geofence_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id               uuid NOT NULL,
  rule_label            text,
  fired_at              timestamptz NOT NULL DEFAULT now(),
  event                 text NOT NULL CHECK (event IN ('enter', 'exit', 'dwell')),
  lat                   double precision,
  lng                   double precision,
  distance_from_center_m integer
);

-- Index for per-user audit queries
CREATE INDEX IF NOT EXISTS geofence_events_user_fired
  ON geofence_events (user_id, fired_at DESC);

-- RLS: only service role can write; no direct client access
ALTER TABLE geofence_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON geofence_events
  FOR ALL USING (auth.role() = 'service_role');
