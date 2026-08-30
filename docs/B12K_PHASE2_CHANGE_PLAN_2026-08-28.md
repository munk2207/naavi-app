# B12k — Phase 2: Change Planning

**Work item:** [[B12k]] — Naavi is too slow to answer on voice.
**Date:** 2026-08-28
**Prior phases:** Phase 0 approved. Phase 1 approved with two measurements deferred. Phase 1A approved and committed (`781ec5f`).
**Status:** **APPROVED by Wael, 2026-08-28 — Phase 2 → 3 authorized.** Approved after two returns: one for restructuring (measurement-only plan rejected as over-cautious), one for a false attribution of his Rule 15a approval. Stage 2's test exception granted in the same message, with the condition that **Stage 3's model change still requires proper automated tests.** No code written.
**Risk:** **MEDIUM overall**, rising to **HIGH** for the model change in Stage 3a. Per-stage risk is stated in each stage.

---

## 0. What was wrong with the first version of this plan

**The first version proposed instrumentation and nothing else**, and said a second Phase 2 would follow later to propose an actual fix. Wael returned it. His objection, and it is correct:

1. **The Sonnet finding is already strong enough to act on.** A median of 4 515 ms consumes roughly 90 % of the entire 5-second target on its own. Refusing to propose anything about it until every other component is instrumented is over-cautious.
2. **"The historical comparison is confounded" is a reason to run a better comparison, not to defer.** Haiku and Sonnet can be tested on **equivalent prompts** in staging. I used the confound as grounds for delay when it was grounds for designing a controlled test.
3. **"Two unsized levers" was a false choice.** Model selection, context-path work and bounded-call protection are **complementary**, not competing — they address different parts of the problem and do not need to be ranked against each other before any can be investigated.
4. **It turned instrumentation into a separate governance project** standing between this work item and any improvement at all.

**What this version does instead:** one plan, four stages, with instrumentation as an enabling step inside it rather than a gate in front of it, and with every candidate improvement named now along with how it will be evaluated in staging.

---

## 1. The plan in one view

| Stage | What it is | Files | Behaviour change to a caller? | Risk |
|---|---|---|---|---|
| **1** | Instrumentation — time the unmeasured stages, probe the event loop | `naavi-voice-server/src/index.js` | **None** | LOW |
| **2** | Controlled model evaluation on staging — same prompts, both models | `naavi-voice-server/src/index.js` (staging-only selection switch) | **None on production**; staging only, under test | LOW |
| **3a** | **Model selection** — the everyday-latency lever | `src/index.js:3446` | **Yes** | **HIGH** |
| **3b** | **Context path** — collapse serial calls into the existing parallel block | `src/index.js:3053`–`:3415` | **Yes** (timing only, same data) | MEDIUM |
| **3c** | **Bounded calls** — the catastrophic-stall lever | `src/index.js:1200`, `:13051`, `:8903`; `supabase/functions/search-knowledge/index.ts:23` | **Yes**, on failure paths only | MEDIUM |
| **3d** | **Answer length** — how long Naavi talks | `src/index.js`, voice-only response-format instruction | **Yes** | MEDIUM |

**Stage 3d added 2026-08-29 on Wael's decision.** Phase 0's Out of Scope excluded *"shortening or simplifying what Naavi says"* — **that exclusion was Claude's proposal, never Wael's ruling**, and the Phase 0 provenance table says so. Evidence from Stage 2 changed the picture: Naavi answered one question with **1 411 characters** — four sections with headings, roughly ninety seconds of speech, with markdown bold markers in text bound for TTS. **That is not a thorough answer being trimmed; it is a screen answer delivered to someone holding a phone.** Wael ruled it in scope.

**Stages 1 and 2 are enabling work and carry no caller-visible change. Stage 3's three parts are the actual improvements, and each is independently justified, independently measured, and independently approvable.** None depends on another landing first.

**Evaluation for every part of Stage 3 is the same instrument:** the precommitted 30-turn set defined in Phase 1 §9b — six turn types, five repetitions each — run on staging before and after, with every turn's time published individually. **The trial count was fixed before any result existed and may not be revised afterwards.**

---

## 2. Stage 1 — Instrumentation

**Risk: LOW.** No control flow, no output, no spoken text changes.

### 2.1 Time the four serial context calls

These run one after another, after the parallel block and before Claude, and **not one is instrumented**:

| # | Call | Line |
|---|---|---|
| 1 | `fetchUserLists` | `:3063` |
| 2 | `_b4xBuildAlertsContext` | `:3331` |
| 3 | `user_settings` REST read (`home_address`, `work_address`) | `:3352` |
| 4 | `fetchCalendarPdfBlock` | `:3415` |

