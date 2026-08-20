# Phase 3 Review Prompt — B11f — The Stop Control on Voice

Paste everything below the line into ChatGPT. No attachments needed — the relevant code is quoted inline.

Supporting documents, if the reviewer asks: `docs/B11F_PHASE_0/1/1A/2_VOICE_STOP_CONTROL_2026-08-19.md`, all in `docs/`.

---

You are the External Technical Reviewer for the MyNaavi project, performing a **Phase 3 — Technical Review (Before Coding)** under Release Gate Workflow v4.0. **No code has been written.** Your objective is to prevent an incorrect solution before it exists.

## The defect

On a phone call, a caller cannot interrupt Naavi mid-answer. Speaking over her has no effect; she talks until finished.

This matters more than an ordinary bug because **mobile has a permanent on-screen Stop button, and on a call speaking over Naavi *is* that button** — it is the entire mechanism. Without it, voice has no stop control and the only exit is hanging up. The product owner ranked it immediately after a P0 security item.

## Root cause (Phase 1, verified by direct code read)

`streamTTSToTwilio()` — `naavi-voice-server/src/index.js:5730`, loop at `:5763-5779`:

```js
while (true) {
  const { done, value } = await reader.read();
  if (done) break;                                  // ← only exit
  pending = Buffer.concat([pending, Buffer.from(value)]);
  while (pending.length >= SEND_CHUNK) {
    const toSend = pending.slice(0, SEND_CHUNK);
    pending = pending.slice(SEND_CHUNK);
    if (twilioWs.readyState === WebSocket.OPEN) {   // ← only other guard
      twilioWs.send(JSON.stringify({ event: 'media', streamSid, media: {...} }));
    }
  }
}
```

The loop exits only when Deepgram's TTS stream ends or the socket closes. **There is no cancellation path.** Twilio's `clear` event drains audio Twilio has already buffered — it says nothing to a producer that is still producing. So on an interruption the buffer empties, then the still-running loop refills it, and she keeps talking.

**This predicts the reported symptom exactly.** A *short* answer's loop has usually finished by the time the caller reacts, so `clear` drains the tail and she does stop. A *long* answer's loop is mid-stream, so nothing appears to happen. The control fails in proportion to how much the user needs it.

## What already exists (important — this is a regression, not a missing feature)

Both interruption mechanisms are already implemented and both are defeated by the single cause above:

- **Any-speech barge-in** — `:9953`, sends `clear` on any transcript while speaking.
- **Explicit stop keywords** — `:10125`, a 10-word list plus a regex covering every way Deepgram spells the wake word ("naavi" / "navi" / "nah-vee") plus a ≤4-word heuristic for Deepgram appending hallucinated words to short utterances.

## Phase 1A finding — there are TWO audio senders, only one is affected

| Path | Call sites | Shape | Affected |
|---|---|---|---|
| `streamTTSToTwilio` (`:5730`) | 14 | **Asynchronous** — pushes frames as Deepgram produces them | **Yes** |
| `sendAudioToTwilio` (`:5802`) | **43** | **Synchronous** — whole in-memory buffer queued in one pass | **No** |

`sendAudioToTwilio` has finished producing before control returns, so `clear` drains everything and interruption already works there. It is declared explicitly out of scope. All 14 `streamTTSToTwilio` call sites are immediately preceded by `isSpeaking = true` — it is the conversational reply path.

## The planned change (Phase 2)

**One file: `naavi-voice-server/src/index.js`.** Plus a new test suite. Risk: **Medium-High** (Protected Core, the audio path every caller hears).

**Change 1 — make the send loop cancellable.** A **per-connection** generation counter, adopting the pattern already proven on mobile (`hooks/useOrchestrator.ts:5048/5148/5149`, where `stopSpeaking()` does `_speechGen++` and the playback loop bails on `isStale()`):

```js
let ttsGen = 0;                       // inside wss.on('connection') scope
function cancelTTS() { ttsGen++; }

const myGen = ++ttsGen;
const isStale = () => ttsGen !== myGen;

while (true) {
  if (isStale()) { await reader.cancel().catch(() => {}); break; }
  const { done, value } = await reader.read();
  ...
  while (pending.length >= SEND_CHUNK) {
    if (isStale()) { await reader.cancel().catch(() => {}); return totalBytes; }
    ...
  }
}
```

Two checks deliberately: the outer loop can block on `reader.read()` for a whole network chunk, while the inner loop drains a chunk already in memory. A single outer check would keep flushing the current chunk — audible as Naavi finishing her sentence after being told to stop.

