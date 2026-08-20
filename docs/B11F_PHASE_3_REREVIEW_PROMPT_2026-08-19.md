# Phase 3 RE-REVIEW Prompt — B11f — Pause and Resume on Voice

Paste everything below the line into ChatGPT. No attachments needed — the relevant code is quoted inline.

---

You are the External Technical Reviewer for the MyNaavi project, performing a **Phase 3 re-review (Before Coding)** under Release Gate Workflow v4.0. **No code has been written.**

You approved a first Phase 3 for this item. **The scope has since changed** and this supersedes that review.

## 1. What changed since you last saw this

The product owner reframed the feature from how it works between people:

> *"If I'm on speaker phone and someone comes to my office, I say to the other party 'stop' — and I mean pause until I say start again."*

| | First review | Now |
|---|---|---|
| "Stop" means | **Cancel** — answer discarded | **Pause** — answer held |
| After stopping | Ask again from scratch | **"Continue"** resumes it |
| Vocabularies | One | **Three** — pause / resume / cancel |

**Why the change is more than preference.** On mobile an answer has two outputs, screen and voice; stopping the audio leaves the information on screen. **On voice there is only one output**, so cancelling destroys the caller's only copy of a fully-computed answer, recoverable only by asking again and paying the full ~20 s latency again. Pause is the voice equivalent of what the mobile screen does passively.

**Phase 1 and Phase 1A were not repeated** — you ruled they remain valid. The root cause and the cancellation primitive are unchanged; pause *is* cancellation plus retained state.

## 2. Unchanged from your first review — please confirm these still hold

- **Root cause:** `streamTTSToTwilio` (`naavi-voice-server/src/index.js:5730`, loop `:5763-5779`) exits only when Deepgram's stream ends or the socket closes. Twilio's `clear` drains a buffer but cannot address a still-running producer, so it refills.
- **Two senders; one affected.** `streamTTSToTwilio` (14 call sites, asynchronous, affected) vs `sendAudioToTwilio` (**43 call sites**, synchronous, unaffected and out of scope).
- **Per-connection generation counter**, adopting the pattern proven on mobile (`hooks/useOrchestrator.ts:5048/5148/5149`).
- **Your Mandatory Change 2 — state sequencing** — carried forward unchanged: generation-tagged `response_end` marks so a dead utterance cannot alter a live one; one idempotent `endSpeech()` funnel called synchronously by `cancelTTS()`; `maybeReleaseDeferred()` clearing `deferredText` **before** processing for exactly-once release.
- **Your Mandatory Change 1 — conversation history:** full text, marked interrupted, never an estimated truncation.

## 3. ⚠️ The design decision most deserving your scrutiny

**Resume position is computed from an estimate — the same estimate you and I agreed must NOT be used for conversation history.** I want that inconsistency examined rather than assumed acceptable.

**The design:**

```
On pause:   remember { fullText, bytesSent }
On resume:  spokenSeconds ≈ bytesSent / 8000        (mulaw, 8 kHz)
            spokenChars   ≈ spokenSeconds × ~14      (Aura Hera, ≈150 wpm)
            resumeAt      = start of the sentence containing spokenChars,
                            then back up one more sentence
            speak("As I was saying — " + fullText.slice(resumeAt))
```

**The claimed distinction:**

| | Conversation history | Resume point |
|---|---|---|
| The estimate is | **Presented as fact** — "this is what the caller heard" | **Used to choose an action** — where to start speaking |
| Wrong means | Naavi believes something false about the caller | She repeats a sentence |
| Can it err safely? | **No** — wrong in either direction is a false claim | **Yes** — always back up |

**Is that distinction sound, or is it rationalising the same defect twice?** The rule proposed is that this estimate may decide *where to resume* and nowhere else — never written to history, never spoken, never used to claim what was heard.

**Also assess the alternative I rejected:** speaking sentence-by-sentence with an exact index. It gives a precise resume point but needs one Deepgram request per sentence, creating an audible gap between every sentence — a permanent cost on every answer to serve a rare event. I judged that a bad trade. **Latency is already an open complaint on this surface (~20 s for trivial questions), which cuts both ways** — it argues against added gaps, and it argues for anything that reduces time-to-first-word.

## 4. The seven changes

1. **Cancellable TTS** — per-connection generation counter, **two** staleness checks (the outer loop can block on `reader.read()` for a whole chunk; the inner drains one already in memory), `cancelTTS()` increments **first**.
2. **State sequencing** — your Mandatory Change 2, unchanged. Now guards a **fourth** piece of state.
3. **Three vocabularies:**
   - Pause — `stop`, `naavi stop`, `pause`, `wait`, `hold on`, `enough`, `that's enough`
   - Resume — `continue`, `go ahead`, `carry on`, `keep going`, `resume`, `you were saying`
   - Cancel — `cancel`, `forget it`, `never mind`, `drop it`
   **Resume and cancel words match only while an answer is held**, so "go ahead" in normal conversation still reaches Claude.
4. **`heldAnswer = { text, bytesSent, at }`** — per connection, never persisted.
5. **Absolute silence while paused.** Two things must be suppressed or the privacy case fails: the **idle timer** (a paused call is quiet on purpose) and **thinking music** (`:10143` currently restarts it after a stop — that would replace speech with ticking).
6. **History amended on resolution, not while pending.** Resumed → unchanged. Cancelled/expired/discarded → marked interrupted.
7. **Pause during thinking → the answer is born held** (you required this inclusion): `holdNextReply` set when a pause word arrives while `isProcessing`; at the speak site the answer goes to `heldAnswer` with `bytesSent: 0` and no audio is sent. Processing still completes — Stop has never meant abandoning the task.

## 5. Resolved product decisions — do not re-litigate unless technically unsound

1. **Pause is silent** — she does not ask "cancel or pause?". The scenario is someone entering the room; a question spends speech at the moment none was wanted. It is also unnecessary: **pause strictly dominates cancel** — pausing costs nothing, and an unresumed pause expires to the same end state.
2. **Held answers expire after 5 minutes**, silently, and die with the call. A judgement, not a calibration.
3. **Anything that is not a resume or cancel word, while paused, is a new question** and discards the held answer.
4. **Resume repeats deliberately** and says "as I was saying".

## 6. What to evaluate

- **Is §3's estimate distinction sound?** The single most important question in this review.
- **Hidden coupling.** `isSpeaking`, `isProcessing`, `deferredText`, and now `heldAnswer` and `holdNextReply` are five pieces of coupled state. Is there a reachable combination that strands the call — silent forever, or resuming something it should have dropped? Specifically: a pause arriving *between* `isProcessing` going false and playback starting; a resume arriving while a *new* answer is already playing; expiry firing during a resume.
- **Vocabulary collisions.** "Wait" and "hold on" are pause words but also ordinary speech ("wait, what about Tuesday?"). "Next" was dropped; should "wait" and "hold on" be too?
- **Isolation.** Is the change genuinely confined to `streamTTSToTwilio` and the transcript handler, or does change 7 reach into the response path more deeply than stated?
- **Privacy criterion.** Is there *any* path where Naavi speaks after a pause word and before the caller speaks again?

## 7. Required output

A decision per §13: **Approved / Approved with Mandatory Changes / Rejected**.

Close with **Implementation Boundaries Confirmed** — the specific files and the specific change in each, so Phase 4 has a boundary to implement against and Phase 6 has one to audit against.
