# B12k — Stage 3: Phase 7 Testing

**Work item:** [[B12k]] — Naavi is too slow to answer on voice.
**Date:** drafted 2026-08-29, **completed 2026-08-30** when the outstanding phone call was made.
**Covers:** **Stages 3a and 3c.** 3b ruled out by the baseline; 3d closed by Wael.
**Status:** **STAGE 3 VALIDATION — PASS. OVERALL PHONE-TEST BAR — NOT MET**, due to observed pre-existing, out-of-scope defects. **Approved by the reviewer** on that split verdict, after one return; **accepted by Wael, 2026-08-30**, who then accepted the out-of-scope failures at Phase 8. **Phase 7 never self-declared completion** — see §7.

> **⚠ Corrected 2026-08-30 on the reviewer's return.** This line previously read **"COMPLETE"**, and §7 concluded *"Phase 7 is complete."* **That silently converted a failed overall bar into a pass.** §5 had already found the right answer — *"the bar is met for what Stage 3 changed, and is not met for the call as a whole"* — and the conclusion then discarded the second half. **A precommitted bar cannot be reinterpreted after the result is known to mean "the part my change touched."** The reviewer's ruling: Stage 3 must not FAIL for defects outside it, **and** the overall bar must not be recorded as met when it was not. Both halves are now stated separately, and the acceptance decision is left with Wael where it belongs.

**Governance note on the draft.** An earlier version of this document was reviewed and approved while it still recorded the phone call as outstanding. **The call result below is new evidence added after that approval.** It is recorded here rather than treated as already reviewed, and §6 states what that means for Phase 8.

---

## 1. What Phase 7 has to establish

Governance §3: existing automated testing continues unchanged, and **manual validation remains mandatory** for Voice and Phone. *"Passing automated tests alone is not sufficient."*

Stage 3 changed two things a caller experiences:

- **3a** — five check-in phrases now take the trivial fast path, so they get a different model **and** skip calendar and knowledge context.
- **3c** — three outbound calls are bounded at 10 seconds, changing failure behaviour only.

---

## 2. Automated testing — unchanged, and green

```
Testing against: STAGING  (xugvnfudofuskxoknhve)
GATE 2 — VOICE ONLY
✓ 59 passed   ✗ 0 failed   ⨯ 0 errored   ○ 4 skipped   (63 tests)
```

**Five new permanent tests are inside that total**, registered in `tests/runner.ts`. The four skips are environmental — they need production Google contacts and say so.

**One is behavioural rather than a source check.** `b12k.bounded.fires-against-a-server-that-never-responds` stands up a local server that accepts a connection and never answers, and asserts the bound fires — the injected-delay validation Phase 3 specified, needing no stall to recur.

---

## 3. Manual validation

### 3a. Through the test endpoint

| Check | Result |
|---|---|
| Check-in is faster | *"Are you there?"* **6.76 s → 3.05 s** |
| It takes the fast path | `[askClaude] Trivial query — skipping calendar & knowledge fetch`, then `T5 … model: claude-haiku-4-5` |
| **The guard holds** | *"What is my home address?"* still routes to **Sonnet**, still answers *"I don't have your home address saved… only your work address"* |
| Bound fires end-to-end | Injected at 1 ms; `BOUND FIRED` logged, and the answer observed |
| Failure answer is honest | *"I don't have that information in your records…"* — **word-for-word identical** to the same question with the lookup succeeding |
| Staging restored | Bound back at 10 s, injected variables deleted, container redeployed, lookups succeeding |

**The guard is the important line in that table.** A widened fast path would have sent the home-address question to Haiku, which was measured answering it with the **work** address, three times out of three.

### 3b. ⭐ On a real phone — performed 2026-08-30

**Three calls were placed to the staging number `+1 343 504 1572`. Two produced no turn at all; the third exercised Stage 3 fully.**

#### Calls 1 and 2 — the test did not run

Both connected and both dropped without Naavi answering. The logs show why, and it is not Stage 3:

```
[B10m-diag] Audio level over last 100 frames: avg amplitude 0
[B10m-diag] Results msg … transcript=EMPTY
[Deepgram] Watchdog: no transcript after 6s with 385 frames — reconnecting (attempt 1)
[Deepgram] Watchdog: no transcript after 6s with 700 frames — reconnecting (attempt 2)
[Deepgram] Watchdog: silent hang detected but reconnect limit reached
[MediaStream] Twilio disconnected — code: 1005
```

**Twilio delivered hundreds of frames carrying silence.** Zero amplitude on 20 of 24 readings, `transcript=EMPTY` every time. **Because no transcript was produced, `processUserMessage` never ran, so `askClaude` never ran, so nothing Stage 3 changed could execute.** The test did not fail; it did not run.

