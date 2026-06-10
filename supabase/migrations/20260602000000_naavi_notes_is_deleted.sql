ALTER TABLE naavi_notes ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS naavi_notes_is_deleted_idx ON naavi_notes (user_id, is_deleted);
