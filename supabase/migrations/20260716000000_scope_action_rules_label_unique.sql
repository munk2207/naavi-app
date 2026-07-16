-- B9z (2026-07-16): action_rules_user_label_unique was live in production with
-- no enabled=true scoping and no git-tracked origin — see
-- docs/B9Z_PHASE1_PROBLEM_DEFINITION_2026-07-16.md for full evidence. This
-- migration is the first git-tracked record of this constraint (closes the
-- corresponding project_naavi_architecture_integrity_audit / T1a instance for
-- this object) and scopes it to active rows only.
--
-- Approved: docs/B9Z_PHASE2_CHANGE_PLAN_2026-07-16.md,
-- docs/B9Z_PHASE3_TECHNICAL_REVIEW_2026-07-16.md (2 rounds, Approved).
--
-- No data migration: existing action_rules rows, labels, and enabled flags
-- are untouched. Only the index definition changes.
--
-- Pre-migration verification (run manually before applying, per Phase 3):
--   SELECT user_id, label, count(*) FROM action_rules
--   WHERE enabled = true GROUP BY user_id, label HAVING count(*) > 1;
--   Expected: 0 rows.

DROP INDEX IF EXISTS action_rules_user_label_unique;

CREATE UNIQUE INDEX IF NOT EXISTS action_rules_user_label_unique
  ON action_rules (user_id, label)
  WHERE (label IS NOT NULL) AND (label <> ''::text) AND enabled = true;
