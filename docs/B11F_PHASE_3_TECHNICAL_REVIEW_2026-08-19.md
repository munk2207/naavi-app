# Phase 3 — Technical Review (Before Coding) — B11f — Pause and Resume on Voice

**Date:** 2026-08-19
**Governance version:** v4.0
**Reviewer:** ChatGPT (External Technical Reviewer, governance §1)
**Revision 2** — this record covers the **re-review at the pause/resume scope** and supersedes the first Phase 3 (cancel scope), which is in git history.
**Plan reviewed:** `docs/B11F_PHASE_2_VOICE_STOP_CONTROL_2026-08-19.md` Revision 2
**Status:** Both mandatory changes incorporated below. **Awaiting Wael's explicit go-ahead for the Phase 3 → 4 transition.**

---

## 1. Decision

**APPROVED WITH MANDATORY CHANGES.**

Carried over unchanged and re-confirmed at the new scope: the root cause, the two-sender analysis, the per-connection generation counter, generation-tagged state sequencing, and full-text/interrupted history.

**The resume estimate was explicitly approved**, and the reasoning is worth preserving because I could not judge it myself, having argued both sides:

> *"Using `bytesSent` to assert what Robert heard would create false history. Using it only to select a conservative resume point is different: uncertainty results in repetition, not false stored information or skipped content."*

Sentence-by-sentence TTS was rejected for the reason Phase 2 gave: a permanent gap and round-trip cost on **every** answer, to serve a relatively uncommon event.

**Pause-during-thinking (§4.7) approved**, with processing still completing — only playback is suppressed.

## 2. Mandatory Change 1 — remove `wait` and `hold on` from the pause vocabulary

> *"They are too easily part of a new request: 'wait, what about Tuesday?' or 'hold on, change that to Friday.'"*

**Accepted.** This is the same conservative principle already applied to `ok`, `thanks`, `got it` and `next` — and I had flagged these two in the review prompt for exactly this reason.

**Final vocabularies:**

| Intent | Words |
|---|---|
| **Pause** | `stop`, `naavi stop`, `pause`, `enough`, `that's enough` |
| **Resume** | `continue`, `go ahead`, `carry on`, `keep going`, `resume`, `you were saying` |
| **Cancel** | `cancel`, `forget it`, `never mind`, `drop it` |

**The asymmetry is deliberate.** Pause words must be unambiguous, because a false pause silences Naavi when the caller wanted an answer. Resume and cancel words can be looser, because **they are only recognised while an answer is held** — outside that state they fall through as ordinary speech and reach Claude normally.

## 3. Mandatory Change 2 — the three races, guarded explicitly

> *"`heldAnswer` / `holdNextReply` must be consumed or cleared before starting the corresponding transition so stale timers/events cannot resurrect it."*

**One principle covers all three: consume, then act.** Never act on a piece of state that is still readable by something else. This is the same rule that makes `maybeReleaseDeferred()` exactly-once — clear `deferredText` *before* processing it — so the file gains a consistent discipline rather than three ad-hoc guards.

### 3.1 Race A — a pause arriving between processing finishing and playback starting

**The hazard.** `isProcessing` goes false, then a few lines later `isSpeaking = true` and audio begins. **In that window neither flag is set.** Phase 2 §4.7 keyed the hold on `isProcessing && !isSpeaking`, so a pause word landing in the gap sets nothing, finds no audio to cancel — and Naavi speaks. **That is the privacy criterion failing in the exact scenario the feature exists for**, and it would have been very hard to reproduce deliberately.

**Guard — bind the hold to the turn, not to a flag.**

```js
let currentTurnId  = 0;      // ++ on entering processUserMessage
let holdReplyForTurn = null; // set by a pause word

// pause word, at ANY time:
holdReplyForTurn = currentTurnId;     // covers the gap — no state check at all

// at the speak site:
if (holdReplyForTurn === thisTurnId) {
  holdReplyForTurn = null;            // consume FIRST
  heldAnswer = { text: speech, bytesSent: 0, at: Date.now() };
  // no audio
}
```

