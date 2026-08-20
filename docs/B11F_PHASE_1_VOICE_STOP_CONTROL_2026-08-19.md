# Phase 1 — Problem Definition — B11f — The Stop Control on Voice

**Date:** 2026-08-19
**Governance version:** v4.0
**Phase 0:** `docs/B11F_PHASE_0_VOICE_STOP_CONTROL_2026-08-19.md` — approved with clarification (§8 = explicit stop keywords)
**Architecture Reference version used:** `2026.07.18.5`
**Status:** Investigation complete, root cause found. **Awaiting Wael's go-ahead for Phase 1 → 1A.**

**Provenance:** every claim below is **[FRESH]** — read from source this session with `file:line`. Nothing rests on memory or on the holding-list entry.

---

## 1. ⭐ The headline finding: the Stop control is already built

**This is a regression, not a missing feature.** Both interruption mechanisms already exist in the voice server, and both are defeated by the same single cause.

**Mechanism 1 — any-speech barge-in** (`src/index.js:9953`):

```js
// Barge-in: if user starts speaking, stop any playback/music.
if (transcript && (isSpeaking || musicLoop)) {
  twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
  stopMusic();
  isSpeaking = false;
}
```

**Mechanism 2 — explicit stop keywords** (`src/index.js:10125`), which is precisely what Phase 0 §8 asked for, already implemented and already richer than the list proposed:

```js
const stopWords = ['stop', 'enough', 'got it', 'ok', 'okay', 'thanks',
                   'thank you', 'next', "that's enough", "i got it"];
```

…plus a regex covering every way Deepgram spells the wake word (`naavi` / `navi` / `nah-vee`), and a ≤4-word heuristic for the case where Deepgram appends hallucinated words to "naavi stop".

**Consequence for the Phase 0 §8 decision:** the choice between "any speech" and "explicit keywords" **does not change the fix**. Both triggers exist, both are correct, and both fail for the same reason. The decision still matters for what we keep afterwards, but it is not on the critical path — and neither option would have worked if we had built it fresh.

## 2. What exactly is broken

A caller cannot interrupt Naavi mid-answer. Speaking over her — with or without a stop word — has no effect. She talks until finished.

**Wael, on a live staging call (2026-08-19), reported twice in one day.** Reproduced by him on both the registered and the PIN-authenticated path.

## 3. Root cause

**`streamTTSToTwilio()` cannot be cancelled** — `src/index.js:5730`, send loop at `:5763-5779`.

```js
while (true) {
  const { done, value } = await reader.read();
  if (done) break;                                  // ← only exit
  ...
  if (twilioWs.readyState === WebSocket.OPEN) {     // ← only other guard
    twilioWs.send(JSON.stringify({ event: 'media', streamSid, media: {...} }));
  }
}
```

The loop reads Deepgram's TTS stream and pushes `media` frames to Twilio. **It exits only when Deepgram's stream ends or the socket closes.** There is no check of `isSpeaking`, no abort flag, no cancellation path of any kind — verified by reading the whole function, not by grep alone.

**Why that defeats both mechanisms.** Twilio's `clear` event drains audio Twilio has *already buffered*. It says nothing to the producer. So on an interruption:

1. Barge-in sends `clear` → Twilio's buffer empties → she goes quiet for an instant.
2. `isSpeaking = false` → the flag is now wrong; audio is still being produced.
3. **The send loop is still running** and immediately refills Twilio with the next frames.
4. She continues talking.

`clear` cannot stop a producer that is still producing. The interruption logic is correct; it is issuing a command to the wrong component.

### 3.1 This predicts the exact symptom Wael reported

> *"sometimes it takes too much **if the question has a long answer**"*

That correlation is not incidental — it falls out of the root cause. A **short** answer's send loop has usually finished by the time the caller reacts, so `clear` drains the tail and she does stop. A **long** answer's loop is still mid-stream, so the buffer refills instantly and nothing appears to happen.