Wael confirmed nothing changed on his end — same handset, no speakerphone or headset change. **This matches the existing `project_naavi_audio_focus_race` memory ("listens but captures nothing"), and the `[B10m-diag]` amplitude instrumentation that made it visible was already in the code**, which indicates prior investigation. **It did not recur on the third call and is not explained here.**

#### Call 3 — what actually happened, in order

The call opened on the **timezone onboarding flow**, because the staging account has no timezone set:

| Step | Observed |
|---|---|
| 1 | *"Wael, what city or time zone are you in?"* |
| 2 | Caller: *"Easter time."* → not parsed |
| 3 | *"Sorry, I didn't catch that. What city or time zone are you in?"* |
| 4 | Caller: *"Eastern Time."* → parsed `America/Toronto`, confirmed |
| 5 | Greeting: *"Nah-vee here, how can I help you Wael?"* |
| 6 | **Stray turn** — see Defect 1 |
| 7 | **"Are you there?"** → answered in **2 411 ms** — see below |
| 8 | **"What is on my calendar this week?"** → see Defect 2 |
| 9 | Caller hung up during the answer |

#### ⭐ Stage 3a on a real phone — the result this document was blocked on

```
===== [VOICE-TURN-START] text="Are you there?" =====
[Timing] T0 processUserMessage entered +0ms
[askClaude] Trivial query — skipping calendar & knowledge fetch
[Timing] T5 Claude API call start +462ms (model: claude-haiku-4-5-20251001)
[Timing] T5a Claude first byte +1713ms
[Timing] T6 Claude stream complete +1945ms (stop=end_turn)
[Claude] Speech: "I'm here. How can I help you, Wael?"
[Timing] T7 askClaude returned +2411ms (with pre-generated audio)
```

**Both halves of Stage 3a are visible in that log**: the fast path was taken (`skipping calendar & knowledge fetch`) and Haiku was selected. The answer was correct, complete, and spoken cleanly — no cut-off, no dead air, no drop. **`stop=end_turn`**, so it was not truncated at the token ceiling, which was the quality failure that vetoed widening the fast path further.

**2 411 ms end to end on a real call**, against 4 449 ms for the ordinary turn that followed it in the same call.

#### ⭐ Deploy proof — behavioural, not inferred

**The per-turn `commit=` marker printed `c248cc2`, which is a hardcoded April literal** — Architecture Reference §0d warns it proves nothing, and it is four months older than this work.

The deploy is proven a different way. **Before Stage 3a, `trivialRe` did not contain "are you there"** — verified by diffing `e2dcb0f..fb6546c`, where the phrase appears only on the added line. **The log shows that phrase taking the trivial branch**, which is only possible on code at `2583b9c` or later. **Stage 3a is running on staging**, established from behaviour rather than from a successful push.

#### 3c on a real call

**All three bounded sites executed during call 3 and none misbehaved:**

| Site | Observed |
|---|---|
| `tts-play deepgram` | Four times — `ms=400`, `407`, `413`, `411` |
| `searchKnowledgeSpecific` | `total 2123ms (network 2123ms, 0 fragments)` |
| `LIST_RULES manage-rules` | Completed and returned a result |

**No bound fired, because nothing stalled.** That is the expected outcome — the bound changes failure behaviour only, and its firing was validated by injection in Phase 5.

---

## 4. ⚠ Two defects the call exposed — neither is Stage 3's

### Defect 1 — a confirmation prompt that names nothing

Immediately after the timezone confirmation, Deepgram captured a stray **"Yes."** as the first streamed turn. With no pending action, Claude emitted `SET_ACTION_RULE`; the B4y Phase 2 gate correctly dropped it and substituted:

```
[Claude] B4y Phase 2: dropped [SET_ACTION_RULE] — not a valid confirm-turn. userText="Yes."
[Claude] Speech: "I need your confirmation before I can make that change. Please say yes to confirm."
```

**The gate did its job. The message it produces names nothing**, which is the [[B4z]] shape already tracked — the guard enforcing Rule 12 emits a sentence that fails Rule 12's own readback requirement. **Whether the stray "Yes." was an echo of the timezone confirmation or a second utterance is not established** and is not asserted here.

### Defect 2 — a calendar question answered with alerts

```
[Timing] fetchLiveCalendarEvents — 902ms, 3 event(s) from 4 calendar(s)
[Claude DIAG] text-block (46 chars): "I'll read your next few events from this week."
[Claude DIAG] tool_use name=list_rules jsonStr (0 chars):
[GATE-CRITICAL] final_speech="You have no alerts set up yet." speech_modified=true action_types=["LIST_RULES"]
```

**The caller asked about his calendar, his calendar was fetched successfully with 3 real events, and he was told about alerts.** Two failures stacked: the model called the wrong tool with an empty payload, and **the action handler then overwrote a correct sentence** — *"I'll read your next few events from this week"* — with an unrelated one.

