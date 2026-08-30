# B12k — Phase 3: Technical Review (Before Coding)

**Work item:** [[B12k]] — Naavi is too slow to answer on voice.
**Date:** 2026-08-28
**Prior phases:** Phase 0 approved. Phase 1 approved, two measurements deferred. Phase 1A approved and committed (`781ec5f`). Phase 2 approved after two returns; Stage 2's Rule 15a exception granted, Stage 3 excluded from it.
**Status:** **RESUBMITTED FOR REVIEW after one return — no verdict issued.** No code written.

**What this document is.** Governance §3 puts the Phase 3 verdict with the reviewer, not with Claude. This is the submission: the technical analysis, the coupling found by reading code rather than assuming, and **proposed** Implementation Boundaries — including, per the return below, **conditional authorization for Stage 3 with measurable gates.**

---

## 0. What was wrong with the first version of this document

**It excluded all of Stage 3 from review and required a second Phase 3 later.** Wael returned it:

> *"This recreates, in another form, the fragmentation we rejected in Phase 2 … Claude even acknowledges that conditional specification is possible, but rejects it mainly because it would 'multiply the review surface.' That's process convenience, not a technical reason."*

**He is right, and the admission matters more than the fix.** Conditional specification was possible, I said so in the same breath as refusing it, and the reason I gave was about the size of the review rather than about the engineering. **That is my workload dressed as a technical judgement** — the same shape as three earlier corrections in this work item.

**§4 now specifies Stage 3 conditionally**, with gates that are measurable and decided before the measurements exist. A result falling outside the stated branches returns for review; a result inside them does not.

---

## 1. What is submitted

| Stage | Submitted |
|---|---|
| **1 — Instrumentation** | Fully specified (§3) |
| **2 — Controlled model evaluation** | Fully specified except the switch mechanism, which §5 puts to the reviewer |
| **3a / 3b / 3c** | **Conditionally specified with gates (§4).** Each branch names the measurement, the threshold, and the exact change authorized if the threshold is met |

---

## 2. Assumptions, stated so they can be attacked

| # | Assumption | Status |
|---|---|---|
| 1 | Adding log statements to `src/index.js` changes no behaviour | **Believed, not proven.** Protected Core; the risk is an editing mistake. Gate 2 plus a live staging call is the test |
| 2 | A module-level lag probe does not interfere with per-call state | **Verified by design** — writes nothing any call reads. Rule 10's concern does not arise |
| 3 | The four serial context calls do not consume the parallel block's results | **VERIFIED at the call sites — §3.1** |
| 4 | Haiku can answer voice turns as correctly as Sonnet | **NOT assumed. It is the question Stage 2 exists to answer**, and Phase 0 Success Criterion 4 makes a quality loss disqualifying |
| 5 | The 30-turn set is adequate to show a median shift | **Precommitted, Phase 1 §9b**, with its stated limit: it cannot demonstrate the absence of rare stalls |
| 6 | Timings reflect real elapsed time for the operation named | **Explicitly doubted.** A blocked event loop inflates every `Date.now()` delta. Stage 1 measures the size of that effect; it does not remove it |

---

## 3. Hidden coupling — found by reading the code

### 3.1 The four serial calls do not depend on the parallel block

**Freshly verified this session, at the call sites:**

| Call | Line | Arguments actually passed |
|---|---|---|
| `fetchUserLists` | `:3063` | `userIdOverride` |
| `_b4xBuildAlertsContext` | `:3331` | `userIdOverride`, `userNameOverride \|\| 'the user'` |
| `user_settings` REST read | `:3351` | `userIdOverride`, in the URL |
| `fetchCalendarPdfBlock` | `:3414` | `userIdOverride`, `userMessage` |

None consumes `events`, `knowledge`, `weatherData`, `globalSearchResults` or `recentEmails`. Every argument exists before the parallel block starts.

### 3.2 ⭐ They do not share a condition, and that is the coupling

| Call | Runs when |
|---|---|
| `Promise.all` `:3053` | **`if (!isTrivial)`** |
| `fetchUserLists` `:3063` | **`if (!isTrivial)`** — inside it |
| `_b4xBuildAlertsContext` `:3331` | **`if (userIdOverride)`** — outside it |
| `user_settings` read `:3351` | **`if (userIdOverride)`** — outside it |
| `fetchCalendarPdfBlock` `:3414` | **unconditional** — outside it |