They sit inside the 3 364 ms median Phase 1 could only measure as one block. **This directly enables Stage 3b** — whether that block is four slow calls or one slow call and three fast ones decides how much 3b is worth.

`fetchUserLists`' own comment at `:3060` estimates it at *"~50ms"*. That is a code comment, not a measurement.

### 2.2 Time the uninstrumented members of the parallel block

`fetchGlobalSearch` and `fetchWeather` run inside the `Promise.all` at `:3053` with no timing line. `fetchLiveRecentEmails` already has one at `:786`.

**Not optional detail:** Phase 1 found a turn where `T2` reported **31 807 ms** while the two instrumented parallel calls finished at **16 623 ms** and **18 345 ms**. Roughly **13 seconds** sat in something nobody can currently name.

### 2.3 Event-loop lag probe

A module-level timer recording how late it fires against its own schedule, logged past a threshold.

**What it is for: quantifying how much in-process delay is present, as one input among several.** It is **not** a test that decides network-versus-event-loop causation, and this section previously described it as one.

> **⚠ Corrected 2026-08-28 on Wael's challenge.** The earlier text read: *"If lag spikes coincide with the 98-second and 122-second lookups, those durations are delayed continuations, not slow network calls, and a request timeout would never fire."* **That treats two things that can happen at the same time as mutually exclusive.** Event-loop lag during a slow request does not establish that the request was fast — both can be true at once, and a common cause such as container CPU starvation could produce both. A lag probe also cannot attribute the whole of a 98- or 122-second duration to either side.

**What the probe can and cannot support:**

| Observation | What it supports | What it does not support |
|---|---|---|
| Lag flat during a slow lookup | The delay is very likely outside the process | Nothing about *which* upstream, or why |
| Lag high during a slow lookup | In-process delay is present and is inflating the measured duration by at least the lag observed | **That the request itself was fast.** Both can be occurring |

**One mechanical consequence worth recording, because it affects Stage 3c either way:** a timeout timer is scheduled on the same event loop. **If the loop is blocked, the timer is delayed too**, so a bound's effectiveness is *reduced* in proportion to in-process delay — **not eliminated**, and not proven ineffective.

Module-level, not per-connection — it measures the process and writes nothing any call reads, so CLAUDE.md Rule 10's multi-user concern does not arise.

---

## 3. Stage 2 — Controlled model evaluation

**Risk: LOW.** Staging only. Nothing reaches a production caller.

**The problem this solves.** Phase 1 measured Sonnet at a **4 515 ms** median across 20 turns and Haiku at **1 922 ms** across 4 — with **no overlap**, Sonnet's fastest exceeding Haiku's slowest. **But Haiku only ran on turns the classifier judged simple**, so that gap contains both the model and the easier work, and nothing separates them.

**The design.** Run the same representative turns through both models on staging — identical prompts, identical context, identical account — and measure two things, not one:

1. **Latency**, per turn, both models.
2. **Answer quality** — whether Haiku's answer is as correct and as complete as Sonnet's.

**Quality is not optional here, it is a hard gate.** Phase 0's Success Criterion 4 states that nothing Naavi says changes as a side effect, and that the item buys speed rather than brevity. **A model change is exactly the shape of change that could meet the latency bar by degrading the answer**, which would satisfy the metric and fail the product.

**The Non-Determinism Rule applies** (Governance Phase 3): a minimum of **3 independent trials per behaviour-changing case**, with the full distribution of outcomes reported in Phase 5 — not a pass/fail summary. Live classifier calls do not repeat deterministically, as B10j proved empirically.

**Mechanism:** a staging-only way to force the model for a turn. **The exact mechanism is for Phase 3 to settle** — this plan does not specify whether that is an environment variable, a request parameter, or a temporary branch — but whatever it is must be inert on production.

---

## 4. Stage 3 — The three candidate improvements

### 3a. Model selection — the everyday-latency lever

**Risk: HIGH.** This changes what every caller hears.

**Target:** Defect A, the 8.7-second median. **The largest single measured cost on the path.**

**Where:** `src/index.js:3446`, the one line that selects Haiku for trivial / calendar-listing / simple-lookup / personal-lookup and Sonnet for everything else.

**What might change:** the set of turns routed to Haiku, or the default. **This plan does not specify which** — the shape depends on Stage 2's results, and proposing it now would be choosing before measuring.

**What justifies it:** Stage 2 showing a material latency gain **with no quality loss** on equivalent prompts, across at least 3 trials per case.