Because the flag records *which turn* was paused, the gap disappears — there is no moment in the turn where a pause word is not attributable. And a pause word said while idle attaches to the **completed** turn, so the caller's *next* question is not silently swallowed.

### 3.2 Race B — a resume arriving while another answer is already playing

**Largely closed by design**: any non-resume, non-cancel utterance discards the held answer, so once a new question is accepted there is nothing to resume. **The residual risk is timing** — the discard must happen when the new utterance is *accepted for processing*, not when its answer begins, or a resume word could arrive in between and revive an answer the caller has moved on from.

**Guard:** discard at acceptance, and consume atomically on resume.

```js
const held = heldAnswer;
heldAnswer = null;            // consume FIRST
clearTimeout(heldExpiryTimer);
if (held) speakRemainderOf(held);
```

### 3.3 Race C — expiry firing during a resume

**The hazard.** The five-minute timer fires while a resume is already in flight: it clears state and amends history to "interrupted" for an answer currently being delivered. History would then contradict what the caller actually heard.

**Guard:** the consume-first pattern in §3.2 already closes it — the expiry timer is cleared and `heldAnswer` nulled *before* playback starts, so a late-firing timer finds `null` and no-ops. The timer callback must also re-check rather than assume:

```js
heldExpiryTimer = setTimeout(() => {
  if (!heldAnswer) return;            // already consumed — do nothing
  const expired = heldAnswer;
  heldAnswer = null;
  markInterruptedInHistory(expired);
}, HELD_ANSWER_TTL_MS);
```

### 3.4 The rule Phase 4 implements against

**Every transition out of a held or pending state must null the state before performing the transition.** Any timer or event arriving late then finds `null` and does nothing. Stated once here so Phase 6 has a single sentence to audit against.

## 4. ⭐ Implementation Boundaries Confirmed

**Authorized:**

| File | Authorized change |
|---|---|
| `naavi-voice-server/src/index.js` | Cancellable streaming TTS; state sequencing; pause/resume/cancel recognition; per-connection held-answer state and expiry; silent-pause behaviour (idle timer and thinking music suppressed); history resolution; conservative resume positioning; `holdNextReply` / `holdReplyForTurn` handling for pause-during-processing; the three race guards in §3 |
| `tests/catalogue/b11f-voice-stop.ts` (new) | Regression coverage for reachable behaviour — vocabulary, state transitions, privacy cases |
| `tests/runner.ts` | Register the suite |

**NOT authorized:** `sendAudioToTwilio` and its 43 call sites; any mobile file; any Shared Core / Edge Function; database; configuration; any other production file. **No opportunistic refactoring** in `index.js` — Protected Core, No Extra Changes Rule; anything noticed goes in the Phase 5 evidence package.

## 5. Decisions carried into Phase 4, not to be revisited

1. Pause is **silent** — no confirmation, no question.
2. Final vocabularies per §2; resume and cancel recognised **only** while an answer is held.
3. Held answers expire after **5 minutes**, silently, and die with the call.
4. Any other utterance while paused is a **new question**, and discards the held answer.
5. Resume **repeats deliberately**, opening with "as I was saying".
6. Resume position is estimated from `bytesSent`, always **backing up**, and used for **nothing else** — never written to history, never spoken, never a claim about what was heard.
7. Pause during thinking → the answer is **born held**; processing still completes.
8. `response_end` remains a real state transition, generation-scoped.
9. Cancelled, expired and discarded answers are recorded **in full**, marked interrupted — never truncated.

## 6. What this review does not authorize

Not authorization to begin Phase 4 — that needs Wael's own explicit go-ahead (Phase-Gate Approval Rule). Nothing here authorizes production; B11f is staging-only.
