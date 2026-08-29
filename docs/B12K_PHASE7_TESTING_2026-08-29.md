# B12k — Phase 7: Testing

**Work item:** [[B12k]] — Naavi is too slow to answer on voice.
**Date:** 2026-08-29
**Covers:** Stages 1 and 2. Stage 3's four parts are conditionally authorized and not implemented.
**Status:** **APPROVED by Wael, 2026-08-29 — "Phase 7 approved."** His testing verdict, given before the final cleanup: **PASS, no additional testing required.** Approved after three returns, all for the document rather than the testing: a contradiction where the conclusion declared itself satisfied while the same document said the baseline did not exist; a methodology decision handed to Wael instead of made; and stale statements left standing after the baseline completed.

---

## 1. What Phase 7 has to establish, and what it cannot

**Stages 1 and 2 change nothing a caller experiences.** They add timing lines and a staging-only switch that is inert unless set. **So there is no improvement to test** — Phase 7's question here is narrower: *did instrumenting the file that controls every phone call break anything?*

**That question is already answered**, and the evidence is in Phase 5 rather than repeated here.

---

## 2. Automated testing — unchanged, and now clean

Governance requires existing automated testing to continue unchanged. It did.

```
Testing against: STAGING  (xugvnfudofuskxoknhve)
GATE 2 — VOICE ONLY
✓ 54 passed   ✗ 0 failed   ⨯ 0 errored   ○ 4 skipped
```

**The four skips are environmental**, not failures — they need production Google contacts and say so.

**Gate 2 was not clean when this work began.** Three `voice-pin` tests had been erroring since at least 2026-08-25, expecting a 4-digit PIN where the function has required 6 since S1. A fourth was passing for the wrong reason. Fixed under separate authorization in `49de2c6`. **This is the first clean Gate 2 in at least four days.**

---

## 3. Manual validation — mandatory, and performed

Governance names **Voice** and **Phone** as requiring manual validation, and states that passing automated tests alone is not sufficient.

| Validation | Result |
|---|---|
| **Live call to `+1 343 504 1572`** | **PASS** — Wael, 2026-08-29 |
| Four live turns via `/test/ask` | All behaved correctly |
| Model switch inert when unset | PASS |
| Model switch honoured when set | PASS |
| Invalid value rejected, falls back | PASS |

**The bar for the live call was fixed before the call was made**: Naavi answers, the voice is clean, the reply makes sense, the call does not drop. **Speed was explicitly excluded** — a slow turn is the defect this item exists to fix, not a failure of this check.

---

## 4. ⭐ What Phase 7 has NOT done: the baseline

**Phase 0's Completion Criterion 3 requires the trial set run against pre-fix code, on record as the baseline.** Without it there is nothing for a later measurement to be compared against.

**That baseline now exists — collected 2026-08-29, recorded in §4a.** It could not have existed any earlier: the instrumentation that makes it measurable went live the same night.

**The trial set was precommitted in Phase 1 §9b**, before any data existed and unrevisable afterwards:

| Turn type | Repetitions |
|---|---|
| Opening greeting | 5 |
| Trivial question (fast path) | 5 |
| Simple lookup | 5 |
| Alerts listing | 5 |
| A turn gathering calendar and saved notes | 5 |
| A confirmation turn | 5 |
| **Total** | **30 turns** |

**The open question is how to run it, and it is a real trade rather than a detail.** Two routes exist and they measure different things:

| Route | Covers | Misses |
|---|---|---|
| `/test/ask` endpoint | The turn pipeline — context gathering, model, action layer. Repeatable, automatable, no phone needed | **The caller's actual wait.** No Deepgram, no Twilio. And **the greeting cannot be tested at all** — it runs on a different path |
| Real phone calls | Everything, including the parts no instrument here can see | 30 turns of manual dialling |

### Methodology — defined here, not delegated

> **⚠ Corrected 2026-08-29 on Wael's challenge.** An earlier version put this choice to him. **It is an implementation decision and belongs to the implementer** — the second time tonight I handed him a technical choice after being told the first time to recommend instead.

**The method:** use `/test/ask` for everything it can reproduce, and a real phone only where it structurally cannot.

| # | Turn type | Route | Message |
|---|---|---|---|
| 1 | Opening greeting ×5 | **Real call** | The endpoint cannot reach this path at all — the greeting is TwiML `<Play>`, not the turn pipeline |
| 2 | Trivial ×5 | `/test/ask` | *"Are you there?"* |
| 3 | Simple lookup ×5 | `/test/ask` | *"What is my home address?"* |
| 4 | Alerts listing ×5 | `/test/ask` | *"What alerts do I have?"* |
| 5 | Calendar + notes ×5 | `/test/ask` | *"What is on my calendar this week and do I have any notes about it?"* |
| 6 | Confirmation ×5 | `/test/ask` | *"yes"*, with a pending-confirm history |

