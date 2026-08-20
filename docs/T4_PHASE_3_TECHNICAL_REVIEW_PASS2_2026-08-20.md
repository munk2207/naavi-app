# Phase 3 — Technical Review (Before Coding) — T4 Pass 2 — The Missing Objects

**Date:** 2026-08-20
**Governance version:** v4.0
**Reviewer:** ChatGPT (External Technical Reviewer, governance §1)
**Plan reviewed:** `docs/T4_PHASE_2_PASS2_MISSING_OBJECTS_2026-08-20.md`
**Status:** Both mandatory changes incorporated. **2a is cleared to proceed on Wael's go-ahead. 2b and 2c are gated — see §4.**

---

## 1. Decision

**APPROVED WITH MANDATORY CHANGES.** Two, and a sequencing ruling.

## 2. Mandatory change 1 — do not delete the 5 unused production secrets

> *"Do not delete the 5 unused production secrets in T4; defer cleanup."*

**Accepted.** `GOOGLE_CLOUD_STT_KEY`, `POSTMARK_INBOUND_ADDRESS`, `TWILIO_WHATSAPP_TEMPLATE_REMINDER_SID`, `TWILIO_WHATSAPP_TEMPLATE_TASK_SID` and `distance Matrix API` are **left exactly as they are in production.**

Pass 2 does two things with them: **does not replicate them to staging**, and **does not remove them from production**.

**Why this is right, and why my proposal was not.** I had proposed deleting them as tidying. But T4 is a *parity* work item, and deleting a live production secret is a production change with a non-zero chance of breaking something the grep did not see — the exact blind spot §6 of the review prompt asked about. **The evidence that a secret is unused is good enough to justify not copying it. It is not good enough to justify deleting it.** Those are different standards, and I had applied the weaker one to the riskier action.

Cleanup is deferred to its own item.

## 3. Mandatory change 2 — verify RLS intent before 2b

> *"Before implementing 2b, verify the intended RLS policies for the four tables, especially confirming the two zero-policy tables are intentionally server-only."*

**Accepted, and it gates 2b entirely.** No table is created until this is done.

**What must be established:**

| Table | Question |
|---|---|
| `people` | Do its 4 policies express the intended access, or are they historical? |
| `conversations` | Same, for its 1 policy |
| `pending_disambig` | **Is RLS-on-with-no-policy deliberate?** It reads as server-only. Confirm rather than assume |
| `waitlist_signups` | Same |

**Why the zero-policy pair is the hard case.** Reproducing the *definition* is trivial. Reproducing the *intent* is the requirement, and the two failure directions are asymmetric: too permissive leaks data; too restrictive returns **empty results rather than an error**, which is the harder failure to notice.

**Evidence, not inference.** Whether any client code reads these tables through an authenticated session — as opposed to service-role only — is checkable in the codebase, and that check is Phase 4's first task for 2b.

## 4. ⭐ Sequencing ruling

> *"2a can proceed now. 2b waits for RLS verification. 2c can proceed after credential/cron verification."*

| Part | State |
|---|---|
| **2a** — 10 columns | **CLEARED.** Proceeds on Wael's go-ahead |
| **2b** — 4 tables | **GATED** on the RLS verification in §3 |
| **2c** — 6 secrets, 2 crons | **GATED** on credential decisions and cron verification |

**Note on 2a's ordering question**, which I had asked the reviewer to settle: I proposed doing 2a first partly because `first_call_completed_at` unblocks B11f's testing — a different work item, and a motive I have an interest in. The reviewer cleared 2a first regardless, which resolves the question without needing it argued: 2a is additive, nullable, and independent of both gated parts.

## 5. Implementation boundary for 2a

**Authorized:** one migration file, `supabase/migrations/20260820000001_t4_pass2a_missing_columns.sql`

- 10 × `ADD COLUMN IF NOT EXISTS`, definitions taken from production's catalogue
- Applied through the normal migration path to **both** environments; no-op on production
- **Nothing else.** No table creation, no RLS, no secret, no cron, no code

**NOT authorized in 2a:** anything belonging to 2b or 2c; any deletion of a production secret; any change to the `pg_net` version.

**Phase 6 must prove the production no-op by measurement**, as it did for Pass 1 — not restate it.

## 6. Carried forward

1. The 5 debris secrets stay in production, untouched, and are not copied to staging. **Cleanup is a separate item.**
2. 2b begins with an RLS intent check, evidence-based.
3. 2c begins with Wael's per-vendor decision on separate credentials, and cron verification covering schedule, target function, URL, auth mechanism and expected behaviour — not URL alone.
4. `pg_net` version difference remains out of scope.

## 7. What this review does not authorize

Not authorization to begin Phase 4 on 2a — that needs Wael's own explicit go-ahead.
