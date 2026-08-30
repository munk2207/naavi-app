# B12k — Stage 3: Phase 6 Technical Review (After Coding)

**Work item:** [[B12k]] — Naavi is too slow to answer on voice.
**Date:** 2026-08-29
**Covers:** **Stages 3a and 3c only.** 3b was ruled out by the baseline; 3d was closed by Wael.
**Status:** **RESUBMITTED FOR REVIEW after one return — no verdicts issued.** The return was for a factual claim in §9, now corrected. The reviewer stated what the verdicts would be after that correction; **they are not recorded**, because the correction is a change they have not yet seen.

**What this document is.** Governance §3 puts the four Phase 6 verdicts with the reviewer. This is the submission: the diff after the fact, architecture and regression impact, isolation, test coverage, and the drift check. **§8's verdicts are blank.**

---

## 1. What is under review

| Repository | Branch | Range | Net |
|---|---|---|---|
| `munk2207/naavi-voice-server` | `staging` | `e2dcb0f` … `fb6546c` | **+102 / −4** in `src/index.js` |

**Seven commits, and the last one removes most of the five before it:**

```
2583b9c  Stages 3a and 3c: conversational fast path, and bounded outbound calls
ccd4b5a  make the bound settable so the failure path can be validated
865966d  make the honest failure path mechanical, not instructed
45cce8b  make the unreachable-source path generic, not notes-specific
842cb6b  drop the pronoun from the unreachable-source message
9677929  replace the answer when the question needed the unreachable source
fb6546c  remove the failure-message machinery, keep the bound
```

**Only four lines were removed across the whole of Stage 3**, each replaced in place:

```
-  const trivialRe = /^\s*(...)/i;                                   ← 3a, five phrasings added
-    const res = await fetch(`${SUPABASE_URL}/functions/v1/search-knowledge`, {
-    const dgRes = await fetch(`https://api.deepgram.com/v1/speak?...`, {
-          const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-rules`, {   ← 3c, three bounds
```

**That is the whole behavioural surface**: one regex extended, three fetches bounded. Everything else is the helper, the timeout constant, and comments.

---

## 2. Architecture Completeness — the explicit questions

| Question | Answer |
|---|---|
| Did it increase duplication? | **No** |
| Did it reduce duplication? | **No** |
| Did it bypass Shared Core? | **No.** No Edge Function was touched. `search-knowledge` was deliberately left alone — Phase 3 §4c forbade bounding inside it, because it has three callers including the mobile client |
| Did it introduce another independent implementation? | **No.** One helper, `_b12kFetchBounded`, used at three sites |
| Did it violate entry-point responsibilities? | **No.** A timeout on an outbound call is transport behaviour, not business logic |
| Did it change an API contract? | **No.** Request and response shapes are unchanged. A bound changes **when a call gives up**, not what it returns |
| Did it change a capability's ownership? | **No** |
| Did it expand what counts as Protected Core? | **No** |

---

## 3. Architecture Drift Rule

**Outcome 1 — matches.** The Reference describes the voice server as an entry point owning the turn pipeline. A model-selection predicate and outbound timeouts are both inside that. Nothing moved between components.

**The two known Reference omissions are unchanged** — `search-knowledge` has no §2 row, and its duplication inside `global-search` is absent from §5a. Both predate B12k. Entries were drafted, approved, written as revision `2026.07.18.16`, and **reverted on Wael's instruction**. No reason was given and none is inferred. **The Reference stands at `2026.07.18.15`, the version Phase 1A recorded** — so the Phase 8 version check has nothing to re-evaluate.

---

## 4. ⭐ Invalidated Planning Assumption Rule

**Governance requires a Phase 2 plan that could not be carried out as written — without that being an implementation error — to be recorded as an invalidated planning assumption.**

**This stage has the largest instance in the work item.**

**What Phase 3 §4c assumed.** That a bound requires an honest failure path, and that this was mandatory: *"a bound without this is not authorized under any branch."* The reasoning: a timeout falling back to an empty result would make Naavi say the caller has no notes when the truth is she could not look.

**What execution found.** Three things in order.

1. **A prompt instruction does not hold.** The section reached the prompt intact and Naavi answered *"I don't have that information in your records"* anyway.
2. **A mechanical replacement needs a judgement that cannot be made.** Deciding whether a question depended on the notes requires knowing what is in the notes. `isRetrievalQuery` matched *"what is the weather"*; `isKnowledgeQuery` would have missed *"when is the first day of school"*.
3. **The premise was wrong.** Wael ruled the original sentence honest: *"it simply means Naavi does not have the resources to answer. Nothing more."* And the decisive measurement: **the same question with the lookup succeeding returns that sentence word for word.** There was never a distinct failure case.

**Classification: a planning assumption invalidated by the product owner's reading of the user experience** — not an implementation error, and not a scope cut. The constraint was written to prevent a falsehood that was not one.

