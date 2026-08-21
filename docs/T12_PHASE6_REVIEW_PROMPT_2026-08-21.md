# T12 — Phase 6: Technical Review Prompt (After Coding)

**For:** External Technical Reviewer (ChatGPT)
**From:** Claude Code (Implementation Engineer)
**Date:** 2026-08-21
**Risk:** HIGH · **Protected Core:** Notification routing, API contracts
**Governance:** MyNaavi AI Development Governance v4.1

---

## ⭐ Response format required (§1, Reviewer Response Format Rule)

**Verdict first. Then only mandatory changes, blockers, or material risks.** Do not restate this
document or repeat evidence already given. Length is warranted only to justify a rejection or a
required change.

**Four independent verdicts are required** (Phase 6): Technical Review PASS/FAIL · **Architecture
Completeness PASS/FAIL** · Governance Compliance PASS/FAIL · **Overall Recommendation** (Approved /
Approved with Mandatory Changes / Rejected). No numeric scores.

Close with the **§14 Claude Implementation Handoff**.

---

## 1. What was approved, and what was built

**Phase 0–3 approved by Wael.** Phase 3 verdict was *Approved with Mandatory Changes*; both changes
were applied and confirmed by the reviewer. Phase 5 approved, **with Phase 7 explicitly still
mandatory.**

**The controlling question, set by the Product Owner:** *what prevents Voice Staging from being a
functional replica of Voice Production at the starting equilibrium?*

**Result — the acceptance point Wael named:**

```
parity:verify, 2026-08-21 4:37 p.m. EST
  identical : 32     DIFFERENT : 0     one-sided : 0
```

Baseline: `"accepted": {}` — empty.

**Built:** a deploy wrapper that refuses to deploy uncommitted source; a two-mode parity check
(`parity:check` fast tripwire on pre-push, `parity:verify` authoritative); a pre-push gate; an empty
baseline; six auto-tester tests. **No Edge Function source was modified** — Phase 0 forbade it.

**Deployed:** `create-contact` → staging; `send-sms`, `send-user-email`, `ingest-ticket`,
`send-push-notification`, `receive-demo-sms-reply` → production. All five verified individually;
nothing was sent during verification.

**Full evidence:** `docs/T12_PHASE5_EVIDENCE_PACKAGE_2026-08-21.md`. Commits `685ac9e..1d14a93`,
plus branch `t12/create-contact-user-id-resolution` (`55f2d7e`).

---

## 2. ⛔ Three things that departed from the approved plan — please rule on each

These are declared here rather than left to be discovered in the diff. Phase 3's Implementation
Boundaries Confirmed authorized **only** the files, tooling and deployments in the Phase 2 plan, with
no additional files and no opportunistic refactoring.

### 2.1 — A `--dry-run` flag was added to the deploy wrapper. It was not in the plan.

**What:** a flag that performs every check (including the dirty-tree refusal) and stops before
deploying or touching the manifest.

**Why:** without it, the dirty-tree refusal — the mechanism addressing the root cause — could only be
asserted by reading the source. A guard nothing exercises is a guard nobody knows still works. The
auto-tester now injects an uncommitted file and asserts the wrapper refuses.

**Argument against:** it is behaviour that was not reviewed at Phase 3, on a file that was approved
only in the shape the plan described.

**If you rule it out of bounds:** remove the flag and downgrade
`t12.deploy-wrapper.refuses-uncommitted-source` to a source-text assertion. That is a real loss of
coverage, and it is the correct consequence if the boundary means what it says.

### 2.2 — An out-of-scope file was committed on Wael's direct instruction.

`supabase/functions/global-search/adapters/calendar.ts` (+13/−2, commit `8e24aae`) was **not** in the
Phase 2 file list. Wael instructed *"commit the calendar.ts change too"* after being told what it
was.

**Material fact:** the file was already **deployed to production and existed in no commit**. Verified
before committing — production's deployed copy matched the working tree, not `HEAD`. **The commit
changes no behaviour anywhere;** it records what production was already running.

