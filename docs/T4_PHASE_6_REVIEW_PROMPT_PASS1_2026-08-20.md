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

## 4. ⚠️ Your Phase 6 requirement is HALF met, and this is the honest position

You required both environments re-fingerprinted independently. **Staging is done (§2). Production is not**, for a reason that is procedural rather than technical:

**The migration has not been applied to production.** Applying it is a change to a live system, which under this project's rules requires the owner's explicit authorization for production specifically — and that authorization has not been given. He approved "Phase 6"; he has not approved a production change, and those were deliberately not treated as the same thing.

**Consequently:**

- The **no-op claim remains unproven by measurement.** It rests on §3.1 of the Phase 5 evidence: every one of the 32 statements was checked against production's own catalogue fingerprint before the migration was written, and each restates a definition production already holds. **That is strong, but it is still the author checking his own plan against his own measurement** — which is precisely the circularity you moved to eliminate.
- **The migration history is currently divergent**: staging carries `20260820000000`, production does not. That is the exact defect the Phase 2 review corrected this plan to avoid, and it persists until production receives the migration.

**The proof you asked for is available and specified**, and needs only the owner's authorization:

1. Apply to production via `supabase db push` — **not** raw SQL in the editor, because the point is the recorded migration history.
2. Re-fingerprint production.
3. Compare against the **pre-application** production fingerprint already on file.
4. **If they are identical, the no-op is proven by production's own catalogue either side of the change** — no assertion involved.

## 5. Questions for this review

- **Given production application is outstanding, what is the correct verdict?** The implementation is complete and within boundary; a stated completion gate is open. Is that *Approved with Mandatory Changes* (the change being production application), or something else?
- **Is the pre-write verification (§4) sufficient grounds to authorize the production application**, or should something further be measured first?
- **Is the boundary audit adequate?** It checked statement types present and absent in the file. Is there a category of unauthorized change it would miss?
- **`multiuser.send-sms.no-auth-no-body-rejects`** — the guard now masks a real safety assertion on staging. Fix the test to understand `blocked:true`, change the guard's status code, or leave it? Note the guard is a T2 artefact and out of T4's boundary.
- **Bucket B / T5** — you made it a blocking dependency of *T4 completion*. Confirming: it does **not** block Pass 1 closing, only the overall item?

## 6. Required output

Four verdicts: **Technical Review**, **Architecture Completeness**, **Governance Compliance**, and **Overall Recommendation** (Approved / Approved with Mandatory Changes / Rejected). No numeric scores.

**Architecture Completeness specifically:** this work changes no code, no ownership and no boundary — it changes what the migration files *claim about production*. Assess whether that is an architecture change requiring an Architecture Reference update, or a documentation-of-existing-state change that does not.