**This is not B12k's.** Calendar-listing queries have routed to Haiku since **2026-04-26** (`382e56b`, "PC latency fix — calendar-listing → Haiku"), four months before this work item. **Stage 3's diff touches no model-selection line**: `git diff e2dcb0f..HEAD -- src/index.js` filtered for `haiku`, `sonnet`, `calendarListRe` and `isCalendarListing` returns nothing.

**Ruled by Wael, 2026-08-30, under Rule 1b: not tracked.** His reason: *"i Must be sure, one test does not justify creating a new items."* **No holding-list item was created.** The evidence is preserved here so a second sighting starts from this one rather than from scratch.

---

## 5. The pass bar, assessed honestly

**The bar was fixed in this document before the call**, and read: *she answers both; the voice is clean, with no cut-off or garbled audio; the answers make sense; the call does not drop.*

| Clause | Result |
|---|---|
| She answers both | **Met on call 3.** Not met on calls 1 and 2, where no turn ran |
| Voice clean, no cut-off | **Met** — `stop=end_turn`, audio dispatched and marked complete |
| The answers make sense | **Met for the check-in. NOT met for the calendar turn** — Defect 2 |
| The call does not drop | **Met on call 3.** Calls 1 and 2 dropped |

**Stated plainly: the bar is met for what Stage 3 changed, and is not met for the call as a whole.** The check-in turn — the only turn whose behaviour Stage 3a altered — passed every clause. The failures sit on the audio-capture path and on a four-month-old routing decision, both outside this change. **Recording this as an unqualified pass would be false**, and recording it as a Stage 3 failure would be equally false.

---

## 6. Coverage gaps, stated rather than left implicit

1. **No bound has fired in production.** No stall has recurred since instrumentation landed, so the bound's real-world behaviour is validated by injection only. Phase 3 accepted that explicitly — waiting for a rare event before protecting against it was struck down at gate C3.
2. **The two other knowledge paths remain unbounded.** `fetchAllKnowledge` and `arch1HandleMemorySearch` reach the same Edge Function and have no bound. Phase 3 authorized three specific sites; this is outside that authorization and is recorded, not fixed.
3. **The caller's experienced wait is still unmeasured.** Every timing begins after Deepgram decides the caller stopped speaking and ends at audio dispatch. Deferred by Wael to [[B12m]].
4. **Only one of the five moved phrases was spoken on a real call.** *"Are you there?"* was tested; *"are you still there"*, *"are you listening"*, *"can you hear me"* and *"you there"* are covered by the regression suite against the live regex, not by a phone.
5. **The silent-audio failure is unexplained.** Two of three calls produced no transcript. It is recorded, not diagnosed, and no item was opened for it.
6. **This document gained its central evidence after its first approval.** **§3 of Stage 3's Phase 8** declares that, and this return has now put the call result back in front of the reviewer regardless.

---

## 7. Conclusion

**Automated testing: complete and green.** 63 tests, 59 passed, 0 failed, 0 errored, against STAGING.

**Manual validation: complete.** Stage 3a was exercised on a real phone call, took the fast path, selected Haiku, and answered correctly in 2 411 ms with no truncation and no drop. All three of Stage 3c's bounded sites ran on the same call without incident. The deploy is proven behaviourally rather than assumed.

**Two defects were exposed and neither belongs to Stage 3.** One is the existing B4z shape; the other predates this work item by four months and was ruled untracked by Wael on the strength of a single observation.

### The two statuses, kept separate

| | Verdict |
|---|---|
| **Stage 3 validation** | **PASS.** Every clause of the bar held for the turn Stage 3a changed and for all three of Stage 3c's bounded sites |
| **Overall phone-test bar** | **NOT MET.** Two of three calls dropped with no turn, and the calendar turn's answer did not make sense |

**Stage 3 does not fail for defects outside it** — the diff evidence in §4 is the grounds, and the reviewer accepted it. **And the overall bar is not recorded as met, because it was not.** Both statements are true at once; collapsing them into one verdict loses whichever half is inconvenient.

### What this leaves to be decided

**Phase 7 does not declare itself complete.** The open question is a governance one and it is Wael's:

> **Are the two out-of-scope failures — the silent-audio drops and the calendar-routing defect — accepted, so that Phase 8 may proceed on a Stage 3 validation that passed?**

**⭐ ANSWERED at Phase 8 — Wael, 2026-08-30: "accepted."** The reviewer recommended acceptance and the decision was his.

**Accepting them does not retire them.** The calendar-routing defect stays untracked under his separate Rule 1b ruling; the silent-audio failure stays unexplained and untracked. **§4 and §6 hold the evidence so a second sighting starts from it.**

Per Governance §3, Phase 7 → 8 requires Wael's own separate word.
