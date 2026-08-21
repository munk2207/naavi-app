-- T5 (2026-08-21) — the 12 columns where PRODUCTION is looser than staging.
--
-- T4 Pass 1 replicated production's stricter definitions onto staging. These 12
-- are the reverse case, and a mechanical parity script would have got them
-- exactly wrong: reaching parity by "making staging match production" would
-- mean REMOVING these constraints from staging. The correct direction is to
-- tighten production, which is what this does.
--
-- Every column here is a timestamp or a boolean carrying a default — values
-- that should never be NULL. Production could hold a row with a NULL
-- created_at or a NULL is_unread, which the application code reading those
-- fields does not expect.
--
-- ── Evidence gathered before writing this, all read-only ───────────────────
--   1. NULL rows on production, counted per column:  0 of 12. Nothing to
--      backfill, so no ALTER can fail on existing data.
--   2. Defaults on production: all 12 have one (now() / true / false). So an
--      INSERT that omits the column still succeeds after this runs.
--   3. Code writing NULL: none — and the structural proof is stronger than a
--      grep. Staging ALREADY enforces all 12 and runs the same Edge Functions
--      against the same code. If anything wrote NULL here, staging would
--      already be failing.
--
-- Largest table is calendar_events at 530 rows, so the ACCESS EXCLUSIVE lock
-- SET NOT NULL takes is held for milliseconds.
--
-- Governance deviation, recorded not hidden: T5's holding-list entry specifies
-- Full Phase 0-8. Wael's direct instruction, 2026-08-21, was to apply it with
-- the evidence above and record the deviation — the same treatment B10y had.
--
-- Idempotent: SET NOT NULL on a column that is already NOT NULL is a no-op.

ALTER TABLE contacts             ALTER COLUMN created_at  SET NOT NULL;
ALTER TABLE naavi_notes          ALTER COLUMN created_at  SET NOT NULL;
ALTER TABLE user_tokens          ALTER COLUMN updated_at  SET NOT NULL;

ALTER TABLE gmail_messages       ALTER COLUMN is_tier1     SET NOT NULL;
ALTER TABLE gmail_messages       ALTER COLUMN is_unread    SET NOT NULL;
ALTER TABLE gmail_messages       ALTER COLUMN is_important SET NOT NULL;
ALTER TABLE gmail_messages       ALTER COLUMN updated_at   SET NOT NULL;

ALTER TABLE calendar_events      ALTER COLUMN updated_at   SET NOT NULL;
ALTER TABLE calendar_events      ALTER COLUMN is_priority  SET NOT NULL;

ALTER TABLE push_subscriptions   ALTER COLUMN created_at   SET NOT NULL;

ALTER TABLE knowledge_fragments  ALTER COLUMN created_at   SET NOT NULL;
ALTER TABLE knowledge_fragments  ALTER COLUMN is_priority  SET NOT NULL;
