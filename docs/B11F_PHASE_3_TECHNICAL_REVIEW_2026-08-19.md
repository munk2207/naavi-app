# Phase 3 — Technical Review (Before Coding) — B11f — The Stop Control on Voice

**Date:** 2026-08-19
**Governance version:** v4.0
**Reviewer:** ChatGPT (External Technical Reviewer, governance §1)
**Plan reviewed:** `docs/B11F_PHASE_2_VOICE_STOP_CONTROL_2026-08-19.md`
**Status:** Review complete, both mandatory changes incorporated below. **Awaiting Wael's explicit go-ahead for the Phase 3 → 4 transition.**

---

## 1. Decision

**APPROVED WITH MANDATORY CHANGES.** Changes 1–4 approved conceptually, including explicit-keyword-only stopping and deferring ordinary speech rather than discarding it. The per-connection generation counter was accepted as appropriate, and keeping `sendAudioToTwilio` out of scope was upheld on the producer-behaviour argument.

## 2. Mandatory Change 1 — conversation history: reversed in our favour

> *"I reverse my Phase 2 decision. Do not estimate what the caller heard. The argument is correct: bytes cannot faithfully identify spoken words, and transmitted audio is not equivalent to heard audio because Twilio may discard buffered audio on `clear`. Use the proposed approach: store the full assistant response marked explicitly as interrupted."*

**Resolution:** a cancelled utterance is recorded in `conversationHistory` **in full**, with an explicit interrupted marker. No truncation, no estimated cut point.

Worth stating plainly because it is the whole reason this was escalated rather than implemented: the decided version would have written a *guess* into history and presented it as what the caller heard. The rule against that (CLAUDE.md Rule 18) exists because of a real incident, and it applied here even though nothing about this work item looked like a calendar bug.

## 3. Mandatory Change 2 — state sequencing, designed here as required

> *"`response_end`, `isSpeaking`, `isProcessing`, and `deferredText` are coupled state. Phase 4 must ensure an old/cancelled utterance's completion cannot incorrectly alter the state of a newer utterance, and deferred input is released exactly once when the system is actually ready."*

The reviewer required this be settled **before** Phase 4, not during it. It is settled below.

### 3.1 The hazard, concretely

`response_end` is a Twilio **mark** — the server sends it, Twilio echoes it back after playing preceding audio, and the handler at `:13498` reacts. **That round trip is the problem.**

1. Utterance **A** plays. `isSpeaking = true`, `ttsGen = 1`.
2. Caller says "stop" → `cancelTTS()` → `ttsGen = 2`. A's loop bails.
3. Caller immediately asks something else → utterance **B** starts. `isSpeaking = true`, `ttsGen = 3`.
4. **A's `response_end` mark now arrives**, late.
5. The handler runs unconditionally: `isSpeaking = false`, cooldown set, idle timer started — **while B is still speaking.**

The result is a call whose state says nothing is playing while audio is playing: barge-in checks misfire, the echo cooldown swallows real speech, and the idle timer may hang up on a caller who is being talked to. **A dead utterance reaches out and corrupts a live one.**

### 3.2 Resolution — generation-tagged marks

The mark name carries the generation that produced it:

```js
mark: { name: `response_end:${myGen}` }
```

The handler acts **only** when the tag matches the current generation:

```js
const gen = Number(String(msg.mark?.name).split(':')[1]);
if (!Number.isNaN(gen) && gen !== ttsGen) {
  console.log(`[Mark] stale response_end gen=${gen} (current=${ttsGen}) — ignoring`);
  return;                       // a dead utterance may not touch live state
}
```

A stale mark is discarded. `response_end` remains what Q2 required — a real state transition — but only for the utterance that owns it.

**Backwards compatibility:** marks with no `:gen` suffix (sent by the 43 untouched `sendAudioToTwilio` sites) parse to `NaN` and are handled exactly as today. Those call sites are not modified, which is what the boundary requires.

### 3.3 Resolution — one funnel for ending speech

Cancellation must not wait for a network round trip to update state, and two paths must not both run it. Both call sites funnel into one function:

