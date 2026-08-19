# Phase 6 — Technical Review (After Coding) — S1 — Voice PIN Authentication

**Date:** 2026-08-19
**Governance version:** v4.0
**Reviewer:** ChatGPT (External Technical Reviewer, governance §1)
**Reviewed:** full diffs of both repositories, `docs/S1_PHASE_5_VOICE_PIN_AUTHENTICATION_2026-08-19.md`
**Status:** Review complete. **Two mandatory changes required before S1 closes.** Awaiting Wael's explicit go-ahead to implement them.

---

## 1. Verdicts, as issued

| Dimension | Verdict |
|---|---|
| Technical Review | **FAIL** |
| Architecture Completeness | **FAIL** |
| Governance Compliance | **PASS** |
| **Overall Recommendation** | **Approved with Mandatory Changes** |

> *"Decision: fix the atomic counter + Shared Core ownership before S1 closes. No need to redesign the rest of S1."*

**What the reviewer confirmed as sound**, so it is not reopened: the original defect is correctly removed — identity resolves first, PIN verification is restricted to one claimed account, and an ambiguous suffix never becomes a multi-account PIN check. The 4→6 digit migration and the reset-on-PIN-change fix were both accepted.

## 2. Mandatory issue 1 — the failure counter is race-prone

**The reviewer's finding:** `bumpPinFailure()` performs read → calculate → PATCH as three separate operations. Two simultaneous failed calls can read the same count and write the same next value, losing failures and potentially preventing the alert threshold from ever being reached.

### 2.1 Reproduced, and worse than described

The finding was verified against staging rather than accepted on inspection.

| Concurrent failures fired | Counter recorded |
|---|---|
| 3 | **2** — one lost |
| 5 | **2** — three lost |

**This is a security bypass, not a lost statistic.** The reviewer wrote "potentially prevent reaching the alert threshold"; the measurement shows five attempts landing as two, which means an attacker issuing attempts **in parallel instead of in sequence** can hold the counter below the threshold indefinitely. The alert never fires, and the entire detection half of Track D is defeated by concurrency alone. No guessing advantage is needed.

### 2.2 It had already happened, unexplained, in live testing

During Wael's own testing (2026-08-19) he made three wrong PIN attempts in one call and the counter advanced by **one** — 3 → 4. Phase 5 §2 records that I could not reconstruct why and declined to guess. This is the cause: the bumps are fire-and-forget (`bumpPinFailure(...).catch(() => {})`), so a second attempt's read can begin before the first attempt's write lands, even within a single sequential call.

**The observation preceded the explanation by several hours.** It was in front of me, in the data, and I filed it as unresolved rather than pulling on it. The reviewer found the cause from the code alone.

## 3. Mandatory issue 2 — architecture leakage

**The reviewer's finding:** the voice server now owns failure-window calculation, counter mutation, and security-alert triggering. That is business and security logic living in an entry point, and the architecture reference states that entry points translate — they do not implement business logic.

Also flagged: `receive-sms-reply` handling `BLOCK` is acceptable **as command routing**, but it currently performs the security-state mutation itself rather than delegating it.

**Accepted in full.** Phase 5 §"Architecture questions" asked the reviewer directly whether the counting logic sat at the right layer and whether `receive-sms-reply` should carry a security command. Both answers came back as I should have determined myself before shipping: the code was placed where the existing plumbing was, which is a convenience argument, not an architectural one.

## 4. Proposed remedy — one design fixes both

The two issues share a solution: the operation becomes atomic *because* it moves behind Shared Core.

**4.1 — A Postgres function makes the increment atomic.** The window decision and the increment collapse into a single statement, so no read-modify-write window exists:

```sql
UPDATE user_settings
   SET voice_pin_failed_count = CASE
         WHEN voice_pin_failed_at IS NULL
           OR voice_pin_failed_at < now() - p_window THEN 1
         ELSE voice_pin_failed_count + 1 END,
       voice_pin_failed_at = now()
 WHERE user_id = p_user_id
RETURNING voice_pin_failed_count, phone;
```

One statement, one row lock. It also returns the resulting count, so "did this attempt cross the threshold" is answered by the same atomic operation that produced it — removing the second race hiding inside the alert decision.

**4.2 — `manage-voice-pin` becomes the sole owner of voice-PIN security state.** It is already Shared Core and already owns the PIN itself, so extending it is the "refactor over layer" answer (AI Coding Discipline #19) rather than adding a new function. New operations: `record_failure`, `clear_failures`, `set_blocked`.

**4.3 — Both entry points become translators.**

| Caller | Before | After |
|---|---|---|
| Voice server | reads, computes the window, PATCHes, decides to alert, sends the SMS | reports "a PIN attempt failed for this account" |
| `receive-sms-reply` | mutates `voice_unregistered_blocked` directly | routes the BLOCK command |

The alert send moves into Shared Core too, since the reviewer named alert *triggering* as part of the leaked logic and the trigger decision now comes back from the atomic call.

**4.4 — A regression test that fails on the current code.** The concurrency reproduction in §2.1 becomes a test: fire N simultaneous failures, assert the counter equals N. It fails today, which is the property a regression test for this defect must have.

## 5. Architecture Drift Rule

**Outcome 2 — diverges because of an intentional, approved architectural change made during this work item.** Not a FAIL by itself, but per governance the Architecture Reference update becomes a **hard precondition for merge at Phase 8**, not an optional follow-up.

What must be recorded there: ownership of voice-PIN security state moves from the voice server into Shared Core, and the voice server's relationship to it becomes translation only.

## 6. Invalidated planning assumption — reviewer's assessment pending re-review

Phase 2 assumed, and the Phase 3 reviewer required, that resetting on successful PIN authentication was sufficient. Live testing disproved it. Recorded in Phase 5 §7 and fixed. The reviewer accepted the fix as sound and did not identify further "the owner has addressed this" signals needing to clear the counter.

## 7. ⚠️ This document does not authorize anything

Per the Phase-Gate Approval Rule (governance §3), a reviewer's verdict is **one input Wael weighs** and never authorization to proceed. Specifically:

- **This review does not authorize the remedial work in §4.** That needs Wael's own explicit go-ahead.
- **It does not authorize Phase 7, Phase 8, or a merge.**
- **It does not authorize any promotion to production.** S1 remains staging-only.

"Approved with Mandatory Changes" means exactly that the changes in §2 and §3 are required before S1 can close. It is not a conditional pass to be self-certified once I believe I have addressed them — the corrected implementation returns for Wael's decision, and for re-review if he wants one.

---

**Phase 6 complete. Two mandatory changes identified, both accepted, neither yet implemented. Awaiting Wael's go-ahead.**