**Three of the four run on every turn, including trivial ones. The parallel block does not.**

1. **"Move them into the existing `Promise.all`" is unsafe as stated.** It would stop three calls running on the fast path — a correctness change, not an optimisation.
2. **It explains a Phase 1 measurement that had no explanation.** Trivial turns reported `T2 = 2 ms` yet totalled **1 841–3 167 ms**. The context stage genuinely was skipped; these three plus Claude are where that time went. **The trivial fast path is not as fast as `T2` makes it look.**

### 3.3 `fetchCalendarPdfBlock` exists twice

`src/index.js:1331` and `supabase/functions/naavi-chat/index.ts:806`. Voice's own comment at `:3412` says so. **No stage changes either.** Recorded so a reviewer seeing the name in a diff does not assume one definition.

---

## 4. ⭐ Stage 3 — conditional authorization with measurable gates

**On the thresholds below.** Each is a **judgement, not a derived constant**, and every one is open to amendment by the reviewer. They are stated as numbers so that the decision is made *before* the data arrives and cannot be adjusted to fit a result — which is the same discipline Wael imposed on the trial count in Phase 1 §9b. **The reasoning behind each number is given so it can be argued with rather than merely accepted.**

**The gap to close:** median **8 736 ms** against a **5 000 ms** bar — **3 736 ms**.

### 4a. Model selection

**Gate measurement:** Stage 2's controlled comparison — identical prompts, identical context, identical account, both models, **minimum 3 trials per case**, latency and answer quality both recorded.

| Branch | Condition | Authorized change |
|---|---|---|
| **A1** | Haiku's median is **≥ 1 500 ms faster** on equivalent prompts **AND** zero cases of degraded correctness or completeness | Extend the Haiku predicate at **`:3446` only** to cover the tested turn classes |
| **A2** | Latency gate met, but quality degrades on **some** turn classes and not others | Extend the predicate at `:3446` **only to the classes where quality held**. The classes that failed stay on Sonnet |
| **A3** | Latency gain **< 1 500 ms**, or quality degrades across all classes | **3a not implemented.** Return with the evidence |

**Why 1 500 ms:** it is 40 % of the 3 736 ms gap from a single-line change. Below that, a live behaviour change affecting every caller is not proportionate to the gain when 3b and 3c remain available.

**Quality is a veto, not a weight.** Phase 0 Success Criterion 4 says the item buys speed, not brevity. **A single case where Haiku's answer is materially less correct or less complete fails that class**, regardless of the latency number.

**Boundary:** the predicate at `:3446` and nothing else. **No new classification logic, no restructuring of the classifier, no prompt change.**

### 4b. Context path

**Gate measurement:** Stage 1's per-call timings for the four calls in §3.1, median across the sample.

| Branch | Condition | Authorized change |
|---|---|---|
| **B1** | The four total **≥ 750 ms** median | Start each call as early as **its own condition** allows, concurrently with each other and with the parallel block, and await each where its result is first used. **Every call keeps the exact condition it has today** — §3.2 makes that mandatory, not optional |
| **B2** | Total **< 750 ms** median | **3b not implemented.** Not proportionate to the risk of restructuring Protected Core |

**Why 750 ms:** 20 % of the gap. This is a structural change to the file that controls every phone call, and a smaller return does not carry it.

**Boundary:** the region `:3053`–`:3415` only. **No call added or removed. No condition changed. No call's arguments changed.** Behaviour on the trivial fast path must be identical before and after — that is the specific regression this change risks, and Phase 5 must show it did not happen.

### 4c. Bounded calls

**Gate measurements:** Stage 1's event-loop lag figures **and** its per-call timings, read together. Phase 2 §2.3 states why the lag probe alone cannot attribute causation.

