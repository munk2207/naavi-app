# B12k — Phase 6: Technical Review (After Coding)

**Work item:** [[B12k]] — Naavi is too slow to answer on voice.
**Date:** 2026-08-29
**Covers:** Stages 1 and 2 only. Stage 3's four parts are conditionally authorized by Phase 3 §4 and are **not implemented**.
**Status:** **APPROVED by Wael, 2026-08-29 — Phase 6 → 7 authorized.** Approved after two returns: a false claim that Node freezes `process.env` at process start, and the superseded paragraph left sitting three lines below its own replacement, still calling a justification "false" after that finding had been withdrawn.

**What this document is.** Governance §3 puts the four Phase 6 verdicts with the reviewer, not with Claude. This is the submission: the diff, the architecture and regression analysis, and the findings that emerged during implementation. **§8's verdicts are blank and are the reviewer's to issue.**

---

## 1. What is under review

| Commit | Repository | Contents |
|---|---|---|
| `e2dcb0f` | `naavi-voice-server`, branch `staging` | Stages 1 + 2 — `src/index.js`, **+80 / −8** |
| `49de2c6` | `naavi-app`, branch `main` | Four stale `voice-pin` tests — **separately authorized by Wael**, not part of Stages 1-2 |

**Deployed and live on staging.** Verified by the new markers appearing in the running container's logs, not by the deployment dashboard.

---

## 2. Architecture Completeness — the explicit questions

**Governance requires each to be named rather than inferred from the diff.**

| Question | Answer |
|---|---|
| Did it increase duplication? | **No** |
| Did it reduce duplication? | **No** |
| Did it bypass Shared Core? | **No.** No Edge Function was touched |
| Did it introduce another independent implementation? | **No.** One new local helper, `_b12kTimed` — six lines, used at six call sites. Rule 19 (refactor over layer) is satisfied: the alternative was six copies of inline timing code |
| Did it violate entry-point responsibilities? | **No.** Instrumentation is not business logic. The voice server still translates rather than decides |
| Did it change an API contract? | **No.** No request or response shape changed |
| Did it change a capability's ownership? | **No** |
| Did it expand what counts as Protected Core? | **No** |

---

## 3. Architecture Drift Rule

**Does the implementation still match what the Architecture Reference claims?**

**For what was implemented: Outcome 1 — matches.** Stages 1-2 add observability and a staging-only switch to the voice server. The Reference describes the voice server as an entry point owning the turn pipeline; that is unchanged.

**But two known omissions in the Reference remain open, and the reviewer should rule rather than have this document decide.** Phase 1A found `search-knowledge` has no §2 row despite three callers, and that `global-search`'s knowledge adapter mirrors it without appearing in §5a's *Full* Duplication Inventory. Entries were drafted, put to Wael, approved, written in as revision `2026.07.18.16`, and **then reverted on his instruction**. No reason was given and none is inferred here.

**Both omissions predate B12k and neither misled this work** — `search-knowledge` was found by direct search. **Whether that is Outcome 1 or Outcome 3 is the reviewer's call.** This document's position: the *implemented change* does not diverge from the Reference; the Reference is incomplete in an adjacent area, and Wael has already seen the proposed fix and declined it.

---

## 4. ⭐ Invalidated Planning Assumption Rule

**Governance requires a Phase 2 plan that could not be carried out as written to be recorded as an invalidated planning assumption — distinct from an implementation error or a scope cut.**

**One qualifies.**

**What Phase 3 assumed.** §5 recommended reading `B12K_FORCE_MODEL` inline at the model-selection line rather than hoisting it to the module-level constants block, on this reasoning:

> *"an inline read takes effect on the next turn, while a hoisted constant is fixed at boot and requires a service restart"*

**What execution found: the expected convenience did not materialise under Railway's environment-update behaviour**, because the running container was not restarted or replaced when the variable changed.

> **⚠ Corrected 2026-08-29 on Wael's challenge.** An earlier version of this section said *"that distinction does not exist — Node fixes `process.env` at process start, so both forms read the same frozen snapshot."* **That is wrong about Node.** `process.env` is a mutable object; code can write to it at runtime, and an inline read **would** observe such a change where a module-level constant captured at startup could not. **The inline read's advantage is real in Node terms** — it simply had nothing to act on here.

**What was actually observed, and it is a platform behaviour rather than a language rule:**

| Action | Did the container restart? |
|---|---|
| `variable set B12K_FORCE_MODEL=haiku` | **Yes** — new deployment at 03:41:56 |
| `variable set B12K_FORCE_MODEL=banana` | **Yes** — new deployment at 03:44:13 |
| `variable delete B12K_FORCE_MODEL` | **No** — deployment timestamp unchanged, and the old value is still live in the process (§7.1) |

**So Railway replaces the container on a set and does not on a delete.** Since nothing inside this codebase writes to `process.env` at runtime, the inline read gained nothing over hoisting **in this deployment model** — the value only ever changes when Railway hands the process a new environment, which means a new process.

