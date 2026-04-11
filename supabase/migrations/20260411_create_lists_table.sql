-- ============================================================================
-- Voice-Managed Lists
--
-- Maps list names to Google Drive file IDs so Robert can manage
-- shopping lists, to-do lists, etc. by voice. Each list is a Google Doc.
-- ============================================================================

CREATE TABLE lists (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  category        text        NOT NULL DEFAULT 'other' CHECK (category IN ('shopping', 'health', 'tasks', 'personal', 'other')),
  drive_file_id   text        NOT NULL,
  web_view_link   text,
  created_at      timestamptz DEFAULT now() NOT NULL,
  updated_at      timestamptz DEFAULT now() NOT NULL
);

-- Fast lookup by user + name
CREATE INDEX idx_lists_user_name ON lists (user_id, name);

-- Row Level Security
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own lists"
  ON lists FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access lists"
  ON lists FOR ALL
  USING (auth.role() = 'service_role');