> **⚠ Corrected 2026-08-28 on Wael's challenge.** The first version made a stall recurring during Stage 1 a **precondition** for implementing bounds at all — *"No stall recurs → 3c not implemented. Cannot size a bound against a distribution containing no stall."* **Wrong in two ways, the second worse than the first.**
>
> 1. **It contradicted this section's own sizing rule.** The bound is sized from the **healthy** distribution's 99th percentile, which a stall-free window supplies perfectly well. Nothing about sizing needs a stall.
> 2. **It inverted the purpose of the protection.** A bound exists to contain **rare abnormal events**. Requiring the rare event to recur before the protection may be built defeats most of what the protection is for — and the stalls at **104 s, 110 s, 122 s and 140 s** already happened. **That evidence does not expire because a later window happens to be clean.**

**The need for bounds is already established by Phase 1's measurements and is not re-litigated by Stage 1.** What Stage 1 contributes is the **size** of the bound, the **expected effectiveness**, and the **means of validation** — none of which is a gate on whether to proceed.

| Branch | Condition | Authorized change |
|---|---|---|
| **C1** | Lag stays low through the observation window | Bounds at voice's **call sites** — `:1200`, `:13051`, `:8903`. Sized from the healthy p99 |
| **C2** | Lag is substantial | **Same bounds, same sites, still authorized** — a timer on a blocked loop fires late, not never, so the gain shrinks rather than vanishing. **Plus a new finding:** substantial in-process delay is its own defect, explained and approved under Rule 1b before any item is created for it |

**Whether a stall recurs during Stage 1 changes only how the bound is validated, not whether it is built:**

| If a stall recurs | If none recurs |
|---|---|
| Direct observation of the bound firing on a real event, in addition to the test below | Validation is by **injected delay on staging** — pointing a bounded call at a deliberately slow endpoint and confirming it gives up at the bound |

**Injected delay is the right method in both cases anyway**, because Stage 3 requires **permanent regression auto-tests that run on every build** and no such test can wait for a natural stall. **The validation method and the test obligation are the same mechanism**, which is why a stall-free window costs nothing here.

**Bound value:** set from Stage 1's measured distribution at **≥ the 99th percentile of healthy observations**, proposed at **10 s** for the two lookups pending that data. **Why 10 s survives the arithmetic:** two parallel lookups bounded at 10 s, plus Sonnet's 4.5 s median, plus the remaining stages, lands near 16 s — inside Phase 0's 30-second ceiling with margin.

**Placement — this resolves a decision the first version deferred.** **Call-site bounds only. Placing a bound inside `search-knowledge` is NOT authorized by this review**, because that function has three callers including the mobile client, and Phase 2 §7.2 records that as a materially wider blast radius than voice alone.

**⭐ Mandatory constraint, and it is the reason this stage is not a one-line change.** `searchKnowledgeSpecific` already returns `''` on failure (`:1223-1225`), and `search-knowledge` swallows its OpenAI error with a bare `catch { return null; }` (`search-knowledge/index.ts:37`). **A bound that reuses those paths would make Naavi answer as though the user has no saved notes on the subject — when she may well have them.** That is a false statement to the user, the class CLAUDE.md Rule 18 and `project_naavi_truth_at_user_layer` forbid, and it would be *caused* by the fix.

**Therefore 3c must specify what Naavi says when a bound fires**, and it may not be silence or a confident empty answer. Something in the shape of *"I couldn't reach your notes just now"* — the exact wording is Phase 4's to draft and the reviewer's to approve. **A bound without this is not authorized under any branch.**

### 4d. Answer length — added 2026-08-29 on Wael's decision

**Target:** Defect A, and the part of the caller's wait that no network or model work can reach — the time Naavi spends *talking*.

**The evidence that opened it.** One answer measured **1 411 characters**: four sections with headings, markdown bold markers in text going to text-to-speech, and roughly ninety seconds of speech. **It costs twice** — the model spends longer generating it, then the caller sits through it.

**Where, and why this stays out of Shared Core.** The voice server already carries a precedent for exactly this: `src/index.js:3341` appends `calendarListingInstr`, a **voice-only** response-format instruction capping calendar listings to three events and closing with *"Want me to read the rest?"*. **Stage 3d follows that pattern** — a voice-only instruction inside the voice server. **`get-naavi-prompt` is NOT touched**, so mobile is unaffected and no Shared Core change is involved.

**Gate measurement:** answer length, captured across the trial set alongside the timings.

