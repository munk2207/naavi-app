# B11f — Phase 3: Technical Review Prompt (Before Coding)

**Work item:** [[B11f]] — pause and resume on a voice call
**Date:** 2026-08-21
**Risk:** MEDIUM (Protected Core) — which is why this review is mandatory
**No code exists yet.** The objective of this phase is to prevent an incorrect solution before it
is written.

**Documents to review:**
- Phase 0 — `docs/B11F_PHASE0_INTENT_2026-08-21.md`
- Phase 1 — `docs/B11F_PHASE1_PROBLEM_DEFINITION_2026-08-21.md`
- Phase 1A — `docs/B11F_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-08-21.md`
- **Phase 2 — `docs/B11F_PHASE2_CHANGE_PLAN_2026-08-21.md`** ← the plan under review
- Architecture Reference — `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, version
  `2026.07.18.7`

---

## 1. What this work item is, in one paragraph

B11f (pause mid-answer on a phone call, resume where she left off) **already works on voice
staging** and was confirmed on a live call by Wael on 2026-08-20. It is **held back from
production** for two reasons: its re-implementation went in without governance phases, and its
mechanism has no automated tests. This work item is **behaviour-preserving hardening** — make the
working implementation testable and complete its governance record. It is **not** another
implementation attempt, and it does not change what pause or resume do.

---

## 2. What is proposed

Extract two pure functions out of the WebSocket connection handler in
`naavi-voice-server/src/index.js` into a new module `src/voice/resumePoint.js`, then test them.

- **`resumePointOf(held)`** — moves **verbatim**. Already pure: reads only `held.text` and
  `held.bytesSent`. Decides where a resumed answer restarts, by scanning to the sentence being
  spoken and then deliberately backing up one more.
- **`bytesSpokenSoFar()`** — identical arithmetic; its four closure variables
  (`usingPreGenAudio`, `lastTtsBytes`, `audioDispatchedAt`, `preGenTotalBytes`) become one `state`
  argument, plus an injectable `now` defaulting to `Date.now()` so the elapsed-time branch is
  testable without sleeping.

`holdAnswer` and `endSpeech` are **deliberately not extracted** — see §5 question 4.

---

## 3. Why this is being done at all

The feature broke once already, in production-shaped conditions, after passing four governance
gates, 102 tests and two external reviews. Both root causes were invisible to the suite:

1. `isPauseCommand()` was called twice and never written — a `ReferenceError` on the line before
   the transcript handler.
2. `processUserMessage` forks, and the first implementation instrumented only the `speak()` branch
   while most answers take the pre-generated `sendAudioToTwilio` branch — which is why it looked
   intermittent.

The 17 existing tests cover only the **word vocabulary**, which is root cause 1's territory. **Root
cause 2 remains uncovered today, as does everything that decides what the caller actually hears on
resume.** All four functions are closures inside the connection handler, so nothing can import
them.

---

## 4. Please evaluate, per governance Phase 3

- **Assumptions**
- **Architecture**
- **Isolation**
- **Hidden coupling**
- **Implementation strategy**

---

## 5. Specific questions where a second opinion is most valuable

**1. Is the `now` parameter the right way to make the elapsed-time branch testable?**
It is the only signature change being introduced. The alternative is a fake timer library, which
adds a dependency to a repo that has none for this. Is a defaulted injectable clock the right call,
or does it constitute production code shaped by test convenience?

**2. Is `state` as a single object argument correct, or should the four values be separate
parameters?**
An object means the call site passes a literal built from closure variables. Separate parameters
mean a four-argument call where two are numbers and one is a timestamp — easy to transpose
silently. Neither is obviously right.

**3. Is extracting only two of four functions a coherent boundary, or a half-measure?**
After this change, `resumePointOf` and `bytesSpokenSoFar` live in a module while `holdAnswer` and
`endSpeech` — same mechanism, adjacent lines — stay in the handler. **Is that a defensible seam, or
does splitting one mechanism across two locations create the kind of confusion the project's
Configuration Discipline rules exist to prevent?**

**4. Is the reasoning for NOT extracting `holdAnswer` and `endSpeech` sound?**
The argument (Phase 2 §2.4): both *mutate* per-call closure state rather than computing a value, so
extracting them means inventing a mutable state object shared with the handler — new abstraction,
which the project's Rule 19 asks to justify, and more risk than the tests would buy. **Is that
sound, or is it rationalising the harder half away?** Note the consequence: `holdAnswer` stores
what `bytesSpokenSoFar` computes, so it remains untested directly.

**5. Is MEDIUM the right risk classification?**
Medium not Low: it edits Protected Core and the exact path that broke conversation in July. Medium
not High: each extracted function has exactly one call site (verified by search), one moves
verbatim, and the original failure mode — calling a function nobody wrote — is now caught by a
`no-undef` pre-push hook added the same day. **Is that calibrated correctly?**

**6. Is anything missing from the regression analysis?**
The consumer trace found `bytesSpokenSoFar` and `resumePointOf` have **one caller each**, both
inside the same file, neither crossing a module, repo or network boundary. **Is there a coupling
this misses** — for instance through the shared closure state the extracted functions currently
read directly and will afterwards receive as arguments?

---

## 6. One finding from Phase 1 you should see, though it is NOT in scope here

**B11f is not additive — it replaces an open interruption mechanism with a closed vocabulary.**

| | Production (`main`) | Staging (`B11f`) |
|---|---|---|
| How to interrupt | **say anything at all** | say a recognised word |
| Background noise silences her | yes — the defect B11f fixed | no |
| If the word is misheard | n/a — any word works | **no way to interrupt** |

`pauseCommand.js` documents the risk against itself: Deepgram renders "naavi stop" as *"stop by
actions penny threads"* on 8 kHz mulaw audio.

**Wael has already ruled that this belongs to the production-promotion decision, not to this
hardening work.** It is included so you are not evaluating the plan without knowing it — **not as a
question for this phase.** Please do not fold it into the Phase 3 verdict.

---

## 7. Required output

Per §13's Mandatory Review Gates:

- **Decision:** Approved / Approved with Mandatory Changes / Rejected
- No numeric scores.

And per Phase 3's **Implementation Boundaries Confirmed** requirement, please close with an
explicit statement — not an inference from the discussion above — of:

- **Which files are authorized, and the specific change in each.**
- That **no additional files** are approved beyond those listed.
- That **no opportunistic refactoring** is approved.
- That **no architectural changes** are approved beyond what the plan describes.
- **Which parts of the plan, if any, are explicitly excluded** from this authorization.

That statement becomes the boundary Phase 4 implements against and Phase 6 audits against.
