# Phase 2 — Change Plan — B11f — Pause and Resume on Voice

**Date:** 2026-08-19
**Governance version:** v4.0
**Revision 2** — rewritten in full for Phase 0 Amendment 1 (*stop = pause*, not cancel). Revision 1 is in git history; it is not read alongside this, because a half-superseded plan is harder to read than a rewritten one.
**Phase 1 / 1A:** unchanged and still valid — the reviewer confirmed neither needs repeating.
**Architecture Reference version used:** `2026.07.18.5`
**Status:** Plan complete. **Awaiting Wael's go-ahead for Phase 2 → 3 (re-review at the new scope).**

---

## 1. What changed from Revision 1

| | Revision 1 | Revision 2 |
|---|---|---|
| "Stop" means | Cancel — answer discarded | **Pause — answer held** |
| After stopping | Ask again from scratch | **"Continue" resumes it** |
| Cancel | The only outcome | A separate, explicit word |
| Vocabularies | One | **Three** — pause / resume / cancel |

**The cancellation primitive is unchanged.** Pause *is* cancellation plus retained state, so Phase 1's root cause and Phase 1A's two-sender analysis carry over exactly.

## 2. ⭐ The resume design — and why it needs no sentence chunking

I previewed a trade between resume precision and latency. **Looking at the code, that trade is avoidable.**

**The obvious design — speak sentence by sentence, remember the index —** would mean a separate Deepgram request per sentence. Time-to-first-word would actually improve (a short first sentence arrives sooner), but there would be an audible **gap between every sentence** while the next request round-trips. That is a permanent cost paid on every answer, to serve an event that happens rarely.

**The design chosen instead:** keep one TTS request per answer, exactly as today, and work out where to resume *only when a resume actually happens*.

```
On pause:   remember  { fullText, bytesSent }
On resume:  spokenSeconds ≈ bytesSent / 8000          (mulaw, 8 kHz)
            spokenChars   ≈ spokenSeconds × ~14        (Aura Hera, ≈150 wpm)
            resumeAt      = start of the sentence containing spokenChars,
                            then back up one more sentence
            speak("As I was saying — " + fullText.slice(resumeAt))
```

**Zero cost on the normal path.** No extra requests, no gaps, no latency change. One additional TTS request only when someone actually resumes.

### 2.1 Why an estimate is legitimate here, having argued it was not for history

This uses the same bytes-to-words estimate I argued against in Revision 1 §6a. The distinction is not convenience, and it matters:

| | Conversation history | Resume point |
|---|---|---|
| The estimate would be | **Presented as fact** — "this is what the caller heard" | **Used to choose an action** — where to start speaking |
| Being wrong means | Naavi believes something false about the caller | She repeats a sentence |
| Erring safely | Impossible — wrong in either direction is a false claim | **Yes — always back up** |

**Backing up guarantees the failure mode is repetition, never omission.** Deliberately backing up an extra sentence means even a 30% error still overlaps. And Wael has explicitly blessed repetition: *"as I was saying, then repetition is not an issue."*

**The rule that follows:** this estimate may be used to decide **where to resume** and nowhere else. It must never be written into history, spoken to the caller, or used to claim what was heard.

## 3. Files that will change

| File | Classification | Change | Risk |
|---|---|---|---|
| `naavi-voice-server/src/index.js` | **Backend / Protected Core** | Seven changes — §4 | **Medium-High** |
| `tests/catalogue/b11f-voice-stop.ts` (new) | Tests | Regression suite | Low |
| `tests/runner.ts` | Tests | Register the suite | Low |

**No other file.** No mobile, no Edge Function, no migration, no configuration, and nothing in `sendAudioToTwilio` or its 43 call sites.

## 4. The seven changes

### 4.1 Cancellable TTS — unchanged from Revision 1

Per-connection generation counter; two staleness checks (outer loop can block on `reader.read()` for a whole chunk, inner loop drains one already in memory); `cancelTTS()` increments **first**, before any `clear` or flag reset, per mobile's `B-NEW-4` ordering hazard.

### 4.2 State sequencing — unchanged, from Phase 3 Mandatory Change 2

Generation-tagged `response_end` marks so a dead utterance cannot alter a live one; one idempotent `endSpeech()` funnel called synchronously by `cancelTTS()`; `maybeReleaseDeferred()` clearing `deferredText` **before** processing, for exactly-once release. Full design in `docs/B11F_PHASE_3_TECHNICAL_REVIEW_2026-08-19.md` §3.

**This becomes more important under pause**, not less — there is now a fourth piece of state (the held answer) that must not leak between utterances.

### 4.3 Three vocabularies

| Intent | Words | Effect |
|---|---|---|
| **Pause** | `stop`, `naavi stop`, `pause`, `wait`, `hold on`, `enough`, `that's enough` | Silence + hold |
| **Resume** | `continue`, `go ahead`, `carry on`, `keep going`, `resume`, `you were saying` | Speak the remainder |
| **Cancel** | `cancel`, `forget it`, `never mind`, `drop it` | Discard the held answer |

**Resume and cancel words only match while an answer is held.** Otherwise "go ahead" mid-conversation would be swallowed instead of reaching Claude. Outside the paused state they fall through as ordinary speech.

Removed from Revision 1's list and not reinstated: `ok`, `okay`, `thanks`, `thank you`, `got it`, `i got it` — acknowledgements a listener makes while agreeing.

### 4.4 The paused state

```js
let heldAnswer = null;   // { text, bytesSent, at }  — per connection
```