**What blocks it:** any measurable degradation in answer correctness or completeness. **Phase 1A recorded that Phase 2 owes an answer to "why Sonnet on voice."** This plan still does not have one — nothing in either codebase records whether the divergence from `naavi-chat`'s Haiku was deliberate. **Stage 2 is partly how that answer gets found**, and if it turns out Sonnet is there for a quality reason, Stage 2 will show it as a quality loss rather than leaving it as an unexamined assumption.

### 3b. Context path — collapse the serial calls

**Risk: MEDIUM.**

**Target:** Defect A, the 3 364 ms context median.

**Where:** the four calls listed in §2.1, against the existing `Promise.all` at `:3053`.

**What might change:** moving some or all of the four into the existing parallel block, so they overlap rather than queue.

**The question Phase 3 must resolve before this is approved:** whether any of the four depends on a value the parallel block produces. **Preliminary read, freshly checked this session and offered as a starting point rather than a conclusion:** their signatures take only `userId`, `userName` and `userMessage` — `fetchUserLists(userId)`, `_b4xBuildAlertsContext(uid, userName)`, `fetchCalendarPdfBlock(userId, userText)`, and an inline `user_settings` read keyed on `userIdOverride` — none of which the parallel block produces. **That is a signature-level read, not a body-level audit, and B9x's lesson is precisely that a narrow search does not support a broad conclusion. Phase 3 must verify the bodies.**

**What justifies it:** Stage 1 showing the four calls carry meaningful cost. If they total 200 ms, this is not worth the risk to Protected Core; if they total 2 seconds, it is most of the remaining gap.

### 3c. Bounded calls — the catastrophic-stall lever

**Risk: MEDIUM.** Changes failure paths only; a healthy turn behaves identically.

**Target:** Defect B — the 100-to-140-second turns that reach the caller as a dead line.

**Where:** `src/index.js:1200` (knowledge), `:13051` (`manage-rules`), `:8903` (Deepgram TTS), and `supabase/functions/search-knowledge/index.ts:23` (the OpenAI embedding call).

**What might change:** bounding these calls so a stalled dependency produces a bounded, reportable failure instead of an open-ended wait.

**Precedent, not a template.** Phase 1A found that mobile already does this — `lib/invokeWithTimeout.ts`, whose header describes *"2-3 minute hangs"*, the same shape as B12k's cases — and that neither voice nor Shared Core adopted it. **That is evidence the pattern is established here, not evidence it is the right fix**, and Phase 1A's three limits still stand: it addresses neither the median nor the cause of the stall.

