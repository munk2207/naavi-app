-- Extend action_rules.trigger_type to accept 'location' and create the
-- user_places table that caches resolved named places per user.
--
-- Session 20, Phase 1 of the location trigger XL build.
-- trigger_config shape (stored JSONB):
--   {
--     "place_name":       "Costco",               // display name
--     "place_alias":      "costco-merivale",      // links to user_places.alias
--     "direction":        "arrive" | "leave" | "inside",
--     "dwell_minutes":    number,                 // default 2; ignored for 'leave'
--     "expiry":           "YYYY-MM-DD",           // optional; auto-disable after
--   }

-- 1. Extend trigger_type CHECK constraint
ALTER TABLE action_rules DROP CONSTRAINT action_rules_trigger_type_check;

ALTER TABLE action_rules ADD CONSTRAINT action_rules_trigger_type_check
  CHECK (trigger_type IN ('email', 'time', 'calendar', 'weather', 'contact_silence', 'location'));

-- 2. user_places — resolved named places per user (home, cottage, Costco, etc.)
CREATE TABLE user_places (
  id            uuid             DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid             NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alias         text             NOT NULL,                   -- lowercase key, e.g. "costco-merivale"
  place_name    text             NOT NULL,                   -- human-facing, e.g. "Costco (Merivale Road)"
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  radius_meters int              NOT NULL DEFAULT 100,       -- geofence radius in meters
  created_at    timestamptz      DEFAULT now() NOT NULL,
  last_used_at  timestamptz      DEFAULT now() NOT NULL,
  UNIQUE (user_id, alias)
);

CREATE INDEX idx_user_places_user ON user_places (user_id);

ALTER TABLE user_places ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own places"
  ON user_places FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access places"
  ON user_places FOR ALL
  USING (auth.role() = 'service_role');
