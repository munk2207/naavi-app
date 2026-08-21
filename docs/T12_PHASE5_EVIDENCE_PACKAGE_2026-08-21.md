# T12 — Phase 5: Evidence Package

**Work item:** [[T12]] — Voice environment equilibrium
**Date:** 2026-08-21
**Scope:** VOICE ONLY · **Risk:** HIGH · **Protected Core:** Notification routing, API contracts
**Architecture Reference version:** 2026.07.18.8
**Status:** awaiting Wael's review. Phase 6 (external review) does not begin until his own go-ahead.

---

## 1. Summary

T12 set out to answer one question, set by Wael and kept at the head of every phase document:

> **What prevents Voice Staging from being a functional replica of Voice Production at the starting
> equilibrium?**

**Answer, established in Phase 1 and unchanged since:** 26 of the 32 voice-boundary Edge Functions
were already equal. Four obstacles remained, none structural. Equilibrium was achievable.

**It was then reached, and measured.**

```
T12 parity VERIFY — 32 voice-boundary functions, 2026-08-21, 4:37 p.m. EST
  identical : 32
  DIFFERENT : 0
  one-sided : 0
```

Baseline: **`"accepted": {}`** — empty. Not one difference required a written excuse.

**Wael's acceptance point was T8 specifically** — *"after the work, actual measurement must
demonstrate equilibrium. That is the proof T4 was missing."* The measurement above is `parity:verify`,
which downloads deployed source from both Supabase projects and diffs it. It is not the manifest, not
the deploy log, and not this plan having been followed.

---

## 2. Files changed

Commits `685ac9e..1d14a93` on `main`, plus one branch. **2,453 insertions, 2 deletions.**

| File | Class | Change |
|---|---|---|
| `scripts/deploy-edge-function.js` | Tooling | **new**, 243 lines — refuses to deploy uncommitted source |
| `scripts/edge-function-parity-check.js` | Tooling | **new**, 395 lines — two-mode parity check |
| `tests/catalogue/t12-edge-function-parity.ts` | Tests | **new**, 333 lines, 6 tests |
| `tests/runner.ts` | Tests | +2, registration |
| `.githooks/pre-push` | Configuration | +34, third gate |
| `package.json` | Configuration | +3 scripts |
| `docs/T12_accepted_function_differences.json` | Configuration | **new** — the empty baseline |
| `docs/T12_function_parity_manifest.json` | Configuration | **new** — 6 recorded deploys |
| `supabase/functions/global-search/adapters/calendar.ts` | Backend | +13/-2 — see §7.2 |
| `docs/T12_PHASE0/1/1A/2/3×2` | Documentation | governance record |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | Documentation | T12 rewritten, [[B11j]] opened |

**Branch `t12/create-contact-user-id-resolution` (`55f2d7e`, pushed)** — the preserved `create-contact`
fix, deliberately not on `main`. It cannot be both the equilibrium baseline and the thing promoted
to it.

**No Edge Function source was modified by this work item.** Phase 0 forbade it and the boundary held.
The one backend file above is a pre-existing change brought under version control, not authored here.

## 3. Git diff

| Commit | |
|---|---|
| `bb31b24` | T12 opened — Phases 0 and 1 |
| `2da0286` | Phases 1A–4 — the mechanism, and what T0 found |
| `8e24aae` | `calendar.ts` — recording what production already ran |
| `6ff811c` | the empty equilibrium baseline |
| `1d14a93` | holding list; [[B11j]] opened |
| `55f2d7e` | *(branch)* the preserved fix |

---

## 4. Deploys performed, and how each was verified

**Five deploys, all through `deploy-edge-function.js`, all recorded in the manifest.**

| # | Target | Function(s) | Verification performed |
|---|---|---|---|
| D1 | staging | `create-contact` | Both real call shapes re-probed after deploy: **401 / 401, identical to production.** The deliberate meeting-at-`HEAD`. |
| D2 | production | `send-sms`, `send-user-email`, `ingest-ticket` | Boot check — each returned a **structured 400 from its own validation** (`Missing to or body`, `Missing user_id, subject, or body`, `unknown source_channel`), proving the new `_shared/outbound_guard.ts` import resolves and the function runs. |
| D3 | production | `send-push-notification` | Boot check — `400 Missing title or body`. Latency measured, §5. |
| D4 | production | `receive-demo-sms-reply` | **`200` with valid TwiML. It was a `404` before.** The demo STOP path exercised directly. |