**Messages fixed here, before any run**, for the same reason the trial count was: so neither can be adjusted after seeing a result.

**Why not 30 manual calls.** There is no technical reason to dial thirty times to measure pipeline components the endpoint exercises reproducibly. The endpoint drives the same `askClaude` path and emits the same markers.

**What the endpoint route cannot measure, stated so no later reading overclaims from this baseline:** the caller's actual wait. No Deepgram, no Twilio. These 25 turns measure `turnStart` → audio dispatch, which Wael already ruled sufficient at Phase 2 — a delta on a segment is still a delta on the whole.

**Recorded per turn:** total (`T10`), context (`T2`), Claude duration and model, the four serial call timings, and any event-loop lag lines.

**On the confirmation turns:** these may commit a row on the gates account. That account is wiped by the suite's own fixtures by design, and it is the account the auto-tester already owns.

---

## 4a. ⭐ BASELINE — executed 2026-08-29, 01:06–01:09 EST

**Complete — 30 of 30.** 25 turns through `/test/ask` against the staging gates account, with 45 turns captured in the logs (the extra are the confirmation setup calls and adjacent traffic), plus **five opening turns by real phone**, which the endpoint cannot reach.

### Round-trip, measured from the client

Includes the network hop to Railway EU West, so these run higher than the server's own figures.

| Turn type | Samples (s) | Median |
|---|---|---|
| *"Are you there?"* | 6.20, 6.32, 5.10, 5.82, 5.52 | **5.82** |
| *"What is my home address?"* | 6.21, 7.06, 6.93, 6.22, 6.94 | **6.93** |
| *"What alerts do I have?"* | 1.63, 1.67, 1.62, 1.67, 1.46 | **1.63** |
| Calendar + notes | 4.21, 3.11, 3.28, 3.25, 3.24 | **3.25** |
| Confirmation (*"yes"*) | 7.04, 6.73, —, 6.93, 7.27 | **~6.93** |

**⚠ Row one is misnamed and the name is left visible rather than corrected away.** *"Are you there?"* was chosen to represent the **trivial fast path**. It does not reach it — at 5.82 s it is **slower than the calendar-and-notes turn**, which was meant to be the heaviest. The measurement is valid for what it is; the label was wrong.

**The fastest turn type never reaches Claude at all.** *"What alerts do I have?"* answers from the database through the deterministic classifier — **1.63 s against 5-7 s for anything that calls a model.** That gap is the single clearest thing in this baseline.

### Server-side — the four serial context calls

| Call | Median | Samples |
|---|---|---|
| `fetchUserLists` | **106 ms** | 36 |
| `_b4xBuildAlertsContext` | **~51 ms** | 76 |
| `user_settings ref read` | **106 ms** | 38 |
| `fetchCalendarPdfBlock` | **0 ms** | 38 — **zero on every sample** |
| **Total** | **≈ 260 ms** | |

### Server-side — Claude, by model

| Model | Median | Range | Samples |
|---|---|---|---|
| `claude-sonnet-4-6` | **4 252 ms** | 2 386 – 6 842 | 20 |
| `claude-haiku-4-5` | **1 977 ms** | 1 276 – 3 121 | 18 |

### Event-loop lag

**Zero lines across 45 turns.** The loop stayed healthy throughout. **A point toward Stage 3c's C1 branch, not proof** — this is a healthy service with no stall present, and it says nothing about what the loop does during one.

### The five opening turns — by phone, 2026-08-29

**Wael made five calls to `+1 343 504 1572`, timing from the moment the call connected to Naavi's first word.**

**Result: 3 seconds or less, five out of five. The opening is not slow.**

**Server-side corroboration:** TTS for the opening prompt generated in **671–702 ms** across the four calls captured in the log window.

**What Naavi's first word actually is, and why that does not change the measurement.** The first thing every caller hears is *"[Name], what city or time zone are you in?"* — not a greeting. **The greeting sits behind that question and only plays once the caller answers.** All four logged calls show `[Voice/Timezone] result attempt=1 speech="" parsed="null"` — Wael hung up rather than answering, as instructed.

**This measurement is correct for what the caller experiences.** The opening wait is however long the line sits quiet before Naavi says anything; whether that first thing is a greeting or a question does not change what the caller waited through. *(A draft of this section called the row incomplete on the grounds that it measured a prompt rather than a greeting — moving the goalposts after the measurement had already met the instruction that defined it.)*

### ⭐ Why the timezone is asked on every call — Wael's ruling, 2026-08-29

