# Staging cron jobs pointed at production — Phase 2 Change Plan

Governance: AI_DEVELOPMENT_GOVERNANCE.md v2.1, Phase 2 (Change Planning).
Touches Protected Core ("Background scheduling") — Phase 3 (pre-code) and Phase 6 (post-code) review are mandatory, not optional.

---

## 1. Problem (Phase 1 — evidence)

Discovered 2026-07-01 while diagnosing why F2b's staging demo reminders never fired. Direct query against staging Postgres (`xugvnfudofuskxoknhve`):

```sql
SELECT jobid, jobname, command FROM cron.job;
```

Every one of staging's 9 active cron jobs calls `net.http_post` against **production's** URL (`https://hhgyppbxgmjrwdpdubcx.supabase.co/...`) with a production-scoped JWT, not staging's own (`https://xugvnfudofuskxoknhve.supabase.co/...`):

| jobid | jobname | schedule |
|---|---|---|
| 2 | check-reminders-every-minute | `* * * * *` |
| 3 | evaluate-rules-every-minute | `* * * * *` |
| 4 | trigger-morning-call-every-minute | `* * * * *` |
| 6 | sync-gmail-every-30-minutes | `*/30 * * * *` |
| 7 | sync-gmail-every-60-minutes | `0 * * * *` |
| 8 | fire-pending-dwells-every-minute | `* * * * *` |
| 9 | analyze-new-tickets-every-minute | `* * * * *` |
| 10 | reanalyze-on-reply-every-minute | `* * * * *` |
| 11 | geofence-health-check-daily | `0 12 * * *` |
| 12 | check-ticket-replies-every-minute | `* * * * *` |

**Root cause:** every `..._cron.sql` migration that creates one of these jobs (e.g. `20260407000001_evaluate_rules_cron.sql`) hardcodes production's URL literally in the SQL. These are shared migration files, applied to every environment identically — when applied to staging, the job still points at production, because the SQL text itself never changes per environment. Production's own equivalent jobs are presumably correct (self-referencing), since the same migration applied *there* naturally points at itself.

**Practical effect on staging:** none of staging's own reminders/alerts/dwells/gmail-sync/etc. have ever actually fired via cron, because nothing on staging's scheduler calls staging's own functions. Every minute, staging's scheduler has instead been making redundant calls into production's functions this whole time (since the migration's date, 2026-04-07) — production has plausibly been getting these functions invoked twice per minute: once from its own correct cron, once from staging's mispointed one. **Not yet confirmed against production data** — no production read credential available, flagging as a fact worth Wael independently confirming if he wants certainty, not something this plan verifies.

**Observed side effect:** noted in passing, not part of this fix — `sync-gmail` has two active jobs (`every-30-minutes` and `every-60-minutes`) simultaneously. Looks like a leftover duplicate from an earlier config change. Out of scope for this plan; flagging for a separate look.

## 2. Fix (Phase 2 — the actual change)

Directly update the 9 `cron.job` rows on **staging only** — replace the URL (`hhgyppbxgmjrwdpdubcx` → `xugvnfudofuskxoknhve`) and the Authorization Bearer token (production-scoped JWT → staging's own service-role key) in each job's `command` column, via a raw Postgres connection (same pattern already used successfully this session for `demo_optouts` and the `20260621` migration-tracking fix — bypasses the shared-migration-file problem entirely since this is a staging-only data correction, not a new migration).

**Why not a new shared migration file:** a migration that hardcodes "the correct URL" has the exact same structural flaw as the original bug — it would need a *different* hardcoded value depending on which environment it's applied to. There's no per-environment templating in this migration system. A shared migration doing `cron.alter_job(...)` would either be a no-op on production (if production's already correct) or introduce fresh breakage if that assumption is ever wrong. Direct, staging-scoped correction is the safer move, same reasoning already applied and approved for the earlier migration-tracking fix tonight.

**No files change.** This is a live data correction on staging's `cron.job` table only — same class of operation as the `demo_optouts` migration apply and the `20260621` tracking-row insert done earlier this session, both already reviewed favorably.

**Follow-up documented, not executed now:** a permanent fix for the underlying hardcoding (e.g., resolving each project's own URL dynamically via a Postgres setting or Vault secret instead of a literal string in the migration) is a legitimate architectural improvement but is explicitly out of scope for tonight — flagged as a backlog item, not blocking this fix.

## 3. Risk classification

**Medium.** Touches Protected Core (Background scheduling), but the change is staging-only, purely corrective (fixing 9 rows to point where they were always supposed to), reversible (can be pointed back), and does not touch production's database, cron table, or any deployed code.

## 4. Regression impact

| Area | Impact | Why |
|---|---|---|
| Voice commands | Not affected | No voice-server code touched. |
| Geofencing | **AFFECTED (staging only)** | `fire-pending-dwells-every-minute` starts actually calling staging's own function — staging geofence dwell-fires will begin working for the first time, not regress anything working today. |
| Gmail integration | **AFFECTED (staging only)** | Same — `sync-gmail` jobs start hitting staging's own function. |
| Calendar integration | Not affected | No calendar-specific cron among these 9. |
| Reminders | **AFFECTED (staging only) — this is the fix F2b needs** | `evaluate-rules` and `check-reminders` start correctly firing against staging's own `action_rules`/`reminders` data, including F2b's demo reminders. |
| SMS / call alerts | **AFFECTED (staging only)** | Downstream of the reminders/evaluate-rules fix — staging SMS sends should start actually happening when triggered. |
| Onboarding | Not affected | No onboarding-related cron among these 9. |
| Staging build | This *is* the staging build fix | N/A |
| **Production** | **Not touched by this change.** Only staging's `cron.job` rows are modified. If production has in fact been double-invoked by staging's misconfigured cron (unconfirmed), that stops happening once staging's cron is corrected — a side-effect improvement, not something this plan needs to actively fix on production's side. |

## 5. Rollback

Each of the 9 rows can be reverted to its prior `command` value (captured before the fix, included in the evidence package) via the same direct-connection method. No schema change, no data loss, no dependency on any other change.

## 6. Next step

Send this document to ChatGPT for Phase 3 review before executing. No SQL runs until that review returns and Wael approves.
