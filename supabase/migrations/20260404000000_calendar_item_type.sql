-- Add item_type column to calendar_events so tasks and events can be distinguished.
-- Existing rows (all events) default to 'event'.
-- Google Tasks synced going forward get item_type = 'task'.

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'event';

CREATE INDEX IF NOT EXISTS idx_calendar_events_item_type
  ON calendar_events (user_id, item_type);
