-- Server-side dwell timer for location triggers (Wael 2026-05-11).
--
-- Today: report-location-event fires a location rule's action immediately
-- when Android delivers the ENTER event. Combined with Android's Doze-mode
-- latency, the alert often lands well after the user has actually arrived,
-- and a 100 m radius doesn't leave room to absorb that latency without
-- false-firing en-route. With a server-side dwell:
--
--   ENTER  → insert a row here with fire_at = now() + dwell_seconds
--   EXIT   → set cancelled_at on the active row for that rule
--   Cron   → fire any row where fire_at <= now() AND not cancelled / fired
--
-- Lets us widen geofence radius (e.g. 500 m) without false-firing on drive-
-- through traffic, and gives the user a configurable "must stay this long
-- before firing" gate. Doze-mode latency stacks on top (server can't tell
-- when the OS actually saw the transition), but combined with Battery
-- Optimization OFF for Naavi the alert lands close to actual arrival.
--
-- Data-integrity layers (CLAUDE.md FOUR LAYERS):
--   1. DB constraints  — UNIQUE partial index on rule_id WHERE active;
--                        FK ON DELETE CASCADE for rules/users; CHECK on
--                        fire_at > entered_at and mutual-exclusion on
--                        cancelled_at / fired_at.
--   2. Single write    — report-location-event owns ENTER/EXIT writes;
--                        fire-pending-dwells cron owns fired_at writes.
--   3. RLS lockdown    — service_role only; no direct client writes.
--   4. Tests           — tests/catalogue/data-integrity.ts adds three
--                        cases (duplicate-active blocked, ENTER-after-
--                        cancel allowed, ENTER-after-fired allowed).

CREATE TABLE IF NOT EXISTS pending_dwell_fires (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       uuid          NOT NULL REFERENCES action_rules(id) ON DELETE CASCADE,
  user_id       uuid          NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  entered_at    timestamptz   NOT NULL DEFAULT now(),
  fire_at       timestamptz   NOT NULL,
  cancelled_at  timestamptz,
  fired_at      timestamptz,
  created_at    timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pending_dwell_fires_fire_after_enter
    CHECK (fire_at > entered_at),
  CONSTRAINT pending_dwell_fires_not_both_terminal
    CHECK (cancelled_at IS NULL OR fired_at IS NULL)
);

-- One active pending row per rule. A new ENTER while a prior row is still
-- pending should replace it (handled in report-location-event by cancelling
-- the prior row before inserting). The partial index enforces the rule at
-- the DB layer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_dwell_fires_one_active_per_rule
  ON pending_dwell_fires (rule_id)
  WHERE cancelled_at IS NULL AND fired_at IS NULL;

-- Cron query path: WHERE fire_at <= now() AND cancelled_at IS NULL AND fired_at IS NULL.
CREATE INDEX IF NOT EXISTS idx_pending_dwell_fires_ready_to_fire
  ON pending_dwell_fires (fire_at)
  WHERE cancelled_at IS NULL AND fired_at IS NULL;

ALTER TABLE pending_dwell_fires ENABLE ROW LEVEL SECURITY;

-- Service role owns all writes (report-location-event, fire-pending-dwells
-- cron). No authenticated-user policy — this table is internal plumbing.
CREATE POLICY pending_dwell_fires_service_role_all
  ON pending_dwell_fires FOR ALL
  USING (auth.role() = 'service_role');
