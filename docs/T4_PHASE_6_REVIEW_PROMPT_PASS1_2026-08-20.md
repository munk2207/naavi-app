# Phase 6 Review Prompt — T4 Pass 1 — Definition Parity

Paste everything below the line into ChatGPT. No attachments needed.

---

You are the External Technical Reviewer for the MyNaavi project, performing a **Phase 6 — Technical Review (After Coding)** under Release Gate Workflow v4.0.

You reviewed this work at Phase 3 and Phase 5. **You required that Phase 6 re-fingerprint both environments independently rather than accept the no-op assertion.** That requirement is partially met and partially blocked — §4 explains precisely which, and why.

## 1. What was implemented

One file, exactly as the Phase 3 boundary authorized:

`supabase/migrations/20260820000000_t4_pass1_definition_parity.sql`

| | Authorized | Present |
|---|---|---|
| `SET NOT NULL` | 19 | **19** |
| `SET DEFAULT` | 13 | **13** |
| `DROP DEFAULT` | 1 | **1** |
| Bucket B changes | 0 | **0** |
| Preflight NULL guards, all before any `ALTER` | required | **yes, one loop** |

**Boundary audit performed on the file itself**, not from memory: zero occurrences of `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `UPDATE`, `INSERT`, `CREATE POLICY`, `DROP POLICY`, `CREATE INDEX`, or anything touching `cron.`.

*(A naive grep initially counted 20 `SET NOT NULL`. The twentieth is the word appearing in an explanatory comment. Reported because the check was run and the discrepancy chased rather than rounded away.)*

## 2. Independent re-fingerprint — staging

Staging was re-measured with a **fresh** run of the read-only catalogue query, not by re-reading the Phase 5 output:

| | Before migration | After |
|---|---|---|
| Column definition differences vs production | **42** | **12** |

- All 12 verified programmatically to be **Bucket B** — production nullable, staging `NOT NULL`. No Bucket A or C item survives.
- `user_settings.morning_call_phone` default: **`null`**, matching production. The hardcoded live phone number is gone.
- Staging migration history now ends: `20260820000000`, `20260819010000`, `20260819000000`.

## 3. Regression evidence

**Gate 1, full run against STAGING** (environment confirmed from the runner's banner):

```
Total: 512   Passed: 507   Failed: 0   Errored: 1   Timed out: 1   Skipped: 3
```

**Zero failures.** Tightening `NOT NULL` on 19 columns — six of them `user_id` — broke no test.

**The two non-passing cases, examined:**

- **`multiuser.send-sms.no-auth-no-body-rejects`** — the test treats any `200`-with-data as "silently bound to a user". It now receives `200 {"blocked":true,"reason":"destination not in OUTBOUND_ALLOWLIST"}` because T2's outbound guard intercepts before the auth check. **No user was bound** — verified by reading the response. The assertion is sound; its assumption predates the guard. Fails on staging only, since the guard is inert on production. Logged separately, not fixed here.
- **`b10j.negative-control-text-wife-work`** — timed out at 30 s, no schema dependency. **Recorded as uninvestigated**, not as harmless.

## 4. ✅ Your Phase 6 requirement is now FULLY met — production applied and proven

When this prompt was first drafted, production application was outstanding and the no-op claim rested on the author checking his own plan against his own measurement. **That has been resolved.**

**What happened, in order:**

**4.1 — A blanket `db push` was refused, and the refusal mattered.** Production was found to be **18 migrations behind**, not one. A push would have applied all eighteen, including `20260721000000_sync_active_email_alerts_cron` — which called `cron.schedule()` unconditionally with a hardcoded **staging** URL and an unfilled `<SERVICE_ROLE_KEY>`. **Production would have called staging every five minutes, forever, with no valid auth.**

That file already carried a header warning: *"STAGING ONLY… must not be applied to production."* Correct, and useless — `db push` does not read comments. **Fixed by making the file refuse rather than warn**: it is now a no-op unless the operator sets an explicit session flag, and it unschedules any same-named job before creating one. Verified by executing it against staging exactly as `db push` would, with no opt-in: cron count 11 before, 11 after, named job neither duplicated nor removed.

**4.2 — The other 17 were classified against production's own fingerprint.** 13 were found to be **already satisfied** — every object they create already exists in production. Those were recorded as applied *without being run*. Two are S1's, deliberately withheld pending S1's own gates. One (`user_settings_twilio_from_number`) adds a column production genuinely lacks and awaits a decision. One is this migration.

**4.3 — This migration was applied to production**, and its version recorded. Production's applied count: 67 → 81 (the 14 recordings) → 82.

**4.4 — ⭐ The no-op is now PROVEN, not asserted.** The 30 columns this migration touches were compared against how they looked in production **before** the change, using the fingerprint taken earlier that evening:

```
Success. No rows returned
```

**Zero differences.** Production is byte-identical either side. That is the independent evidence you required — production's own catalogue, not the author's reasoning.

**Migration history is no longer divergent** for anything this work item covers.

## 5. Questions for this review

- **The completion gate is now closed** (§4). Does that change your verdict from what it would have been?
- **Was refusing the blanket push the right call**, or should the 18-migration backlog have been handled differently?
- **Is the pre-write verification (§4) sufficient grounds to authorize the production application**, or should something further be measured first?
- **Is the boundary audit adequate?** It checked statement types present and absent in the file. Is there a category of unauthorized change it would miss?
- **`multiuser.send-sms.no-auth-no-body-rejects`** — the guard now masks a real safety assertion on staging. Fix the test to understand `blocked:true`, change the guard's status code, or leave it? Note the guard is a T2 artefact and out of T4's boundary.
- **Bucket B / T5** — you made it a blocking dependency of *T4 completion*. Confirming: it does **not** block Pass 1 closing, only the overall item?

## 6. Required output

Four verdicts: **Technical Review**, **Architecture Completeness**, **Governance Compliance**, and **Overall Recommendation** (Approved / Approved with Mandatory Changes / Rejected). No numeric scores.

**Architecture Completeness specifically:** this work changes no code, no ownership and no boundary — it changes what the migration files *claim about production*. Assess whether that is an architecture change requiring an Architecture Reference update, or a documentation-of-existing-state change that does not.