**The cost was real and is not hidden:** five commits of apparatus built and removed, and two defects introduced along the way — a grammar bug, and a gate that destroyed a weather answer. Both were caught by testing; the second only because both halves were run.

---

## 5. Regression risk

| Evidence | Result |
|---|---|
| Gate 2, against **STAGING** | **63 tests, 59 passed, 0 failed, 0 errored**, 4 environmental skips |
| Live turns via `/test/ask` | Check-in **3.05 s**; lookup **6.49 s** with the answer unchanged |
| Failure path, injected bound | Validated end-to-end and observed |
| Staging restored | Bound back at 10 s, lookups succeeding, injected variable removed and the container redeployed |
| `node --check` | Pass at every commit |

**The guard for 3a is the important regression evidence.** *"What is my home address?"* still routes to Sonnet and still answers *"I don't have your home address saved… only your work address"*. If the fast path had widened into information requests, that turn would have gone to Haiku, which was measured stating the **work** address as the home address, three times out of three.

---

## 6. Isolation

| Boundary | State |
|---|---|
| Production voice server | **Untouched** — `main` at `5dff3d5` |
| Production Supabase | Untouched |
| Mobile | No file changed |
| Edge Functions | None changed |
| `B12K_FORCE_MODEL` / `B12K_FETCH_TIMEOUT_MS` on production | **Verified absent** at every step |
| Same on the staging demo service | **Verified absent** at every step |

**One operational note, learned twice tonight:** deleting a Railway variable removes it from the stored config **without restarting the container**, so the running process keeps the old value. Both injected variables were cleared **and** a redeploy fired. Verified by behaviour afterwards, not by reading the config.

---

## 7. Test coverage

**Five permanent regression tests, registered in `tests/runner.ts`.** Stage 3 carries **no** Rule 15a exception — Wael's condition when granting one for Stage 2.

- **Three for 3a:** check-ins reach the fast path; information requests do not; the source comment records why the boundary sits there. Two negative cases are adversarial — *"can you hear me read my emails"* and *"Are you there when I call Bob?"* both open with a check-in and then ask for something.
- **Two for 3c:** the bound fires against a server that never responds — **behavioural, the injected-delay validation Phase 3 specified** — and the three authorized sites use it.

**Both suites lift the live regex and the live helper out of the voice server** rather than restating them, so neither can pass against a copy that has drifted from the code.

**Four tests were deleted** with the machinery they covered. That was deliberate: a test asserting removed behaviour either fails, or gets "fixed" into testing something that no longer exists.

---

## 8. Verdicts — to be issued by the reviewer

Per Governance §3, four independent verdicts. Numeric scores are not used.

- **Technical Review:** PASS / FAIL — *not yet issued*
- **Architecture Completeness:** PASS / FAIL — *not yet issued*
- **Governance Compliance:** PASS / FAIL — *not yet issued*
- **Overall Recommendation:** Approved / Approved with Mandatory Changes / Rejected — *not yet issued*

**The reviewer returned this document once**, for the *"nothing else moved"* claim in §9 — a summary that contradicted this work item's own Phase 5 finding — and stated the four verdicts it would carry **after that correction**.

**Those verdicts are NOT recorded here, and a draft of this section wrongly did record them.** The correction was conditional on a change the reviewer had not seen; writing the verdicts in on the strength of having made it is Claude certifying its own fix. **The corrected document goes back for review.**

**A verdict of Approved would not itself authorize Phase 7.** Wael's own separate word is required for that.

---

## 9. What this stage achieved, stated plainly

**3a: the five authorized check-in phrases are 3.7 seconds faster** — 6.76 s to 3.05 s. They now take the existing trivial fast path, **which selects Haiku *and* skips calendar and knowledge context entirely**. Information-request turns remain outside that path.

> **⚠ Corrected 2026-08-29 on the reviewer's challenge.** This read *"and nothing else moved"*, which is misleading. **Two things changed for those phrases, not one** — the model *and* the context gathering. Phase 5 §3 had already established it, calling the fast path *"a context skip as much as a model choice"*, and I then summarised it here as a pure model change. **That is also why the saving was 3.7 s rather than the ~3.5 s the model difference alone predicted** — the extra came from the skipped fetches, and describing it as model-only leaves the number unexplained.

The model lever is otherwise exhausted: the turns that can safely use Haiku already did, and Haiku failed the quality gate on the two that could not.

**3c: a stalled call is now bounded at 10 seconds** instead of running to two minutes and reaching nobody. **No bound has fired in production**, because no stall has recurred since instrumentation landed.

**B12k's 5-second bar is still not met.** These changes do not move a median. What moved the item forward was measurement: 3b ruled out at ≈260 ms against a 750 ms gate, 3a's ceiling found, and the real remaining lever identified and moved to [[B12m]].