| Branch | Condition | Authorized change |
|---|---|---|
| **D1** | Median spoken answer exceeds **~400 characters** on the trial set | A voice-only response-length instruction, in the shape of the existing `calendarListingInstr` — brief answer plus an explicit offer to go on |
| **D2** | Median at or under ~400 characters | **3d not implemented** — the 1 411-character case was an outlier rather than the norm |

**Why ~400:** roughly 25 seconds of speech, which is already most of Phase 0's 30-second ceiling for an entire turn. **A judgement, not a derived constant**, and open to amendment like every other threshold here.

**⭐ The quality veto applies with more force here than anywhere else.** Phase 0's Success Criterion 4 says the item buys speed, not brevity. **The measure is not "shorter" — it is "the caller gets the answer they asked for, and can ask for more."** An instruction that makes Naavi omit what was asked fails, however good the timing looks. The existing calendar-listing instruction is the reference for getting this right: it caps what is read *and* offers the rest.

**Also in scope for this stage:** the markdown markers. Text destined for speech should not contain `**`.

### 4e. What falls outside every branch

**If a measurement produces a condition none of the branches above describes, implementation stops and the item returns for review.** That is the escape hatch, and it is deliberately the only one.

---

## 5. Implementation strategy — one open question

**Stage 2 needs a staging-only way to force the model.** Three candidates:

| Option | How | Cost |
|---|---|---|
| **A — environment variable** | Read at `:3446`; unset on production, so production is unchanged by construction | Forces the model for **every** turn on that service; no A/B within one call |
| **B — request/session parameter** | Passed per call; both models exercisable in one sitting | Adds a parameter to a live call path — wider surface on Protected Core |
| **C — temporary branch** | Model hardcoded, deployed to staging, never merged | Zero production surface. But both staging Railway services deploy the same branch (Reference §0b), so it also lands on the staging demo line |

### ⭐ Recommendation: Option A — environment variable

> **⚠ Corrected 2026-08-28 on Wael's challenge.** This section previously read *"No recommendation offered — the choice turns on weighing surface area on Protected Core against test convenience, which is a review judgement, not a measurement."* **That handed an implementation-design decision to the reviewer because trade-offs existed.** Claude is the implementer and has read the code; withholding a recommendation here also broke a standing rule of Wael's that numbered options are always paired with a recommendation and a reason.

**Recommended: Option A.** Reasons, in order of weight, with the code checked rather than assumed:

1. **It is the pattern this project already uses for exactly this purpose, and the Architecture Reference endorses it.** The Shared Core outbound guard is inert unless `OUTBOUND_ALLOWLIST` is present, and that secret exists only on staging — §0b describes the result as production being *"protected by construction rather than by correct configuration."* **A staging-only variable at `:3446` is the same construct applied to the same problem.** Unset on production, the expression evaluates exactly as it does today.
2. **The narrowest change of the three.** One expression at `:3446`. Option B adds a parameter to a live call path on Protected Core — the file whose own classification says a mistake is *"heard live by a real caller with no undo."*
3. **⭐ It is the only option that does not reach the staging demo line.** Both staging Railway services deploy the **same branch** (Reference §0b), so Option C's temporary branch lands on `generous-tenderness` as well. **An environment variable is set per service**, so it affects `naavi-voice-staging` and nothing else. This is a concrete containment advantage the first version of this section did not identify.
4. **It fits the file's existing convention.** `src/index.js` reads `process.env` at 29 sites, with configuration hoisted to module-level constants at `:120-128` — so this is an established shape here, not a new mechanism.

**The cost, stated plainly:** the model is forced for every turn on that service, so Sonnet and Haiku cannot be exercised within one call. **That is test inconvenience, not product risk** — the comparison runs as two passes over the same 30-turn set rather than one interleaved pass, which is if anything cleaner, since each pass is internally consistent.

**No concrete technical reason against Option A was found by inspection.** If the reviewer wants the variable read inline at `:3446` rather than hoisted to the module-level block at `:120-128`, that is worth stating — an inline read takes effect on the next turn, while a hoisted constant is fixed at boot and requires a service restart, which Railway performs automatically when a variable changes. **Either behaves correctly; the inline read is marginally more convenient for testing and is what this recommendation assumes.**

**Whatever is chosen must be inert on production.** Not negotiable; it follows from Phase 0's staging-only constraint.