**The control therefore fails precisely in proportion to how much the user needs it.** It works on the answers nobody wants to interrupt and fails on the ones they do.

## 4. Evidence ruled OUT, with the reason — do not re-investigate

| Hypothesis | Verdict | Evidence |
|---|---|---|
| S1 caused it | **Ruled out** | Track B is the only S1 commit touching the WebSocket handler; its entire diff is two `<Parameter>` lines, one variable declaration, and the set-PIN block. It never touches speech handling |
| Caller audio is gated while Naavi speaks | **Ruled out** | `:13483` forwards to Deepgram unconditionally — no `isSpeaking` check |
| An early `return` swallows transcripts | **Ruled out** | Every early return between the handler and the barge-in check sits inside recording mode or Q&A mode, neither of which applies to normal conversation |
| Deepgram is closed or paused during TTS | **Ruled out** | No `close`, `pause` or finalize call anywhere in the TTS path |
| Naavi's own audio echoes back and confuses it | **Ruled out** | `<Stream>` carries no `track` attribute (`:7380`, `:7540`, `:8650`), so Twilio's default `inbound_track` applies — caller audio only |
| The barge-in code is missing or wrong | **Ruled out** | It exists at `:9953` and is correct; so is the stop-word handler at `:10125` |

## 5. Architecture ownership

**Classification: Voice-only, Protected Core (Voice orchestration).**

**⚠️ Architecture location not proven from the Reference.** §2's capability table has no row for voice TTS playback or audio transport — the closest entries concern *what Naavi says*, not how audio reaches the caller. Resolved by fresh grep instead: `streamTTSToTwilio` exists only in `naavi-voice-server/src/index.js` and is called nowhere else; mobile speaks through the `text-to-speech` Edge Function on a completely separate path.

Voice-only **by nature**, not by duplication — a phone call's audio transport has no mobile equivalent, the same way geofencing has no voice equivalent.

**Recommendation for Phase 8:** add a row for voice audio transport to §2. Its absence is why this defect had no documented owner.

## 6. Alternatives considered

| Option | Assessment |
|---|---|
| **A. Make the send loop cancellable** — a per-utterance token checked each iteration; barge-in invalidates it, the loop breaks, then `clear` drains what was already sent | **Recommended.** Fixes the actual cause. Small and local: one flag, one check in the loop, one invalidation at the two existing interrupt sites. Both existing mechanisms start working with no change to either |
| **B. Send TTS in smaller chunks** | Rejected. Reduces the window without closing it, and trades against latency — smaller chunks mean more round trips |
| **C. Buffer the whole utterance before sending** | Rejected. Would let `clear` work reliably, but delays first audio until the entire response is synthesised, which is a direct latency regression on a surface that is already slow |
| **D. Do nothing; treat interruption as unsupported on voice** | Rejected by Phase 0 — this is the voice equivalent of the mobile Stop button, and without it the only exit is hanging up |

## 7. Open questions for Phase 2

1. **After the loop breaks, what state should the call be in?** She should listen — but `pendingText`, `currentResponseText` and the conversation history need a defined state so the next thing the caller says is understood in context rather than landing mid-sentence.
2. **Should a cancelled response be recorded in the conversation history?** If Naavi said half an answer, Claude's next turn should probably know that — otherwise she may repeat herself.
3. **Does `response_end` still fire after a cancelled utterance?** `:13500` sets `isSpeaking = false` and starts the idle timer on that mark. If the loop breaks early and never sends the mark, the idle timer may never start.
4. **Keyword set (Phase 0 §8).** The existing list already exceeds what was requested. Phase 2 should decide whether to keep `ok` / `okay` / `thanks` — they are natural acknowledgements a listener makes *without* meaning "stop", which risks cutting her off mid-answer for a user who is simply agreeing.

## 8. What this phase does not authorize

No code. Phase 1A (architecture completeness) and Phase 2 (change plan) follow, each on Wael's explicit go-ahead.
