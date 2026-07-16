# B9z — Phase 2: Change Planning

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. Builds on `docs/B9Z_PHASE1_PROBLEM_DEFINITION_2026-07-16.md` (Approved, §7). Touches Protected Core (Action Rules — `action_rules` table, all write paths). Evaluated against Phase 1 §6's design principle: a uniqueness constraint should enforce the business rule ("don't create duplicate *active* alerts"), not an implementation artifact ("don't reuse identical *label text*").

---

## 1. Choosing among Phase 1's three candidates

**Candidate 1 (add `enabled = true` scoping) — selected.** This is the direct, minimal fix for exactly what Phase 1 proved: the constraint blocks even disabled rows. Scoping it to `enabled = true` makes its enforced behavior match the business rule precisely — two *active* alerts with the same label are still blocked (true duplicate, correctly prevented); a disabled alert no longer blocks a new one with the same label (not a real duplicate, was being wrongly blocked). Zero new behavior is introduced beyond removing the over-block Phase 1 proved.

**Candidate 2 (redesign the dedup key away from label text) — deferred, not implemented here.** Per the design principle, this candidate addresses a *different*, related concern: label text could coincidentally collide between two semantically different alerts (a false-positive block), or the same alert reworded could bypass dedup entirely (a false-negative — two genuinely-duplicate active alerts both landing). **Neither failure mode has been observed or proven** — Phase 1's evidence is specific to one request repeated with identical phrasing, disabled and reused. Implementing Candidate 2 now would be scope creep beyond what's proven, matching this project's standing evidence discipline (only fix what's demonstrated, e.g. 1c's narrow tool-schema scope, Track B-1e's `trigger_type: 'time'`-only scope). **Logged as a deferred architectural decision** (per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3's "Deferred Architectural Decisions" subsection):
- **Idea:** replace label-text uniqueness with a logical key that doesn't depend on freeform generated text (e.g., a content-hash/fingerprint of the semantic request, or extending the `(user_id, trigger_config->>'datetime')` pattern already used for `trigger_type='time'`).
- **Not approved for this implementation.** Reason: no observed failure of either kind (false-positive collision, false-negative bypass) — Candidate 1 fully resolves the one proven defect.
- **Reconsider if:** a future session finds a real case of two different alerts colliding on label text, or the same alert bypassing dedup via reworded phrasing.

**Candidate 3 (accept current behavior) — rejected.** The permanent-block defect is now proven with direct evidence (Phase 1 §2), not merely suspected. Doing nothing would leave a confirmed defect unaddressed with no justification offered.

---

## 2. Files that will change

| File | Classification | Change | Risk |
|---|---|---|---|
| `supabase/migrations/20260716000000_scope_action_rules_label_unique.sql` (new) | Database (Protected Core — `action_rules`, live production write path for `naavi-voice-server`, `manage-rules`, `naavi-chat`) | Drops the existing untracked `action_rules_user_label_unique` index and recreates it with an added `enabled = true` condition, preserving its existing null/empty-label guard exactly. **This migration is also the first git-tracked record of this constraint's existence at all** — closes the specific T1a instance flagged in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`'s T1a entry, in the same change rather than as a separate migration touching the same object. | **Medium** — Protected Core, live production constraint change, but a pure relaxation (removes over-blocking; does not weaken true-duplicate prevention among active alerts) — see §4's regression analysis for why this narrows rather than expands risk. |

**Proposed migration text (for Phase 3 review — not yet applied):**
```sql
-- B9z (2026-07-16): action_rules_user_label_unique was live in production with
-- no enabled=true scoping and no git-tracked origin — see
-- docs/B9Z_PHASE1_PROBLEM_DEFINITION_2026-07-16.md for full evidence. This
-- migration is the first git-tracked record of this constraint (closes the
-- T1a instance for this object) and scopes it to active rows only.

DROP INDEX IF EXISTS action_rules_user_label_unique;

CREATE UNIQUE INDEX IF NOT EXISTS action_rules_user_label_unique
  ON action_rules (user_id, label)
  WHERE (label IS NOT NULL) AND (label <> ''::text) AND enabled = true;
```

No other files. This is a single-migration, database-only change — no Edge Function, no `naavi-voice-server`, no mobile code touched, since the fix is entirely in the constraint's own definition, not in any caller's write logic.

**Pre-migration verification (added per Phase 3 review — run before the migration, not assumed safe):** the new index is strictly less restrictive than today's (adds `enabled = true`, doesn't remove the existing null/empty guard) — normally safe by construction, but the existing constraint has lived outside migration control for months, so its actual current effect on live data should be confirmed, not assumed. Run this against production before applying the migration:
```sql
SELECT user_id, label, count(*)
FROM action_rules
WHERE enabled = true
GROUP BY user_id, label
HAVING count(*) > 1;
```
**Expected result: 0 rows.** If 0 rows, today's stricter constraint has already guaranteed no duplicate active `(user_id, label)` pairs exist, and the migration is safe. **If any rows are returned, stop** — that means duplicate active alerts already exist under the current constraint (which shouldn't be possible given today's WHERE clause has no `enabled` condition at all, but must be checked directly rather than assumed) — a separate, newly-discovered data issue would need investigating before this migration proceeds.

