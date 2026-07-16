# B9z — Phase 5: Evidence Package

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5. Covers Phase 4's implementation, applied per the authorization in `docs/B9Z_PHASE3_TECHNICAL_REVIEW_2026-07-16.md`. Split into two completion states per Phase 3's follow-up review, so it's immediately clear why B9z isn't closed yet: the schema fix is done; the behavior it's supposed to produce hasn't been directly observed.

---

## Summary

`action_rules_user_label_unique` — a UNIQUE constraint on `(user_id, label)` — was live in production with no `enabled = true` scoping and no git-tracked origin, permanently blocking any user from recreating an alert whose generated label matched a prior, already-disabled alert. Fixed by adding `enabled = true` to the constraint's `WHERE` clause and, in the same migration, formally checking the constraint into git for the first time.

---

## Phase 5A — Implementation evidence

**Status: Complete.**

### Files changed

| File | Change |
|---|---|
| `supabase/migrations/20260716000000_scope_action_rules_label_unique.sql` (new) | `DROP INDEX IF EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS` with `enabled = true` added to the `WHERE` clause. First git-tracked record of this constraint. |

### Git diff

```
commit 29105ed
 supabase/migrations/20260716000000_scope_action_rules_label_unique.sql | 23 +++++++++++++++++++++++
 1 file changed, 23 insertions(+)
```
Pushed to `origin/main` (`97b28b1..29105ed`).

### Tests executed — the four items Phase 3 Round 2 required explicitly

1. **Pre-migration verification query returned zero rows** (production, before any change):
   ```sql
   SELECT user_id, label, count(*) FROM action_rules
   WHERE enabled = true GROUP BY user_id, label HAVING count(*) > 1;
   ```
   Result: **0 rows** ("Success. No rows returned"). Confirmed no duplicate active `(user_id, label)` pairs existed under the old constraint.

2. **Original `indexdef` captured verbatim** (production, before any change):
   ```
   ((label IS NOT NULL) AND (label <> ''::text))
   ```
   (full statement: `CREATE UNIQUE INDEX action_rules_user_label_unique ON public.action_rules USING btree (user_id, label) WHERE ((label IS NOT NULL) AND (label <> ''::text))`, columns/table confirmed directly; `WHERE` clause confirmed via targeted `substring()` extraction to avoid UI truncation). Matches the reconstruction used for the rollback statement below exactly.

3. **Migration completed successfully on both environments:**
   - Staging: `DROP INDEX` → `DROP INDEX` (ok), `CREATE UNIQUE INDEX` → `CREATE INDEX` (ok), via `supabase db query --db-url <staging>`.
   - Production: same two statements, run by Wael via the Supabase SQL editor. Result: "Success. No rows returned" (expected for DDL).

4. **Recreated index matches the intended definition on both environments:**
   - Staging: `... WHERE ((label IS NOT NULL) AND (label <> ''::text) AND (enabled = true))`
   - Production: `... WHERE ((label IS NOT NULL) AND (label <> ''::text) AND (enabled = true))`
   Byte-identical on both. Closes the staging/production parity gap for this object (T1a's Objective B, for this specific instance).

### Rollback instructions

If needed, restore the original (pre-fix) constraint:
```sql
DROP INDEX IF EXISTS action_rules_user_label_unique;

CREATE UNIQUE INDEX IF NOT EXISTS action_rules_user_label_unique
  ON action_rules (user_id, label)
  WHERE (label IS NOT NULL) AND (label <> ''::text);
```
This text is the verbatim original `indexdef`, captured directly from production immediately before the fix was applied (Phase 5A test 2, above) — not a reconstruction.

---

## Phase 5B — Behavior verification

**Status: Complete.** All four run 2026-07-16, on staging, via `supabase db query`, using synthetic test data under a real staging user (`ae1f3438-e132-422a-9b0b-7b8819119b46`), label prefix `B9Z-TEST-` for easy identification, cleaned up immediately after. SQL-simulated rather than a live call, isolating the constraint's behavior from STT, Claude, voice orchestration, and networking as uncontrolled variables.

1. **Recreate after disable — PASSED.** Inserted `B9Z-TEST-1` (enabled), disabled it, inserted a second row with the identical label `B9Z-TEST-1` → succeeded (`id: d6259688-...`, `enabled: true`). Previously would have 409'd under the old constraint.
2. **Block active (regression guard) — PASSED.** Inserted `B9Z-TEST-2` (enabled), then attempted a second insert with the identical label while the first was still enabled → correctly rejected: `duplicate key value violates unique constraint "action_rules_user_label_unique"`. True-duplicate prevention among active alerts is intact.
5. **Unrelated labels unaffected — PASSED.** Inserted `B9Z-TEST-5B` (a different label) alongside the other enabled test rows for the same user → succeeded with no cross-contamination.
6. **Update without label change — PASSED.** Updated `B9Z-TEST-1`'s `action_config` (body text) while enabled, label untouched → succeeded, no unintended interaction with the partial index.

All four test rows deleted immediately after (`DELETE ... WHERE label LIKE 'B9Z-TEST-%'`) — confirmed via the delete statement's own `RETURNING`, all 4 rows removed, staging left clean.

---

## Known risks / open items

- **B9y's digit-capture inconsistency** (referenced in the holding list's B9y entry) remains a separate, still-open, not-yet-root-caused issue — unaffected by this fix.
- **Candidate 2** (redesigning the dedup key away from label text) remains a deferred architectural decision, not implemented — logged in `docs/B9Z_PHASE2_CHANGE_PLAN_2026-07-16.md` §1 and the governance doc's "Deferred Architectural Decisions" pattern.
- **Tests were run on staging only, not production.** Both environments carry the identical constraint (Phase 5A test 4), so the same behavior is expected on production — not independently re-verified there, to avoid writing synthetic test data into the real production table.

---

## Closure

Phase 5A and 5B are both complete. B9z is ready for Phase 6 (Technical Review — After Coding).