**Nothing was sent during any verification.** Every probe used an empty or invalid payload so each
function rejected at its own validation before reaching Twilio, Postmark or Google. The
`create-contact` probe used a syntactically valid but nonexistent `user_id`, which stops one step
short of the Google People API — deliberate, because `create-contact` writes to Google Contacts and
production has no `delete-contact` to undo with.

---

## 5. ⭐ The D3 latency measurement — owed since Phase 1A

**Wael's Phase 1A instruction:** the `send-push-notification` guard is not fully execution-inert on
production, because its block opens with an **unconditional** `user_settings` read
(`supabase/functions/send-push-notification/index.ts:199`) that runs before any `enforced` check.
Phase 2 §3 accepted it as a recorded decision and made Phase 5 measure it. **The Phase 3 reviewer
ruled the decision stands "unless Phase 5 shows material impact."**

**What was measured, and why this is the right thing to measure.** D3's diff is additive with **zero
removals**, and the only added work is (1) that one indexed single-row select and (2) two
`guardDestination()` calls, which are pure functions over an environment variable. **The added
latency therefore IS that select.** Measured against production directly, 25 requests, first 5
discarded as warm-up:

| | |
|---|---|
| min | 42.0 ms |
| **median** | **50.3 ms** |
| p95 | 93.1 ms |
| max | 93.1 ms |

**⚠ This is an UPPER BOUND, and materially so.** It was measured from a laptop in Toronto and
includes the full network round-trip to Supabase's region. **The Edge Function executes inside that
region**, so its real cost is a fraction of this. The true in-function figure was not measured, and is
not claimed.

**Assessment: NOT material. The decision stands.**

Reasoning, stated so it can be disagreed with: every consumer of `send-push-notification` is a
background job — `check-reminders`, `evaluate-rules`, `geofence-health-check`, `report-location-event`
(Phase 2 §6a consumer trace). **No user is waiting on this call.** A push arriving tens of
milliseconds later is not observable, and the upper bound above is already an over-estimate of the
real cost.

**What would change this assessment:** `send-push-notification` moving onto a path where a user is
blocked on the response. It is not on one today.

**The alternative remains rejected for the reason it always was:** moving the query inside the
`enforced` check is a source change, and Phase 0 excludes those. It is recorded as a Deferred
Architectural Decision in the Phase 3 record.

---

## 6. Tests executed

### 6.1 Automated coverage added (Rule 15a)

`tests/catalogue/t12-edge-function-parity.ts`, six tests, registered in `tests/runner.ts`:

| Test | Locks in |
|---|---|
| `t12.create-contact.service-role-body-userid-resolves` | **The T0 gate itself** |
| `t12.boundary.excludes-comment-only-mentions` | 32, not 39 — comment mentions are not call sites |
| `t12.parity-check.declares-itself-not-proof` | Phase 3 mandatory change 2, item 4 |
| `t12.parity-gate.wired-into-pre-push` | The gate is bound, not a command to remember |
| `t12.deploy-wrapper.refuses-uncommitted-source` | The dirty-tree refusal, exercised for real |
| `t12.parity.normalization-ignores-formatting` | Normalization present; `ezbr_sha256` forbidden |

**⚠ The suite has NOT been run end to end.** `npm run test:auto` performs live deletes on the gates
account via `setupSuite`/`teardownSuite` regardless of `--grep`, and running it was not authorized.
**Phase 7 must run it.** The six tests are written and registered; they are not yet green by
observation, and this document does not claim they are.

### 6.2 Mechanism verification — performed, in both directions

Every one of these was run and its output observed:

| Check | Result |
|---|---|
| Deploy wrapper, clean tree, `--dry-run` | **exit 0** |
| Deploy wrapper, uncommitted probe injected | **exit 1, `DEPLOY REFUSED`, offending file named** |
| `parity:check` with no baseline | **exit 2** — fails closed |
| `parity:verify` before the work | 26 identical / 5 different / 1 one-sided |
| **`parity:verify` cross-check against Phase 1's hand measurement** | **exact agreement, by a different method** |
| `parity:verify` after the work (**T8**) | **32 / 0 / 0** |
| Baseline written | `"accepted": {}` |
| Three pre-push gates, three separate pushes | all passed |

**The cross-check is the line that matters most in this table.** Phase 1's numbers came from driving
`supabase functions download` by hand into ad-hoc diffs. The tool derives its own boundary from the
voice server's call sites and hashes normalized source. **They agreed on every slug.** Every prior
parity measurement in this project was confidently wrong; this is the first one reproduced
independently before anything was built on it.

### 6.3 Existing gates