**Rollback:** recreate the original index exactly as read from `pg_indexes` in Phase 1 §2 (`WHERE (label IS NOT NULL) AND (label <> ''::text)`, no `enabled` condition). Reconstructed from directly-observed fragments (table, columns, and WHERE clause were each independently confirmed via separate queries in Phase 1) rather than a single unbroken read of the full string — **before Phase 4 executes any rollback, re-run the exact original query one more time to capture the complete, verbatim `indexdef` text**, so the rollback statement is copy-pasted evidence, not a reconstruction:
```sql
SELECT indexdef FROM pg_indexes WHERE indexname = 'action_rules_user_label_unique';
-- capture this BEFORE applying the migration, so the rollback is exact
```
```sql
-- Rollback (to be confirmed verbatim against the query above before use):
DROP INDEX IF EXISTS action_rules_user_label_unique;

CREATE UNIQUE INDEX IF NOT EXISTS action_rules_user_label_unique
  ON action_rules (user_id, label)
  WHERE (label IS NOT NULL) AND (label <> ''::text);
```

---

## 3. Deployment note — staging/production parity (relevant because of *why* this bug existed)

Per `CLAUDE.md`'s staging-first rule, this migration goes to staging first. One nuance specific to this fix: because the current constraint was never in a tracked migration, **staging almost certainly does not have it at all** (only production does, added outside the migration pipeline at some point ≥2026-06-14). Running this migration against staging will therefore *add* the constraint fresh, not modify an existing one — expected and correct. Running it against production will *replace* the existing untracked index with the properly-scoped, now-tracked one. Both outcomes converge on the same end state, verified by comparing `pg_indexes` output on both environments post-migration — which directly closes this specific instance of T1a's Objective B (staging/production parity) as a side effect of fixing the bug itself.

---

## 4. Regression impact

| Area | Impact | Why |
|---|---|---|
| Voice commands | **Affected — this is the fix's purpose.** Time-triggered alerts (and any other voice-created alert) with a label matching a prior, now-disabled alert will succeed instead of permanently 409ing. | Direct purpose |
| Geofencing | **Affected, same direction.** Location alerts share the same `action_rules` table and the same constraint — a previously-deleted/disabled location alert with an identical label can now be recreated. No change to `pendingLocation`, `useGeofencing.ts`, or geofence registration itself — only the DB-level dedup behavior. | Same table, same constraint, no location-specific logic touched |
| Gmail integration | Not directly affected — email-trigger alerts share the table/constraint (same relaxation applies), but no Gmail-sync code is touched. | No overlap |
| Calendar integration | Not directly affected — same reasoning as Gmail. | No overlap |
| Reminders | **Not affected.** `SET_REMINDER` writes to the separate `reminders` table, not `action_rules` — confirmed in `naavi-voice-server/src/index.js`'s `SET_REMINDER` case (`POST /rest/v1/reminders`). | Different table entirely |
| SMS / call alerts | **Affected — the fix's direct purpose**, same as Voice commands above. | Direct purpose |
| Onboarding | Not affected. | No overlap |
| Staging build | **Affected in the sense described in §3** — staging gains a constraint it didn't have before. This is a net-positive parity fix, not a regression, but should be explicitly verified (see acceptance criteria below) rather than assumed. | Direct target of the migration |

**Regression guard — true duplicate prevention is preserved:** the fix only *adds* `enabled = true` as a further-narrowing `AND` condition to the existing `WHERE` clause. Two *simultaneously enabled* rows with an identical label remain blocked exactly as before — the constraint's core duplicate-prevention purpose for active alerts is unchanged. The only behavior removed is blocking against *disabled* rows, which is exactly and only what Phase 1 proved was wrong.

---

## 5. Acceptance criteria — what Phase 5 must verify

1. Create an alert, let it fire/disable (or manually disable it), then recreate an alert with the identical generated label → **succeeds** (previously 409'd).
2. Create an alert, then — while it is still enabled — attempt to create a second alert with the identical label → **still blocked** (regression guard: true duplicate prevention intact).
3. `pg_indexes` read on both staging and production shows the identical `indexdef` for `action_rules_user_label_unique`, including the new `enabled = true` condition — confirms parity, not just "it works on one environment."
4. `git log` / `supabase migration list` shows this migration as the tracked origin of the constraint on both environments — closes the T1a instance for this object.
5. An unrelated alert (different label) created around the same time as tests 1-2 is unaffected — no cross-contamination between different labels.
6. **(Added per Phase 3 review)** Updating an existing *enabled* rule without changing its label — e.g. editing its body text, or any other field — still succeeds. Guards against an unintended interaction between the new partial index and any `UPDATE ... action_rules` path (which might momentarily re-evaluate the constraint even when `label` itself is unchanged).

---

## 6. Risk classification — overall

**Medium.** Protected Core, live production schema change, affects every `action_rules` write path across all three callers (`naavi-voice-server`, `manage-rules`, `naavi-chat`). Not High: the change is a pure relaxation with a well-understood, narrow blast radius (removes over-blocking only; true-duplicate prevention among active rows is provably unchanged, per §4's regression guard) — unlike 1c/Track B-1e's confirm-gate fix, this doesn't change *when* or *whether* a write is attempted, only whether a legitimately-non-duplicate write is allowed to succeed.

---

## 7. Next step

Submit to Phase 3 (ChatGPT review) before any migration is applied to either environment. Recommend Phase 3 confirm: (a) Candidate 1 over Candidates 2/3 is the right call given the evidence discipline; (b) the deferred-architecture framing for Candidate 2 is appropriately scoped, not silently dropped; (c) the staging-first deployment note in §3 correctly anticipates staging not having the constraint at all before this migration.

**Phase 3 review: `docs/B9Z_PHASE3_TECHNICAL_REVIEW_2026-07-16.md`** — two rounds, final verdict Approved. Pre-migration verification query, rollback statement, and acceptance criterion 6 (§2, §5 above) were all added in response to Round 1's review; Round 2 approved the result and named explicit Phase 4/5 evidence expectations (see that document).
