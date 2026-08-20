# Phase 5 — Evidence — T4 Pass 1 — Definition Parity

**Date:** 2026-08-20
**Governance version:** v4.0
**Phase 3 boundary:** `docs/T4_PHASE_3_TECHNICAL_REVIEW_PASS1_2026-08-20.md`
**Status:** Evidence complete. **Awaiting Wael's go-ahead for Phase 5 → 6.**

---

## 1. What shipped

One file, as authorized: `supabase/migrations/20260820000000_t4_pass1_definition_parity.sql`

| Change | Count |
|---|---|
| Preflight NULL guards (before any `ALTER`) | 19 |
| `SET NOT NULL` — Bucket A | 19 |
| `SET DEFAULT` — Bucket C, plus 3 accompanying Bucket A columns | 13 |
| `DROP DEFAULT` — debris | 1 |
| **Bucket B changes** | **0** |

Applied to **staging**. **Not yet applied to production** — see §6.

## 2. ⭐ The result, measured rather than asserted

Staging was re-fingerprinted with the same read-only query after the migration:

| | Before | After |
|---|---|---|
| Column definition differences vs production | **42** | **12** |

**30 resolved. The remaining 12 are all Bucket B**, verified individually — every one shows `prod nullable=YES, staging=NO`, the deliberate exclusion, in the same direction. No Bucket A or C item survives.

`user_settings.morning_call_phone` default: **now `null`**, matching production.

**This is the proof the Phase 3 reviewer asked for in principle** — the claim is not "the migration should have worked" but a second measurement showing it did.

## 3. Verification performed BEFORE the migration was written

Both were done first, deliberately, because either could have made the migration wrong or dangerous.

**3.1 — Every statement checked against production's own catalogue.** All 32 confirmed to restate a definition production already holds — 19 `NOT NULL` states and 13 default values, each read from the production fingerprint rather than chosen. `morning_call_phone` confirmed to have no default there, so `DROP DEFAULT` is a no-op.

This is what makes the no-op claim **definition equivalence** rather than `IF NOT EXISTS`, per the Phase 0 clarification that existence is not equivalence.

**3.2 — Orphan rows counted before writing, not discovered at run time.**

All 19 columns queried on staging: **zero NULLs**, across tables holding 0–145 rows. So the migration could not abort, and no data decision was pending.

**The guards were still written**, because "it happens to be clean today" is not the same as "it is safe to run" — they exist for production, for any future environment, and for re-application.

## 4. Regression evidence

**Gate 1, full run against STAGING** (environment confirmed from the runner banner):

```
Total: 512   Passed: 507 ✓   Failed: 0 ✗   Errored: 1 ⨯   Timed out: 1 ⧗   Skipped: 3 ○
```

**Zero failures.** Tightening `NOT NULL` on 19 columns — six of them `user_id` — broke no test. That is the substantive regression result: no code path in the suite was relying on inserting rows without an owner.

### 4.1 The two non-passing cases, neither caused by this change

**`multiuser.send-sms.no-auth-no-body-rejects` — errored.** The test sends an unauthenticated request expecting rejection. It receives `200` with `{"success":false,"blocked":true,"reason":"destination not in OUTBOUND_ALLOWLIST"}` and treats any 200-with-data as "it silently bound to some user — SAFETY VIOLATION".

**It did not bind to any user.** T2's outbound guard intercepted before the auth check. The test's assertion is sound; its assumption — that a 200 implies a user was resolved — is no longer true on an environment where the guard runs.

**This fails only on staging**, because the guard is inert on production where `OUTBOUND_ALLOWLIST` is unset. Logged separately (§7); not fixed here, as the authorized boundary is one migration file.

**`b10j.negative-control-text-wife-work` — timed out at 30 s.** No schema dependency; consistent with flakiness. Not investigated, and stated as uninvestigated rather than dismissed.

## 5. Boundary compliance

| Authorized | Done |
|---|---|
| `20260820000000_t4_pass1_definition_parity.sql` only | ✅ single file |
| 19 `SET NOT NULL` with preflight guards | ✅ guards as one loop before any `ALTER` |
| 10 legitimate defaults | ✅ plus 3 accompanying Bucket A columns, per the plan |
| Remove `morning_call_phone` default | ✅ |
| Zero Bucket B | ✅ absent from the file |
| Both environments via the normal path | ⚠️ staging applied; production pending (§6) |

**Not touched, as required:** application code, Edge Functions, voice server, mobile, RLS policies, cron jobs, indexes, constraints, secrets.

## 6. ⚠️ Production application is outstanding — and it is the point

The migration exists to make the **files** describe production. Until it is applied there, the migration history diverges: staging carries a migration production has never seen — the exact defect the Phase 2 review corrected the plan to avoid.

**It is verified safe:** every statement restates a definition production already holds (§3.1), and the guards abort rather than mangle if anything unexpected appears.

**It has not been applied**, because production is a live system and that is Wael's decision, not something to fold into an implementation phase.

**Until it is applied, T4 Pass 1 is not complete.**

## 7. Findings surfaced, not fixed

1. **T2's outbound guard breaks a multi-user safety test on staging** (§4.1). The test's 200-implies-bound assumption predates the guard. Needs the test taught about `blocked:true`, or the guard returning a different status. **Not a real safety hole** — verified by reading the response.
2. **Bucket B — 12 columns where production is looser than staging.** Tracked as **T5**, which **blocks T4 completion**. Deferred, not accepted.
3. **`b10j` timeout** — uninvestigated.

## 8. What this phase does not authorize

Phase 6 review next, and per the Phase 3 ruling it must **re-fingerprint both environments** to prove the no-op claim independently rather than accept §3.1. Production application, Phase 7 and Phase 8 each need Wael's own word.
