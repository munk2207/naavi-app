-- knowledge_fragments.updated_at — the column production's own code writes but
-- production's schema does not have. (2026-08-21, found during T7 triage.)
--
-- ── This is not a promotion. It is a live production defect. ────────────────
-- `ingest-note` has two write paths:
--
--     if (existingId)  UPDATE ... updated_at: new Date().toISOString()
--     else             INSERT payload            (no updated_at)
--
-- The INSERT path works on production. The UPDATE path does not: PostgREST
-- rejects the entire statement with 42703 (column does not exist), so the write
-- is lost. Confirmed directly, not inferred —
--   PRODUCTION  select updated_at -> HTTP 400, code 42703
--   STAGING     select updated_at -> HTTP 200
--
-- ── What that costs a user ─────────────────────────────────────────────────
-- The UPDATE path is the dedup/merge path: it runs when Naavi ALREADY knows
-- something and the user corrects or refines it. "Actually her name is Sarah,
-- not Sara." Naavi finds the existing fragment, tries to update it, the write
-- fails, and the OLD VALUE STAYS. The failure is logged
-- (`[ingest-note] Write failed`) but nothing reaches the user, so Naavi
-- continues to hold — and repeat — a fact the user believes they corrected.
--
-- That is a truth-at-user-layer failure, which CLAUDE.md Rule 18 and
-- project_naavi_truth_at_user_layer treat as the most severe class here.
--
-- Live since production's ingest-note v60 deployed 2026-08-13; the line has
-- been in the repo since 2026-06-15.
--
-- ── Safety ─────────────────────────────────────────────────────────────────
-- Additive, with a default, so existing rows are backfilled to now() rather
-- than left NULL. Matches staging exactly:
--   timestamp with time zone, default now(), NOT NULL.
-- Staging has no trigger maintaining it — the application sets it explicitly —
-- so none is added here either.
--
-- Idempotent; safe to run twice.

ALTER TABLE knowledge_fragments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN knowledge_fragments.updated_at IS
  'Set explicitly by ingest-note when merging into an existing fragment. Added '
  'to production 2026-08-21: the column existed only on staging, so production''s '
  'own deployed code was writing a column it did not have, and every memory '
  'UPDATE failed with 42703 while INSERTs succeeded. No trigger maintains this — '
  'the application owns it, matching staging.';