```js
function endSpeech(reason) {
  if (!isSpeaking) return;                  // idempotent
  isSpeaking = false;
  speechCooldownUntil = Date.now() + 1000;
  startIdleTimer();
  maybeReleaseDeferred();
}
```

Called from exactly two places:

| Caller | When |
|---|---|
| `cancelTTS()` | **synchronously**, at the moment of cancellation — not on the returning mark, which may never come |
| the `response_end` handler | only after the generation check in §3.2 passes |

The `if (!isSpeaking) return;` guard makes it idempotent, so a cancel followed by a matching mark cannot double-fire.

### 3.4 Resolution — deferred input released exactly once, and only when ready

```js
function maybeReleaseDeferred() {
  if (isProcessing || isSpeaking) return;   // "actually ready", per the reviewer
  if (!deferredText.trim()) return;
  const text = deferredText;
  deferredText = '';                        // clear BEFORE processing — this is what makes it exactly-once
  processUserMessage(text);
}
```

Called from `releaseProcessing()` (existing) and from `endSpeech()` (new). Both may fire in either order; whichever arrives second finds `deferredText` empty and does nothing.

**Why clearing first matters:** `processUserMessage` is async. Clearing after it would leave a window in which the other release point sees the same text and processes it twice — the caller's question answered twice over. This mirrors the existing `releaseProcessing` pattern (`:10257-10258`), which already clears before processing; the change is to route both paths through one function instead of duplicating the sequence.

### 3.5 The ordering rule, stated once

**`cancelTTS()` increments the generation FIRST, before anything else.**

```js
function cancelTTS(reason) {
  ttsGen++;                                  // 1. invalidate in-flight loop
  if (twilioWs.readyState === WebSocket.OPEN && streamSid) {
    twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));   // 2. drain buffer
  }
  stopMusic();
  endSpeech(reason);                         // 3. state transition + deferred release
}
```

This is the mobile `B-NEW-4` hazard transposed (`useOrchestrator.ts:5071`): there, teardown nulled the sound handle before the stop path read it, so playback never actually halted. Incrementing first means an in-flight loop bails at its next check **regardless** of what any later step does or fails to do.

## 4. ⭐ Implementation Boundaries Confirmed

**These files, and no others, are authorized for Phase 4.**

| File | Authorized change |
|---|---|
| `naavi-voice-server/src/index.js` | Per-connection TTS generation cancellation; explicit-keyword-only stopping; non-stop speech deferral and release; stop-word list pruning; interrupted-response history handling; the state sequencing in §3 |
| `tests/catalogue/b11f-voice-stop.ts` (new) | Regression tests for reachable B11f behaviour |
| `tests/runner.ts` | Register the suite |

**Explicitly NOT authorized:**

- **No mobile files.** Its Stop already works and is the *model*, not a target.
- **No Shared Core / Edge Functions.** `streamTTSToTwilio` calls Deepgram directly.
- **No database, no migration, no configuration.**
- **No change to `sendAudioToTwilio` or any of its 43 call sites.**
- **No opportunistic refactoring** in `index.js` — Protected Core, No Extra Changes Rule. Anything noticed goes in the Phase 5 evidence package.

## 5. Decisions carried into Phase 4, so they are not revisited

1. Explicit keywords only — background noise and other voices must never stop Naavi.
2. Final list: `stop`, `naavi stop`, `enough`, `that's enough`, `cancel`, `next`.
3. `response_end` remains a real state transition — now generation-scoped (§3.2).
4. Non-stop speech is deferred, never discarded.
5. Rule 15a exception accepted for cancellation itself; reachable logic automated, cancellation validated live at Phase 7.
6. The ≤4-word heuristic stays, with false-positive phrases tested at Phase 7.
7. Cancelled responses are recorded **in full**, marked interrupted (§2).

## 6. What this review does not authorize

Per the Phase-Gate Approval Rule, this document is not authorization to begin Phase 4. That needs Wael's own explicit go-ahead. Nothing here authorizes production; B11f is staging-only, as S1 was.