Drift check and schema/code check ran on all three pushes: no new drift; 1,552 column references
across 161 files clean on both environments.

---

## 7. Manual tests required (Phase 7)

1. **`npm run test:auto`, environment confirmed from the banner** — the six new tests have never run.
2. **A live voice call** exercising an SMS-sending alert, to confirm the guard is genuinely inert on
   production. Boot checks prove the functions load; they do not prove a real send still completes.
3. **A live call to the production demo line saying "stop"** — confirm the opt-out row now lands in
   `demo_optouts`. D4 was verified at the HTTP layer only.
4. **A mobile push**, confirming §5's assessment holds in practice.
5. **A mobile regression pass** — mobile calls `send-sms`, `send-push-notification` and
   `ingest-ticket`, and is a regression surface even though it is out of scope as a target.

---

## 8. Rollback

**Every deploy is reversible by redeploying the prior source, and every prior version was downloaded
and retained before being replaced.** No migration ran, no schema changed, no data was written or
deleted by this work item.

| To roll back | Do |
|---|---|
| D2/D3/D4 (production) | Redeploy the pre-T12 source. All four diffs were additive with **zero removals**, so reverting removes only the guard block |
| D1 (staging) | Redeploy `create-contact` from branch `55f2d7e` |
| The tooling | `git revert 2da0286` — it is additive; reverting restores the two-gate pre-push |
| `calendar.ts` (`8e24aae`) | **Do not revert without care.** Production already ran this code before the commit; reverting the commit does not change production, it only de-syncs the repo from it again |

---

## 9. Known risks

1. **The gate cannot see code deployed to both projects but committed to neither.** It compares the
   two *projects* to each other. Two instances of that condition were found by hand today; **nothing
   has swept the remaining functions.** This is the largest known gap and it is not closed.
2. **The manifest is bypassable.** Anyone using the raw Supabase CLI writes nothing to it, and
   `parity:check` would then report "no recorded divergence" over a state it cannot see. This is why
   `parity:check` says so in its own output and why only `parity:verify` may claim equilibrium.
3. **Staging's containment now rests on one thing, not two.** Before T12, production lacked both the
   guard code and the allowlist secret. It now lacks only the secret. That is the guard's own design,
   and `parity:check` asserts the invariant — but the invariant is newly load-bearing.
4. **The six new tests have not been run.** §6.1.
5. **`parity:verify` takes minutes and is manual.** Nothing forces it before a promotion; only
   discipline does. The pre-push gate is the fast tripwire, not this.

---

## 10. Reported, not implemented (Phase 4's No Extra Changes Rule)

Three things were noticed and deliberately not acted on:

**10.1 — `--dry-run` was added to the deploy wrapper, and it was NOT in the Phase 2 file list.**
Declared rather than buried: without it, the dirty-tree refusal could only be asserted by reading the
source, and a guard nothing tests is a guard nobody knows still works. It is a flag on an approved
new file that performs every check and stops before deploying. **If Phase 6 rules it out of bounds, it
should be removed and the test downgraded to a source assertion.**

**10.2 — `parity:check` prints a misleading count.** It reports *"32 of 32 not yet deployed through
the wrapper"* when six functions **have** been. The logic is right — it counts a function as known
only when it has entries for *both* projects, and each of the six has one side — but the sentence
reads as "the wrapper has never been used." **Message-only fix, not made, because Phase 4's
authorization did not cover it.**

**10.3 — The unswept-functions sweep.** Risk 1 above. A one-off comparison of every Edge Function's
deployed source against committed `HEAD` would find any remaining instances. **Not in scope; worth its
own item.**

---

## 11. What T12 found that it did not set out to find

Recorded because none of it came from the plan, and all of it is real:

1. **ADD_CONTACT is broken on production.** Measured: 401 on both real call shapes. Fixed for the
   chat path by promoting branch `55f2d7e`.
2. **Voice ADD_CONTACT is broken on BOTH environments** — the voice server sends no `user_id` at all.
   **No Edge Function deploy can fix it.** Opened as [[B11j]].
3. **The production demo line's verbal STOP wrote nothing** while telling callers *"you won't hear
   from us again."* Fixed by D4.
4. **Code was running on a Supabase project while existing in no commit — twice.**
   `create-contact` on staging, and `calendar.ts` **live on production**. The second was found only
   because the first had taught us to check.

---

## Required output

Approve this evidence package, or state what is missing. Per Governance §3's Phase-Gate Approval
Rule, Phase 6 does not begin until Wael's own separate go-ahead.