**⭐ What Stage 1 contributes to this decision — and it is an input, not a verdict.** *(Corrected 2026-08-28 on Wael's challenge; the earlier version said a request timeout "would never fire" and this stage would be "worthless" if the probe showed in-process lag.)*

**Stage 3c is decided from the combined timing evidence**, not from the lag probe alone: the per-call timings from §2.1 and §2.2, the lag figures from §2.3, and the relationship between them across enough slow turns to be more than anecdote.

- **High in-process lag does not make this stage worthless.** It means part of the measured duration is in-process, that a bound's timer is itself subject to the same delay, and therefore that the bound would fire **late rather than not at all**. The gain shrinks; it does not vanish.
- **Low in-process lag strengthens the case**, because it points the delay outside the process where a bound acts cleanly.
- **Neither outcome identifies the cause of the stall.** Phase 1 §9d left that open and Stage 1 does not close it.

**What this stage is worth is therefore a matter of degree, to be argued in Phase 3 from the measurements, rather than a yes/no switched by one probe.**

**Shared Core caution.** `search-knowledge` is Shared Core with three callers. A bound placed inside it affects `naavi-chat` and the mobile client as well as voice — see the Regression Matrix, §7.

---

## 5. Change Impact Matrix

**Every row answered explicitly, per Governance §3, across the whole plan.**

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **No file changes. Behaviour affected only via Stage 3c** if a bound is placed inside `search-knowledge`, which mobile also calls. Mobile already applies its own 15-second client-side bound (`lib/invokeWithTimeout.ts`), so a server-side bound is additive, not conflicting |
| **Voice** | **Yes** — every stage touches `naavi-voice-server/src/index.js` |
| **Shared Core** | **Stages 1, 2, 3a, 3b: No.** **Stage 3c: Yes**, if the bound extends to `search-knowledge/index.ts:23` |
| **Database** | **No** — no migration, no schema change, no RLS change, in any stage |
| **Cron** | **No** — no cron job added, removed or rescheduled, in any stage |
| **API contracts** | **No.** No request or response shape changes. Stage 3c changes *when a call gives up*, not the shape of anything it returns |
| **Tests** | **Yes** — see §8 |

**Duplicated capabilities, addressed individually as the rule requires:**

- **Live calendar reads are Duplicated** (Reference §2, ADR 0002). Only voice's side is touched, and only by Stage 1's log line. Mobile's implementation in `naavi-chat` is unchanged and needs no matching change, because no stage alters calendar-read behaviour on either side.
- **`fetchCalendarPdfBlock` exists twice** — `src/index.js:1331` and `supabase/functions/naavi-chat/index.ts:806`. **Freshly verified this session.** Stages 1 and 3b touch voice's call site only. The function's behaviour is unchanged on both sides.
- **Model selection is Duplicated** — voice at `:3446`, `naavi-chat` at `:3683`/`:3848`. **Stage 3a changes voice only, deliberately.** Mobile is out of scope by approved Phase 0 scope, and mobile is already on the faster model, so the divergence Stage 3a would create is *smaller* than the one that exists today.

---

## 6. Mandatory Architecture Impact Checklist

| Question | Answer |
|---|---|
| Does this change modify Shared Core? | **Only Stage 3c, and only if the bound extends into `search-knowledge`.** Stages 1, 2, 3a and 3b: no |
| Does this change modify an Entry Point? | **Yes** — the voice server. Stage 1 adds observability; Stage 3b changes the order of calls it already makes; neither moves business logic into or out of it |
| Does this change introduce new duplication? | **No** |
| Does this change eliminate existing duplication? | **No** |
| Does this change modify Protected Core? | **Yes.** Reference §4 lists `naavi-voice-server/src/index.js` **in its entirety** as Protected Core — *"Controls every phone call; a mistake here is heard live by a real caller with no undo."* Stage 3c additionally touches Protected Core's Action Rules area via `manage-rules`. Full Phase 1–8 applies regardless of diff size |

---

## 7. Regression Impact and Regression Matrix

### 7.1 Fixed checklist — every item answered

| Function | Affected? |
|---|---|
| Voice commands | **Yes.** Stage 3a changes the model producing every non-trivial answer; 3b changes call ordering; 3c changes failure behaviour. Stages 1–2 change nothing a caller experiences |
| Geofencing | **No** — mobile-only capability, no file touched |
| Gmail integration | **No** — `fetchLiveRecentEmails` is instrumented already and unmodified |
| Calendar integration | **Stages 1, 2, 3a: no.** **Stage 3b: yes, in ordering only** — the same call, issued in parallel rather than in sequence, returning the same data |
| Reminders | **No** — no reminder path touched in any stage |
| SMS / call alerts | **No send path is touched.** Stage 3c touches `manage-rules`, which **reads** rules for the LIST_RULES answer; it does not fire them |
| Onboarding | **No.** The timezone-capture flow is not modified. *(Phase 1 §9c named it as a candidate for the 19.5-second greeting; investigating it is not in this plan.)* |
| Staging build | **Yes** — every stage deploys to the voice `staging` branch and the `naavi-voice-staging` Railway service |

**⭐ Planned for, not to be discovered:** the two staging Railway services deploy the **same branch** (Reference §0b), so every push to `staging` also reaches `generous-tenderness`, the staging demo line.

### 7.2 Consumer trace — found by searching, not recalled

**Voice-local, confirmed by search this session — no cross-surface consumers:**

| Function | Defined at | Consumers |
|---|---|---|
| `fetchUserLists` | `src/index.js:329` | Voice only. No occurrence in `hooks/`, `lib/`, `supabase/functions/` |
| `_b4xBuildAlertsContext` | `src/index.js:4150` | Voice only. Same search, no occurrence |
| `fetchCalendarPdfBlock` | `src/index.js:1331` | Voice only **for this definition**. The same-named function at `naavi-chat/index.ts:806` is a different one, called at `:3658`, untouched |

**⭐ Shared, and the only cross-surface exposure in this plan — Stage 3c only:**

| Function | Consumers found by search |
|---|---|
| `search-knowledge` | **Three callers:** voice `src/index.js:1200`; Shared Core `naavi-chat/intentHandlers.ts:719`; mobile client `lib/knowledge.ts:58`. **Plus a mirrored implementation** in `global-search/adapters/knowledge.ts` that does not call it |
| `manage-rules` | Voice `src/index.js:13051`; mobile `hooks/useOrchestrator.ts:1134`, `:1150`, `:1197`, `:1256`, `:1863`, `:3131`, `:3189` — all already bounded at 15 s client-side |

**Consequence Phase 3 must weigh:** a bound placed **inside** `search-knowledge` reaches all three callers. A bound placed **at voice's call site** reaches only voice. **These are materially different blast radii and this plan does not choose between them.**

---

## 8. Rule 15a — test coverage per stage

### Stage 1 — exception APPROVED, with the source

**Granted by Wael on 2026-08-28.** The question was put to him on its own, as three numbered options were not needed — two were — and his answer was `# 1`. The option he selected, verbatim as offered:

> *"1. Approve proceeding without an automated test, with the voice regression suite and a live staging call as the evidence instead."*

**What he was looking at when he answered:** the original Phase 2, which proposed **only** the instrumentation now labelled Stage 1 — timing the four serial calls, timing the uninstrumented members of the parallel block, and the event-loop probe. **Those three items are unchanged in content; only their label changed.** The scope of the approval was stated at the time it was recorded: *"This approval covers this change only — a log-only instrumentation change with no behaviour change."*

**The evidence that replaces a test, by that approval:** the Gate 2 voice regression suite, and a live staging call confirming the turn still works, still speaks, and still says the same thing.

### Stage 2 — exception REQUESTED, awaiting Wael's approval

**Not covered by the approval above, and this section previously claimed it was.**

> **⚠ Corrected 2026-08-28 on Wael's challenge.** This section read *"Stages 1 and 2 — approved exception, granted by Wael 2026-08-28."* **Stage 2 did not exist when he answered** — it was introduced when this plan was restructured *after* he returned the first version. Extending his approval across the restructuring was mine, not his. **An approval given for one change does not travel to a change written afterwards.**

Stage 2 adds a staging-only means of forcing the model for a turn — server-side code, so Rule 15a applies to it.

**Ruled by Wael, 2026-08-28, verbatim:**

> *"My recommendation: APPROVE that Stage 2 test exception. It is staging-only and exists specifically to measure model latency and answer quality; Stage 3 model changes still require proper automated tests."*

**Recorded exactly as written.** It arrived in the same message that approved Phase 2 and directed the work to Phase 3, and it is treated here as his approval.

**⭐ The condition, with the ambiguity removed.** *"Proper automated tests"* is his wording above, and he clarified at the Phase 3 review what it requires: **permanent regression auto-tests that run on every new build** — registered in `tests/runner.ts` so they execute as part of `npm run test:auto`, which is Rule 15a's own requirement. **Not a one-off script run during development and discarded.** The Stage 2 exception does not reach Stage 3.

**The evidence that replaces a test for Stage 2:** the controlled comparison itself — same prompts, both models, minimum 3 trials per case with the full distribution reported, per the Non-Determinism Rule.

**Stage 3 — no exception applies, and none is sought.** Each part changes real behaviour and each is testable:

- **3a** — assertions that the intended model is selected for each turn class, plus the 3-trial-minimum quality evidence the Non-Determinism Rule requires.
- **3b** — assertions that the same context data is assembled after reordering as before it.
- **3c** — assertions that a stalled dependency produces a bounded, reported failure rather than an open wait.

**The approval Wael gave covers Stage 1 only.** It was scoped to a log-only change when granted, and Stage 2 did not exist at the time.

---

## 9. Complexity tax — Rule 23

**Simpler alternative 1 — change the model and ship it.** One line at `:3446`. **Not ruled out; it is Stage 3a.** What is ruled out is doing it *without* Stage 2, because the only comparison available today is confounded and because a model change can meet the latency bar by degrading the answer, which Phase 0 Success Criterion 4 forbids.

**Simpler alternative 2 — add bounds and stop.** **Not ruled out; it is Stage 3c.** What is ruled out is doing it *before* Stage 1, because the amount of in-process delay determines how much a bound is worth — a timer on a blocked event loop fires late — and that quantity is currently unmeasured. **This is a sizing argument, not a claim that bounds would fail.**

**Simpler alternative 3 — instrument everything first and propose improvements later.** **This was the first version of this plan, and Wael rejected it as over-cautious.** It made instrumentation a governance project standing in front of any improvement.

**Simpler alternative 4 — do nothing.** Ruled out by the Product Owner, who set the bar and reported complaints from prospects.

**What this plan's complexity costs:** log statements and one timer in one file; a staging-only model switch; and three independently-approvable changes to code that already exists. **No new table, no new Edge Function, no new background job, no new dependency, no new abstraction layer.**

---

## 10. What this plan does not authorize

**Does not authorize:** writing any code, deploying anything, changing any model in production, or drafting the Phase 3 review.

**Each stage remains separately approvable.** Approving this plan approves the *shape* of the work, not the execution of any stage — and Stage 3a in particular changes what every caller hears and should carry its own explicit go-ahead.

Per Governance §3, Phase 2 → 3 requires Wael's own separate word.
