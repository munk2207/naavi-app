# B11x — Phase 8: Merge

**Work item:** [[B11x]] — redundant email classification
**Date:** 2026-08-24
**Implementation:** commit `3ef7e6a`
**Branch:** `main` (per CLAUDE.md — work goes directly on main; no feature branch)

**Status:** ✅ **COMPLETE THROUGH PHASE 8 — on STAGING.**
**Production is NOT deployed** and requires Wael's explicit *"deploy to production."*

---

## 1. The five merge conditions

Each verified, not assumed.

| # | Condition | Status |
|---|---|---|
| 1 | Automated tests pass | ✅ B11x suite **6/6**. Full Gate 1 suite **537 passed, 0 failed**. The 1 error is [[B11z]], proven unrelated by deploy timestamps and reproduced 3/3. Drift check green. |
| 2 | Manual validation passes | ✅ Phase 7 — `sync-gmail` → classifier on a real inbox: **13 messages fired, 0 rows rewritten.** |
| 3 | External review completed | ✅ Phase 3 *Approved with Mandatory Changes* (all three discharged). Phase 6 *Approved*. |
| 4 | Architecture Reference updated **in this same work item** | ✅ **Revision 11**, commit `f06cf1c` — §2's Gmail row corrected, §2d added. Landed before Phase 6, not deferred. |
| 5 | No newer Reference superseded the version recorded at Phase 1A | ✅ Verified by `git log`: only two commits have touched the Reference — `b2b23d7` (B11k's revision 10, the version Phase 1A reviewed against) and `f06cf1c` (this item's revision 11). **No third party bumped it in between**, so no assumption needed re-evaluating. |

Working tree clean. 16 commits on `main` carry this item.

---

## 2. ⭐ An ordering inversion, named rather than glossed

Phase 8's text reads *"A change enters Staging only after: [the five conditions]."*

**This change entered staging before conditions 1 and 2 were met** — deployed 2026-08-24 6:18 PM EST, because Phase 5's Evidence Package and Phase 7's manual validation **cannot be produced without a deployed function**. There is no way to test an Edge Function that has not been deployed somewhere.

**This is not a violation, and it is not unique to this item** — every Edge Function work item must hit it. But the governance text implies an order it cannot actually have for this class of change. **Recorded as an observation about the process, not a defect in this work item.** If it matters, the fix is one clause in Phase 8 distinguishing "deployed to staging for evidence-gathering" from "accepted into staging as done."

---

## 3. What shipped

**Two Edge Functions, on staging only:**

| Function | Version | Deployed (EST) |
|---|---|---|
| `extract-email-actions` | v21 | 2026-08-24, 6:18:32 PM |
| `backfill-email-actions` | v21 | 2026-08-24, 6:18:43 PM |
| `sync-gmail` | v20 | **2026-06-20** — untouched |

**Behaviour:** `extract-email-actions` is now idempotent per `(user_id, gmail_message_id)`. Emails producing no action — pre-filter rejected *or* judged non-actionable by Claude — record a sentinel row with `action_type` NULL. `force: true` bypasses that guard and nothing else, set only by `backfill-email-actions`.

**No client changed.** No mobile file, no voice file, no APK, no AAB, no migration, no schema change, no cron change.

---

## 4. What this work item did NOT fix

Stated so the next session does not assume more was solved than was.

1. **The invocation count is unchanged.** `extract-email-actions` is still called on every sync for every in-window message — roughly 8,700 times/day. Each call is now two indexed DB queries instead of a Claude call. **This removes the cost, not the traffic.**

2. **[[B11y]] — the global fan-out.** The mobile app still triggers a `sync-gmail` for *every active user* every 60 seconds, and the email-search intent does the same. Both pass a parameter `sync-gmail` does not read.

3. **[[B11z]] — Gate 1 is red.** Not caused by this item and not fixable inside it. **It does not block B11x's production promotion** (Rule 15 gates production *AABs*; this ships no AAB) but it does block the next mobile build.

4. **[[B12a]] — test reports don't record their environment.**

5. **Two prompt findings, deliberately excluded:** the banned word "senior" in three production prompts, and `${todayISO}` interpolated inside a cached block at two sites. Both in the Phase 0 document's Related Findings. Each carries the Non-Determinism Rule if opened.

---

## 5. Production promotion — the remaining decision

**Not authorized by this document.** Per CLAUDE.md's staging-first rule, production requires Wael's explicit words.

When authorized, it is two commands and nothing else:

```bash
npx supabase functions deploy extract-email-actions --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx
```

```bash
npx supabase functions deploy backfill-email-actions --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx
```

**Production is where this item's value actually is.** Staging carries 13 messages; production carries the real inbox, and is still re-classifying it on every sync. Everything to date has cost money and saved none.

**The evidence that would confirm it worked** is the one measurement nobody has yet: the Console hourly view for the production key, over 24 hours after promotion. The flat ~1.2M/hour baseline should collapse, leaving only human-driven bars. **That measures the outcome; every test so far measured the mechanism.**

**Rollback** is a `git revert 3ef7e6a` plus two redeploys. No migration to unwind. Sentinel rows are inert after a revert and need not be deleted — but `DELETE FROM email_actions WHERE action_type IS NULL` must **never** run while the fix is live, as it would clear the records the guard depends on and silently reinstate B11x.

---

## 6. Governance record

| Phase | Document | Outcome |
|---|---|---|
| 0 | `B11X_PHASE0_INTENT_2026-08-24.md` | Approved with comments |
| 1 | `B11X_PHASE1_PROBLEM_DEFINITION_2026-08-24.md` | Root cause PROVEN; **revised after 1A** |
| 1A | `B11X_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-08-24.md` | **DOES NOT PASS** → Phase 1 revised → passed |
| 2 | `B11X_PHASE2_CHANGE_PLAN_2026-08-24.md` | Changes required → applied |
| 3 | `B11X_PHASE3_TECHNICAL_REVIEW_2026-08-24.md` | Approved with Mandatory Changes → all 3 discharged |
| 4 | commit `3ef7e6a` | Four files, boundary respected |
| 5 | `B11X_PHASE5_EVIDENCE_PACKAGE_2026-08-24.md` | Held, then accepted |
| 6 | `B11X_PHASE6_TECHNICAL_REVIEW_2026-08-24.md` | Approved |
| 7 | `B11X_PHASE7_TESTING_2026-08-24.md` | End-to-end PASS |
| 8 | this document | Complete on staging |

**Two phases returned a blocking verdict, and both caught something real:** Phase 1A found `sync-gmail` has five callers where Phase 1 counted one; Phase 3's MC3 forced the SQL-level coupling search that a TypeScript grep could not close.

**One error was mine and was caught by implementation, not review:** Phase 2's outcome table missed the `not_actionable` branch. Had it shipped as planned, the fix would have *looked* like it worked — the pre-filter path is 70-80% of volume, so the numbers would have collapsed convincingly while the expensive branch kept billing underneath. That is the same shape as the three cron reductions that preceded this item, and it is the failure this whole process exists to catch.

**One claim I overstated and corrected at source:** the ~$930/month projection, inflated roughly 2× because the measuring window contained this session's own test runs. Corrected to ≈$15/day in Phase 7 §3, and amended in every document that carried it.
