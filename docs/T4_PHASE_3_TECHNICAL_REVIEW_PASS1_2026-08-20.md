# Phase 3 — Technical Review (Before Coding) — T4 Pass 1 — Definition Parity

**Date:** 2026-08-20
**Governance version:** v4.0
**Reviewer:** ChatGPT (External Technical Reviewer, governance §1)
**Plan reviewed:** `docs/T4_PHASE_2_PASS1_DEFINITION_DIFFERENCES_2026-08-20.md`
**Status:** Mandatory change incorporated below. **Awaiting Wael's explicit go-ahead for the Phase 3 → 4 transition.**

---

## 1. Decision

**APPROVED WITH MANDATORY CHANGE.**

Approved as proposed: Bucket A tightened to production's definitions; Bucket C's ten legitimate defaults replicated and the real-phone-number default removed; the migration applied through the normal path to **both** environments, definitionally no-op on production.

## 2. Mandatory change — T5 becomes a dependency of T4 completion

> *"Leaving the 12 differences indefinitely while calling T4 complete would contradict T4's objective… T4 cannot ultimately claim parity until T5 either (1) tightens production to the staging definition, or (2) establishes — with evidence — that a particular difference is an intentional environment difference."*

**Accepted, and it closes a hole I had left open.**

Pass 1 excluded Bucket B for a sound reason — loosening staging to reach parity would be worse than the drift — and tracked it as T5. But "tracked" is not "resolved", and a work item that closes while declaring twelve known differences acceptable has quietly redefined its own success criterion.

**The distinction the reviewer is drawing:** *deferred* and *accepted* are different states, and only one of them is honest here. Bucket B is deferred.

**The change:** T4's completion criteria now require T5 to be resolved — each of the 12 either tightened in production or shown by evidence to be an intentional difference. **T4 cannot be closed as "parity achieved" while T5 is open.**

**Why this matters beyond bookkeeping:** every artefact in this project that decayed did so by being technically recorded and practically forgotten — the architecture document stale for four months, the version line unbumped through three edits, `people` printing a missing-table warning in every test run for months. A tracked-but-unblocking item is the same shape. Making it block is what distinguishes this from the pattern that created T4.

## 3. Technical decisions approved as proposed

| Question asked | Reviewer's ruling |
|---|---|
| Is the no-op-on-production claim sound? | **Sufficiently grounded for Phase 4**, because the definitions were measured directly rather than inferred. **Phase 6 must re-fingerprint both environments to prove it** — the claim is not accepted on assertion |
| Should guards run before any `ALTER`? | **Yes — all guards execute first**, as proposed |
| Is a count enough, or should rows be listed? | **A count is sufficient.** If non-zero, stop and investigate the rows **separately** — do not put row-level data into the migration |
| Is splitting Pass 1 from Pass 2 sound? | **Acceptable.** Nothing in Pass 1 depends on the missing tables, indexes, constraints, RLS policies, secrets or crons |

**On the re-fingerprint requirement:** worth noting that this is the reviewer declining to accept my measurement as its own proof. I raised that concern in the review prompt — that verifying my measurement with my measurement is circular — and the answer is to re-measure at Phase 6, after the change, as independent evidence.

## 4. ⭐ Implementation Boundaries Confirmed

**Authorized file — this one, and no other:**

`supabase/migrations/20260820000000_t4_pass1_definition_parity.sql`

**Authorized changes:**

- 19 × `SET NOT NULL`, each preceded by a preflight NULL guard
- 10 × `SET DEFAULT` (Bucket C legitimate defaults)
- 1 × `DROP DEFAULT` on `user_settings.morning_call_phone` (the hardcoded real phone number)
- **Zero Bucket B changes**
- Applied through the normal migration path to **both** environments

**NOT authorized:** application code, Edge Functions, voice server, mobile, RLS policies, cron jobs, indexes, constraints, secrets, or any unrelated database change. All of those are Pass 2 or outside T4 entirely.

## 5. Carried into Phase 4

1. Guards **all** execute before any `ALTER`, in one transaction.
2. A guard reports a **count** and aborts. Never row data, never automatic deletion or assignment.
3. The migration goes to **both** environments — staging changes, production restates.
4. Bucket B is **absent** from the migration.
5. **Phase 6 re-fingerprints both environments** to prove the no-op claim, rather than restating it.

## 6. What this review does not authorize

Not authorization to begin Phase 4 — that needs Wael's own explicit go-ahead (Phase-Gate Approval Rule).
