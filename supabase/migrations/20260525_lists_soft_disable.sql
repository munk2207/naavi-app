-- ============================================================================
-- Lists soft-disable lifecycle (2026-05-25, B4z parity)
--
-- Adds `enabled` column to `lists` so lists follow the same soft-disable
-- lifecycle as `action_rules`:
--   enabled=true  → active (normal)
--   enabled=false → disabled (grayed out in UI, can be reactivated)
--
-- "Delete list" now sets enabled=false instead of hard-deleting. The Drive
-- Doc and list_connections rows are preserved so re-enable restores
-- everything. Hard deletion is only triggered from the "Delete permanently"
-- button on an already-disabled list.
-- ============================================================================

ALTER TABLE lists ADD COLUMN enabled BOOLEAN DEFAULT true NOT NULL;

-- Fast lookup: "show me all disabled lists for this user"
CREATE INDEX idx_lists_user_enabled ON lists (user_id, enabled);

COMMENT ON COLUMN lists.enabled IS
  'Soft-disable flag. false = user deleted the list; shows grayed out in UI. '
  'Drive Doc and list_connections are preserved so Reactivate restores them.';