**This is the second instance of that condition found in one day** (the first: `create-contact` on
staging, 37 lines, no commit). It is the reason the deploy wrapper exists.

**Question for you:** is Product-Owner instruction sufficient authorization to modify a file outside
Phase 3's confirmed boundaries, or should this have required a Phase 0 amendment first?

### 2.3 — The plan's step order was changed during implementation.

**Phase 2 ordered:** T3 capture the baseline → then deploys → then T8.
**Implemented:** deploys → then baseline → then T8.

**Why:** baselining first would have recorded all six differences as *accepted deliberate
differences*. They were not deliberate; they were the thing being fixed. A baseline written then
would have been a list of unexplained entries asserting that the divergence was intended.

**Governance Phase 6 asks this be classified.** I submit it as an **Invalidated Planning Assumption**
— Phase 2 assumed a baseline could be captured before the work without asserting the pre-work state
was acceptable. Not an implementation error, and not a scope cut.

---

## 3. What I most want challenged

**3.1 — Is the equilibrium claim actually supported?** The claim rests on `parity:verify` downloading
deployed source from both projects and diffing normalized content. Its numbers independently
reproduced Phase 1's hand measurement exactly, by a different method, before anything was built on
it. **Is that sufficient, given this project has produced three confidently wrong parity comparisons
before?** (`ezbr_sha256` — 20 flagged, 15 byte-identical; raw-hashed bodies; truncated cron commands.)

**3.2 — The largest known gap, stated plainly.** The gate compares the two **projects** to each other.
**Code deployed to both while committed to neither passes it clean.** Two instances of exactly that
condition were found by hand today. The wrapper prevents new ones; nothing has swept for existing
ones. **Should T12 close with that open, or is a sweep a completion condition?**

**3.3 — Is "not material" the right call on the D3 latency?** An unconditional `user_settings` read
now runs on every production push send. Measured upper bound: median 50.3 ms — but measured from a
laptop including network RTT, while the function runs in-region, so the real cost is lower and was
**not** measured. My reasoning for "not material" is that every consumer is a background job and no
user is blocked. **Is an unmeasured true cost acceptable, or must the in-function figure be obtained?**

**3.4 — Six tests are registered and have never been run.** `test:auto` performs live deletes on the
gates account regardless of `--grep`, and running it was not authorized. Phase 5 states this rather
than implying green. **Is registering unrun tests acceptable at Phase 6, given Phase 7 will run
them — or does Rule 15a require green before this phase can pass?**

**3.5 — Architecture Drift Rule.** T12 makes two statements in Architecture Reference §0c/§0d false:
*"Nothing compares deployed Edge Function code between projects"* and the drift check's stated
blind spot. Per the rule this is **outcome 2** — divergence caused by an intentional, approved change
— which makes the Reference update a **hard precondition for Phase 8 merge**. Phase 1A also recorded
two pre-existing §0b inaccuracies (a stale line reference, and an overstated claim that the guard
covers *every* send path). **Confirm outcome 2 and that these are Phase 8 obligations.**

---

## 4. Findings T12 produced that were not its objective

Relevant because they affect whether T12 should close, not merely how it is judged:

1. **ADD_CONTACT is broken on production** — 401 on both real call shapes. Fixed for the chat path by
   promoting branch `55f2d7e`, which is queued as the first change through the new lifecycle.
2. **Voice ADD_CONTACT is broken on BOTH environments** — the voice server sends no `user_id` at all.
   No Edge Function deploy can fix it. Opened as [[B11j]].
3. **The production demo line's verbal STOP wrote nothing** while telling callers they were opted
   out. Fixed by D4 — the endpoint was a 404 and a 404 resolves rather than throws.

---

## 5. Required output

Per §13, evaluate in order: Scope Compliance · Governance Compliance · Architecture Compliance ·
Technical Correctness · Evidence Sufficiency.

Then the four Phase 6 verdicts, and the §14 handoff.

Your approval is **not** authorization to proceed to Phase 7. Per Governance §3's Phase-Gate Approval
Rule, only Wael's own separate word starts the next phase.
