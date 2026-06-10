-- Wave 2.5 — Lists ↔ entities is now M:N (Wael 2026-05-13).
--
-- After Wave 2 (1:M — one list per entity) was verified end-to-end,
-- the design pivoted to M:N. Rationale: an alert can naturally carry
-- multiple lists (e.g. a "groceries" list AND an "errands" list when
-- arriving home), and forcing the user to merge them into one list
-- loses semantic distinction. M:N is also a strict relaxation of 1:M
-- — every existing single-list-per-entity row stays valid.
--
-- Change at the DB layer:
--   - DROP the old UNIQUE(entity_type, entity_id) — that was the
--     1:M enforcer.
--   - ADD UNIQUE(list_id, entity_type, entity_id) — same (list,
--     entity) pair can't duplicate (prevents accidental double-attach
--     of the same list), but a different list_id on the same entity
--     is allowed.
--
-- This migration is data-safe: no rows are deleted or rewritten. The
-- only thing changing is which index enforces uniqueness.
--
-- Rollback path: re-create the old UNIQUE(entity_type, entity_id)
-- index. ONLY safe AFTER deduping any rows where the same
-- (entity_type, entity_id) appears more than once (which only
-- becomes possible after this migration + the matching application
-- code lands). Pre-revert check:
--   SELECT entity_type, entity_id, COUNT(*) FROM list_connections
--    GROUP BY entity_type, entity_id HAVING COUNT(*) > 1;
-- Returns 0 rows → safe to re-create the 1:M index.

DROP INDEX IF EXISTS idx_list_connections_one_list_per_entity;

CREATE UNIQUE INDEX IF NOT EXISTS idx_list_connections_unique_pair
  ON list_connections (list_id, entity_type, entity_id);
