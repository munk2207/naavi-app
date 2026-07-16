# B9z — Phase 3: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3. Reviewer: ChatGPT (External Technical Reviewer), via Wael. Subject: `docs/B9Z_PHASE2_CHANGE_PLAN_2026-07-16.md` (Candidate 1 — scope `action_rules_user_label_unique` to `enabled = true`, formally adopt it into git). Required because the change touches Protected Core (`action_rules`, live production write path for `naavi-voice-server`, `manage-rules`, `naavi-chat`) and was classified Medium Risk.

Two review rounds occurred before Phase 4 (implementation) begins.

---

## Round 1 — review of the original Phase 2 draft

**Governance assessment:**

| Area | Assessment |
|---|---|
| Phase 1 alignment | ✅ Excellent |
| Candidate evaluation | ✅ Excellent |
| Scope control | ✅ Excellent |
| Regression planning | ✅ Excellent |
| Deployment planning | ✅ Excellent |
| Hidden assumptions | One — existing active data should be verified before migration, not assumed clean |

**Technical concern (the reason for conditional, not outright, approval):** the migration is conceptually a pure relaxation (`unique(user_id, label)` → `unique(user_id, label) WHERE enabled=true`), but the *existing* constraint has lived outside migration control for months — its actual current effect on live data should be proven, not assumed, before `DROP`ping it. Recommended a pre-migration query: `SELECT user_id, label, count(*) FROM action_rules WHERE enabled = true GROUP BY user_id, label HAVING count(*) > 1;`, expecting 0 rows. "I suspect this query will return zero rows... but I would rather prove it than assume it."

**Governance suggestion:** add a rollback statement — recreate the original index definition exactly.

**Acceptance criteria addition:** verify that updating an existing enabled rule without changing its label still succeeds — guards against an unintended `UPDATE` path interaction with the new partial index.

**Verdict: Conditionally Approved.** "I agree that Candidate 1 is the correct implementation based on the evidence gathered in Phase 1. The document appropriately limits itself to relaxing the uniqueness constraint so it enforces the intended business rule... while deliberately deferring broader architectural redesign until there is evidence it is needed."

---

## Response — Phase 2 revised

All three adopted directly into `docs/B9Z_PHASE2_CHANGE_PLAN_2026-07-16.md`:

- **Pre-migration verification** added to §2 as a mandatory step, with the expected result (0 rows) and an explicit stop-condition if it isn't.
- **Rollback statement** added, with one honesty caveat: the rollback SQL is a reconstruction from fragments independently confirmed in Phase 1 (not a single unbroken read of the full `indexdef`), so a re-capture step was added — re-run the original `pg_indexes` query immediately before the migration and use *that* verbatim text for the rollback, not the reconstruction alone.
- **Acceptance criterion 6** added: updating an existing enabled rule without changing its label still succeeds.

---

## Round 2 — final review

**Governance assessment:** all ✅ (Phase 1 alignment, candidate evaluation, migration planning, rollback planning, regression planning, governance compliance; no hidden assumptions).

**One observation (implementation evidence expectations for Phase 4/5, not a Phase 2 deficiency):** when Phase 4 is written up, the evidence package should explicitly show, not just assert: (1) the pre-migration verification query returned zero rows; (2) the original `indexdef` was captured verbatim before the migration ran; (3) the migration completed successfully; (4) the recreated index's `indexdef` matches the intended definition (`enabled = true` present, null/empty guard preserved). Logged here so Phase 4/5 execution is held to this explicitly, not left to be inferred.

**Verdict:** **Approved.** "The revisions fully address the concerns from the previous review. The document now combines a narrowly scoped technical solution with strong migration governance: it validates production data before making schema changes, defines an evidence-based rollback procedure, expands regression coverage to include UPDATE behavior, and continues to defer broader architectural redesign until there is evidence that it is needed. This Phase 2 plan is ready to proceed to Phase 3/implementation without further changes."

---

## Implementation boundaries confirmed

- **Authorized:** `supabase/migrations/20260716000000_scope_action_rules_label_unique.sql` (new file) — exactly the migration text in Phase 2 §2, preceded by the pre-migration verification query (must return 0 rows before proceeding) and preceded by a fresh capture of the original `indexdef` for the rollback record.
- **No additional files approved.** No Edge Function, no `naavi-voice-server`, no mobile code — the fix is entirely in the constraint's own definition.
- **No opportunistic refactoring approved.** Nothing else in `action_rules`'s schema, RLS policies, or other indexes is in scope.
- **No architectural changes approved.** Candidate 2 (redesigning the dedup key away from label text) remains explicitly deferred, not implemented here.
- **No data migration is authorized** (added per this follow-up review — makes explicit what was already implied by the migration's scope). Existing `action_rules` rows are untouched: no label regeneration, no `enabled` flag changes, no rewriting of historical records. The approved change replaces only the index definition itself — it does not read, write, or modify any row.
- **Deployment order:** staging first (per `CLAUDE.md`'s staging-first rule), then production, per Phase 2 §3's parity note — staging is expected to gain the constraint fresh; production replaces the existing untracked index.
- **Phase 5 evidence package must include** all four items named in Round 2's observation above (pre-migration query result, captured original `indexdef`, migration completion, post-migration `indexdef` match) — not optional, per that review.

---

## Round 3 — final confirmation

**Recommendation (optional, adopted above):** state explicitly that no data migration is authorized — existing rows, labels, and `enabled` flags are untouched; only the index definition itself is replaced. Added to "Implementation boundaries confirmed" above.

**Governance observation:** compared to F19/Track B, B9z's process was proportionally lighter — Phase 1 identified one well-isolated problem, Phase 2 selected one narrowly scoped fix, Phase 3 needed only two substantive review rounds. Read as a sign the issue was well isolated to begin with, not as the process being applied inconsistently — the governance overhead matched the actual complexity of the problem.

**Verdict:** **Approved.** "This Phase 3 document provides a complete and auditable authorization for implementation. It clearly records the transition from conditional approval to final approval, captures the rationale for each revision, defines precise implementation boundaries, and establishes concrete evidence requirements for Phase 5 verification."

---

## Outcome

**APPROVE.** Phase 4 (implementation) is cleared to begin: run the pre-migration verification query and capture the original `indexdef`, then apply the migration to staging, verify, then production, verify, per the acceptance criteria in Phase 2 §5.