---

## 6. Proposed Implementation Boundaries — for the reviewer to confirm or amend

**Authorized file — one:** `naavi-voice-server/src/index.js`, branch `staging`.

**Authorized unconditionally (Stages 1 and 2):**

1. `[Timing]` logs around `fetchUserLists` `:3063`, `_b4xBuildAlertsContext` `:3331`, the `user_settings` read `:3351`, `fetchCalendarPdfBlock` `:3414`.
2. `[Timing]` logs around `fetchGlobalSearch` and `fetchWeather` inside the `Promise.all` `:3053`.
3. One module-level event-loop lag probe.
4. The Stage 2 model switch, in whichever form §5 resolves to — and only if that form is a code change.

**Authorized conditionally, on the gates in §4** — the change named in the branch, and nothing wider:

5. **4a** — the Haiku predicate at `:3446`, on branch A1 or A2.
6. **4b** — the region `:3053`–`:3415`, on branch B1, every condition preserved.
8. **4d** — a voice-only response-length instruction in `src/index.js`, on branch D1, following the existing `calendarListingInstr` pattern at `:3341`. **`get-naavi-prompt` is not touched and mobile is not affected.**
7. **4c** — call-site bounds at `:1200`, `:13051`, `:8903`, sized from Stage 1's healthy p99, **with the user-facing failure message the mandatory constraint requires**. **Authorized under both C1 and C2 — the branches differ in expected effectiveness, not in whether the work proceeds.** Whether a stall recurs during Stage 1 changes only the validation method, and the permanent regression test uses injected delay either way.

**NOT authorized, in any branch:**

- Any change inside `search-knowledge`, `manage-rules`, `get-naavi-prompt` or `global-search`. **No Edge Function is touched.**
- Any mobile file.
- Any prompt change, any classifier restructuring, any new classification logic.
- Any call added, removed, or given different arguments.
- Any condition changed on any existing call.
- Opportunistic refactoring, renaming, cleanup or style change. **Rule 20's "remove dead code" must not be invoked here** — anything noticed is reported in Phase 5 as a separate item.
- Any production deploy.

**Test obligations, restated because they differ per stage:** Stages 1 and 2 carry Wael's Rule 15a exception, evidenced by Gate 2 plus a live staging call. **Stage 3 carries no exception** — it requires **permanent regression auto-tests registered in `tests/runner.ts` that run on every new build**, per his clarification, not one-off development scripts.

---

## 7. Deferred Architectural Decisions

1. **A general bounded-call convention for voice and Shared Core.** Phase 1A found mobile has one; voice has 132 fetches against 3 abort controllers, Shared Core 233 against 2 files. **Not approved** — the blast radius is the entire outbound surface of two codebases, where 4c touches three call sites. **Reconsider if** 4c lands and the same stall class appears on a site it did not cover.
2. **Whether the voice/`naavi-chat` model divergence belongs in the Architecture Reference.** Phase 1A raised it and took no position. Two Reference entries proposed during Phase 1A were approved, added, then reverted on Wael's instruction. **Nothing is proposed here.**
3. **The greeting path.** Phase 1 §9c excluded TTS generation by measurement (147–713 ms across 50 samples), leaving the 19.5-second greeting unattributed with the four-round-trip timezone-capture flow as an unproven candidate. **Out of scope for every stage. Wael deferred it explicitly at Phase 1.**

*(The placement question for `search-knowledge` bounds is no longer deferred — §4c decides it.)*

---

## 8. Verdict — to be issued by the reviewer

Per Governance §13: **Approved** · **Approved with Mandatory Changes** · **Rejected**.

A verdict of Approved is **not** authorization to begin Phase 4. Wael's own separate word is required for that transition.

**APPROVED by Wael, 2026-08-28 — Phase 3 → 4 authorized.** Approved after three returns: excluding Stage 3 from conditional specification, gate C3 making a rare event's recurrence a precondition for protecting against rare events, and withholding a recommendation on the Stage 2 switch. **The Implementation Boundaries in §6 are the authorization Phase 4 implements against and Phase 6 audits against.**

**Phase 4 implements Stages 1 and 2 only.** Stage 3's branches are authorized in principle by §4 but cannot be implemented until the measurements that select a branch exist.