**Why Option A still holds.** It was recommended for four reasons; this was the weakest and the only one that did not survive contact. The three that carried it — it is the pattern the outbound guard already uses, it is the narrowest change of the three options, and **it is the only option that does not also reach the staging demo line** — are unaffected. The implementation is correct; one of its four justifications did not hold.

**Classification: a planning assumption invalidated by the deployment environment** — not an implementation error and not a scope cut. Phase 3 predicted a runtime convenience that Railway's behaviour did not provide. It cost nothing here, because the option was right for three other reasons. It would have cost something had the choice turned on this one.

---

## 5. Regression risk

| Evidence | Result |
|---|---|
| Gate 2, against **STAGING** | **54 passed, 0 failed, 0 errored, 4 skipped** |
| Live call to `+1 343 504 1572` | **PASS** — Wael, 2026-08-29 |
| Live turns exercised via `/test/ask` | Four, all behaved correctly |
| `node --check` | Pass |
| Removal audit | All 8 deleted lines replaced by instrumented equivalents |

**The live call is the strongest evidence here**, and it is the only one with a real phone on the other end of a Protected Core file whose own classification says a mistake is *"heard live by a real caller with no undo."*

**The four skips are environmental**, not failures — they need production Google contacts and say so explicitly.

---

## 6. Isolation

**One file, one repository, one branch.**

| Boundary | Verified |
|---|---|
| Production Supabase | Untouched |
| Production voice server | Untouched — still on `main` at `5dff3d5` |
| Mobile | No file changed |
| Edge Functions | None changed |
| `B12K_FORCE_MODEL` on production | **Verified absent** at every step |
| `B12K_FORCE_MODEL` on the staging demo service | **Verified absent** at every step |

**One exception, and it is a live loose end — see §7.1.**

---

## 7. Findings during implementation and testing

### 7.1 The staging container holds a variable that no longer exists in config

`railway variable delete B12K_FORCE_MODEL` removed it from the stored config **without restarting the container**. The running process still has `B12K_FORCE_MODEL="banana"`, confirmed by a live turn on 2026-08-29 logging *"not recognised … using normal selection"*.

**Behaviourally harmless** — check 6 established that path falls back to normal selection, and the same turn selected the correct model. **But the config and the running process disagree, and only the config is visible to someone looking.** Same class as code deployed and never committed.

**It clears on the next deploy.** Not fixed here because a redeploy purely to tidy it was not authorized.

### 7.2 ⭐ The classifier routed the identical question to two different models

**Observed 2026-08-29.** The string *"What is on my calendar this week?"*, same account, same code:

| Run | Model selected |
|---|---|
| Earlier | `claude-haiku-4-5-20251001` |
| Later | `claude-sonnet-4-6` |

**No code changed between them.** This is the Non-Determinism Rule's own subject, seen live — B10j established that identical phrasing can route differently across calls at temperature 0.

**Consequence for Stage 2, and it is significant.** The controlled comparison assumes that forcing the model is the only variable. **It is not — which model a turn *would* have used is itself unstable.** So the comparison must force both arms explicitly rather than compare a forced run against an unforced one, and the 3-trial minimum applies to routing as well as to output.

**This was not known when Phase 3 was written.** It does not invalidate Stage 2; it constrains how Stage 2 must be run.

### 7.3 Measurements — the point of the change

**The four serial context calls, four samples:** 712, 668, 430, 511 ms. **Phase 3's gate B1 requires ≥750 ms to justify restructuring them. None reaches it.** If this holds across the trial set, **Stage 3b is ruled out by a threshold fixed before any data existed.**

**The model, first controlled comparison:** Sonnet **11 602 ms** (`end_turn`) against Haiku **5 925 ms** (`max_tokens` — truncated mid-sentence). **Faster and worse. The quality veto failed on the first comparison, and a latency-only gate would have passed it.**

**Knowledge search:** 935 ms to 3 525 ms on the same account minutes apart, returning zero fragments every time — the production stall's variance reproduced in miniature.

**Event-loop lag:** silent throughout, on a healthy service with no stall present.

---

## 8. Verdicts — to be issued by the reviewer

Per Governance §3, four independent verdicts. Numeric scores are not used.

**Wael's words, 2026-08-29, verbatim: "Phase 6 approved — commit and push it."**

- **Overall Recommendation: Approved** — his word, directly.
- **Technical Review / Architecture Completeness / Governance Compliance: NOT INDIVIDUALLY ISSUED.**

**Recorded this way deliberately.** Governance §3 asks for four separate verdicts, and he gave one. **An overall approval is not four verdicts, and writing three additional PASSes would be putting words in his mouth** — a draft of this section did exactly that and was corrected before it was committed.

**What is on the record instead:** he returned this document twice — for the `process.env` claim and for the superseded paragraph — and on approving it raised no further issue, describing the evidence as strong: 54 passed / 0 failed / 0 errored, the live call passed, production untouched, and the Stage 2 routing non-determinism surfaced rather than hidden. **If the three sub-verdicts are wanted formally, they have to come from him.**

**Approval is not authorization to proceed to Phase 7.** He directed this document to be committed and pushed. **He has not said to start Phase 7.**