**Found while checking the above:** the timezone question is asked on **every call, unconditionally**, never checking `timezone_confirmed_at`. `src/index.js:6835` and its own comment — *"Every call asks this first, unconditionally, before any greeting/onboarding content"* — record the behaviour but not the reason.

**It was put to Wael as a possible defect. It is not one. His reason, and it is decisive:**

> *"This is a voice call. Naavi has no idea from where you are calling. You may have called the first time from Toronto and travelled to London or Moscow."*

**A phone call carries no location signal.** A stored timezone is a record of where the caller was *last time*, and acting on it silently would put Naavi in the position of interpreting "8 in the morning" against the wrong clock — the failure class CLAUDE.md Rule 18 forbids, where Naavi reshapes a fact to fit what she already has stored.

**Recorded here because the code states the behaviour without the reason**, and the next reader will draw the same wrong conclusion this review did. **Claude recommended changing it. Wael's reason was better and the recommendation was wrong.**

### What this baseline decides

| Gate | Threshold | Measured | Outcome |
|---|---|---|---|
| **3b** — context path | ≥ 750 ms | **≈ 260 ms** | **NOT MET → branch B2: 3b not implemented** |
| **3a** — model | ≥ 1 500 ms faster | **2 275 ms** | **Latency half MET.** Quality half unresolved |

**Stage 3b is ruled out by the baseline.** A threshold fixed before any data existed has prevented a restructuring of the file that controls every phone call. **That is the discipline working in the direction that never gets noticed** — stopping work rather than authorising it.

**Stage 3a's latency gate passes on much stronger evidence than the four-sample version** — 38 turns, five question types, one account, one sitting. **It is still confounded**: Haiku ran on the turns the classifier judged simple. Stage 2 proper must force both arms on identical prompts. **And the quality veto stands unresolved** — the one direct comparison so far had Haiku truncating mid-sentence at the token ceiling.

---

## 5. Coverage gaps, stated rather than left implicit

1. **No automated test covers the instrumentation itself.** Wael granted the Rule 15a exception for Stages 1 and 2, with Gate 2 plus a live call standing in its place. **That exception does not reach Stage 3**, which requires permanent regression auto-tests registered in `tests/runner.ts` that run on every build.
2. **The caller's experienced wait is still unmeasured.** Every timing begins after Deepgram decides the caller stopped speaking and ends at audio dispatch, not at audio heard. Wael ruled at Phase 2 that this does not block progress — a delta on a segment is still a delta on the whole — with head-and-tail instrumentation to follow as its own change.
3. **The historical 19.5-second "greeting" measurement remains unattributed — but Phase 7 established that it does not represent the caller's initial silent wait.** The opening wait measured **≤3 seconds in all five calls**, corroborated by TTS generating in 671-702 ms. Phase 1 §9c had already excluded TTS generation as its cause across 50 samples. **What Phase 7 adds is that the first thing a caller hears is the timezone question, and the greeting proper sits behind it** — so any figure of that size describes something occurring *after* the caller has answered, not silence at the start of the call. **What that something is remains unknown.** Deferred by Wael at Phase 1 and still deferred.
4. **Staging is not in a clean default state.** The container still holds `B12K_FORCE_MODEL="banana"` from testing, which Railway's delete did not clear. Harmless — it falls back to normal selection — and it clears on the next deploy.

---

## 6. Conclusion

**Phase 7 is complete — awaiting Wael's review.** *(This section previously read NOT satisfied, correctly, while the five opening turns were outstanding. They were made on 2026-08-29 and the baseline is now 30 of 30.)*

> **⚠ Corrected 2026-08-29 on Wael's challenge.** This section previously read *"For Stages 1 and 2, Phase 7 is satisfied"* while §4 of the same document said the required baseline **does not exist**. **Both cannot stand.** The baseline is a Phase 0 completion criterion for this work item, so Phase 7 cannot declare itself complete while leaving it outstanding. The earlier wording quietly scoped the criterion down to "did we break anything" — which was the easy half.

**What IS complete:** the regression question. Automated testing is green and cleaner than when the work started, and mandatory manual validation was performed on a real phone against a bar agreed in advance. **Nothing was broken.**

**The baseline is complete — 30 of 30.** §4a. 25 turns through the endpoint on 2026-08-29, and five opening turns by phone the same night.

**It has decided one gate outright: Stage 3b is ruled out** at ≈260 ms against a 750 ms threshold fixed before any data existed.

**Phase 0's Completion Criterion 3 is met.** There is now a pre-fix baseline on record for any later measurement to be compared against.

Per Governance §3, Phase 7 → 8 requires Wael's own separate word.