Set by a pause word, consumed by resume, cleared by cancel, expiry, or an unrelated question.

### 4.5 Absolute silence while paused

**Phase 0 §A1.4 criterion 6.** From the pause word until the caller speaks again, Naavi says nothing: no confirmation, no question, no prompt.

Two things must be suppressed that would otherwise break this:

- **The idle timer.** It exists to notice a caller has gone quiet; a paused call is quiet *on purpose*. It must not prompt or hang up during a pause.
- **Thinking music.** The stop-word handler currently calls `startMusic()` after stopping (`:10143`). Under pause that would replace speech with ticking — not silence.

### 4.6 Answer resolution and conversation history

Today the assistant turn is pushed into `conversationHistory` **before** speaking (`:10754-10755`), so a held answer is already recorded as if fully delivered.

| Outcome | History |
|---|---|
| **Resumed** | Leave as-is — it was delivered, just in two parts |
| **Cancelled** or **expired** | Amend the entry with an interrupted marker — Phase 3 Mandatory Change 1: full text, marked, never truncated |
| **Discarded by a new question** | Same as cancelled |

### 4.7 Pause during thinking — the answer is born held

**Approved as a required inclusion at the Phase 2 Revision 2 review.**

Without it, Phase 0 criterion 6 ("she says nothing at all until spoken to") fails in exactly the scenario the feature exists for: the caller says "stop" while Naavi is still composing, so there is no audio to cancel, and seconds later she begins announcing private information to a room that now has someone else in it.

```js
let holdNextReply = false;      // per connection

// a pause word arriving while isProcessing:
if (isProcessing && !isSpeaking) { holdNextReply = true; }

// at the speak site, before streamTTSToTwilio:
if (holdNextReply) {
  heldAnswer = { text: speech, bytesSent: 0, at: Date.now() };
  holdNextReply = false;
  // no audio is sent
}
```

`bytesSent: 0` is the whole trick: the held answer resumes **from the beginning**, because nothing was heard. It needs no special case — it is the same held state entered one step earlier, and resume, cancel, expiry and discard-on-new-question all apply unchanged.

**Processing is not cancelled.** The reviewer was explicit, and it matches the mobile model: Stop has never meant "abandon the task". Any actions the turn performs still happen; only the speaking is withheld.

## 5. The four Phase 0 questions, answered

**Q1 — How long does a paused answer live?**
**Five minutes, and it dies at the end of the call.** A judgement, not a calibration — stated as such. The scenario is someone stepping into the room, which is minutes. Beyond that, resuming a schedule from before a long meeting would be exactly the stale-state surprise the timeout exists to prevent. **Silent expiry** — she does not announce it.

**Q2 — What happens if the caller says something unrelated while paused?**
**The held answer is discarded and the new question is answered.** Designed explicitly, per the reviewer. Anything that is not a resume or cancel word, while paused, is a new question — the caller has moved on.

**Q3 — Does a paused answer go into history?**
It is already there (§4.6). The rule is that it is amended **when it resolves**, not while it is pending. Recording it as interrupted while it may still be delivered would be untrue.

**Q4 — Sentence-level resume, or restart from the beginning?**
**Neither** — §2. Back-up-and-resume, which costs nothing on the normal path and never skips content.

## 6. Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **No** | No mobile file changes. Mobile keeps its Stop button; pause/resume is not proposed there. Its generation counter is the *model* for §4.1, not a target |
| **Voice** | **Yes** | `naavi-voice-server/src/index.js` — the seven changes in §4. Protected Core |
| **Shared Core** | **No** | `streamTTSToTwilio` calls Deepgram directly (`:5740`); the `text-to-speech` Edge Function is not on this path |
| **Database** | **No** | The held answer is per-connection memory. Nothing persists — a dropped call loses it, which is correct |
| **Cron** | **No** | No scheduled job involved |
| **API contracts** | **No** | No request or response shape changes; cancellation and hold are internal |
| **Tests** | **Yes** | New suite, registered in `tests/runner.ts` |

## 7. Risk assessment

**Overall: Medium-High.** Protected Core, the audio path every caller hears, and now a stateful one.

| Risk | Likelihood | Mitigation |
|---|---|---|
| A held answer resurfaces out of context | **Medium** | 5-minute expiry, discard on an unrelated question, never persisted (§5 Q1/Q2) |
| Resume skips content | Low | Always back up, plus one extra sentence (§2) |
| Resume/cancel words swallowed in normal conversation | Medium | They only match while an answer is held (§4.3) |
| Naavi speaks during a pause, defeating the privacy case | **Medium** | Idle timer and thinking music both suppressed (§4.5). **Tested explicitly at Phase 7** |
| Stale state leaks across utterances | Medium | Phase 3 §3 sequencing, now covering a fourth piece of state |
| One caller's pause affects another | Very low, severe | Everything per-connection (Rule 10) |
| `sendAudioToTwilio` regresses | **None** | Not modified |

## 8. Limitation resolved

Revision 2 originally flagged, as a limitation outside the authorized boundary, that a pause word arriving while Naavi was still *thinking* would not stop the answer that followed.

**The Phase 2 review approved including it**, on the grounds that it is not scope expansion but a precondition of an already-approved requirement: after a pause, Naavi says nothing until spoken to. It is now §4.7 and part of the authorized design.

**Recorded because the sequence matters:** it was flagged rather than fixed quietly, and the reviewer — not I — decided it was in scope. That is the boundary working as intended.

## 9. What this phase does not authorize

No code. Phase 3 re-review at the new scope, then Phase 4 on Wael's explicit go-ahead.