Counter scoped **per-connection**, not module-level, so one caller's stop cannot cancel another caller's audio (multi-user safety rule).

**Change 2 — only stop keywords stop her.** The any-speech barge-in stops **keeping** `stopMusic()` and `resetIdleTimer()`, but no longer sends `clear` or sets `isSpeaking = false`. The stop-keyword handler gains `cancelTTS()` alongside the `clear` it already sends.

**Change 3 — defer non-stop-word speech during playback.** Today input arriving while busy is already buffered (`deferredText`, `:10229`) and flushed by `releaseProcessing()` (`:10254`) — but only while `isProcessing`, not while `isSpeaking`. With barge-in no longer stopping her, speech during playback would otherwise be processed *concurrently* with the audio still playing, producing two overlapping responses. The condition extends to `isProcessing || isSpeaking`, releasing on speech-end. Behaviour: the caller is answered after she finishes, rather than ignored or talked over.

**Change 4 — prune the keyword list** from 10 to 6: `stop`, `naavi stop`, `enough`, `that's enough`, `cancel`, `next`. Removed: `ok`, `okay`, `thanks`, `thank you`, `got it`, `i got it` — all acknowledgements a listener makes while *agreeing*, which would cut her off mid-answer.

## Decisions already taken — do not re-litigate unless technically unsound

1. **Explicit keywords only, not any-speech.** The product owner's call: background conversation, car noise, radio, or another person speaking must not stop Naavi.
2. **`response_end` is still sent after cancellation** — it drives `isSpeaking = false`, the echo cooldown and the idle timer; skipping it risks a call that never re-arms.
3. **Deferred, not discarded.** A user answering slightly early must not vanish.
4. **Rule 15a coverage exception accepted** for cancellation itself — the defect lives in a WebSocket audio loop the test harness cannot drive. Reachable logic is automated; cancellation is validated live on staging at Phase 7.
5. **The ≤4-word heuristic is kept**, with false-positive phrases explicitly tested at Phase 7.

## ⚠️ One decision is being returned to you, because it cannot be implemented as made

At Phase 2 review you decided: *"Record only what was actually sent/heard, not the unspoken remainder."*

**That is not achievable faithfully, for two independent reasons:**

1. **Bytes are not words.** The only value recoverable at cancellation is `totalBytes` (`:5760`), a count of mulaw bytes. Converting it to a position in the sentence means bytes → seconds (8000 bytes/sec at 8 kHz) → words, and the final step requires *assuming a speaking rate*. The result is an estimate presented as fact.
2. **Sent is not heard.** `clear` discards audio Twilio buffered but never played. The caller heard **strictly less** than was sent, by an amount nothing in the system knows.

This project has a standing rule (CLAUDE.md Rule 18) that Naavi may never reshape a fact to fit her own data model — originating from an incident where an all-day calendar event was stored as a timestamp and surfaced to the user on the wrong day. Writing an estimated truncation into conversation history *as if it were what the caller heard* is the same pattern.

**Counter-proposal: record the full text, explicitly marked as interrupted** (e.g. appending `[interrupted by caller]` to the assistant turn). It is true, needs no estimation, tells Claude what it actually needs for the next turn — that the answer did not land — and is **smaller** than the decided option, which addresses the scope-creep concern you raised about this very question.

**Please rule on this explicitly.** If you still prefer estimation with the limitation in view, that is your call to make.

## What to evaluate

- **Assumptions** — particularly that `clear` cannot affect a still-running producer, and that `sendAudioToTwilio` is genuinely unaffected.
- **Architecture** — is a per-connection generation counter the right mechanism, or is there a better one for a WebSocket transport?
- **Isolation** — is the change genuinely confined to `streamTTSToTwilio`, or does Change 2 or 3 reach further than stated?
- **Hidden coupling** — **this is where I would most want your attention.** `isSpeaking` is read in at least four places (`:9955`, `:10014`, `:10135`, `:10191`) and written in several more. Changes 2 and 3 alter when it is set and what it implies. Is there a state in which the call becomes unable to speak again, or deferred text is never released — for example if cancellation happens while `isProcessing` is also true, or if `response_end` arrives after a new utterance has already started?
- **Implementation strategy** — is doing this in four changes correct, or should any be split or sequenced?

## Required output

A decision per §13: **Approved / Approved with Mandatory Changes / Rejected**.

Close with **Implementation Boundaries Confirmed** — state plainly which files are authorized and the specific change in each, so Phase 4 has a boundary to implement against and Phase 6 has one to audit against. Not "the general area" — the specific file and the specific change.
