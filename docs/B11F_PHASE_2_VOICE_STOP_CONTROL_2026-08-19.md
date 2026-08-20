# Phase 2 — Change Plan — B11f — The Stop Control on Voice

**Date:** 2026-08-19
**Governance version:** v4.0
**Phase 1A:** approved — Architecture Reference `2026.07.18.5`
**Status:** Plan complete. **Awaiting Wael's go-ahead for Phase 2 → 3 (external technical review).**

---

## 1. Boundary inherited from Phase 1A review

1. The change belongs **inside `streamTTSToTwilio`**.
2. **Do not modify `sendAudioToTwilio`** or its 43 call sites.
3. Use the **generation-counter** pattern proven on mobile.
4. Ordinary/background speech must **not** stop Naavi; explicit stop keywords must.
5. Phase 2 must resolve what happens when Robert speaks during playback **without** a stop keyword.

## 2. Files that will change

| File | Classification | Change | Risk |
|---|---|---|---|
| `naavi-voice-server/src/index.js` | **Backend / Protected Core** | Four changes — §3.1 to §3.4 | **Medium-High** |
| `tests/catalogue/b11f-voice-stop.ts` (new) | Tests | Regression suite | Low |
| `tests/runner.ts` | Tests | Register the suite | Low |

**No other file.** No mobile file, no Edge Function, no migration, no config.

## 3. The four changes

### 3.1 Make `streamTTSToTwilio` cancellable — the actual fix

**Why:** `:5763-5779` exits only when Deepgram's stream ends or the socket closes. `clear` drains Twilio's buffer but cannot address a producer that is still producing, so the buffer refills on the next `reader.read()`.

**How** — mobile's pattern (`useOrchestrator.ts:5048/5148/5149`), transposed to the WebSocket transport:

```js
let ttsGen = 0;                       // per-connection, inside the WS handler scope
function cancelTTS() { ttsGen++; }    // invalidates any in-flight stream

// inside streamTTSToTwilio:
const myGen = ++ttsGen;
const isStale = () => ttsGen !== myGen;

while (true) {
  if (isStale()) { await reader.cancel().catch(() => {}); break; }   // ← new
  const { done, value } = await reader.read();
  if (done) break;
  ...
  while (pending.length >= SEND_CHUNK) {
    if (isStale()) { await reader.cancel().catch(() => {}); return totalBytes; }  // ← new
    ...
  }
}
```

**Two checks, not one.** The outer loop can block on `reader.read()` for a whole network chunk; the inner loop drains a chunk that is already in memory. A single check in the outer loop would keep flushing the current chunk after cancellation — audible as Naavi finishing her sentence.

**Ordering hazard, carried from mobile's own `B-NEW-4` bug** (`useOrchestrator.ts:5071`): there, cleanup nulled the sound handle before the stop path read it, so playback never actually halted. The equivalent here is incrementing the counter *after* something else has already reset state. **`cancelTTS()` must increment first, before any `clear` or flag reset**, so an in-flight loop bails at its next check regardless of what teardown does afterwards.

**Scope of the counter: per-connection**, declared inside the `wss.on('connection')` scope alongside `isSpeaking`. A module-level counter would let one caller's stop command cancel another caller's audio — a multi-user safety break (CLAUDE.md Rule 10).

### 3.2 Stop keywords become the only thing that stops her

**Why:** Phase 0 §8 as revised, and the Phase 1A review: ordinary and background speech must not stop Naavi.

The barge-in block at `:9953` currently does **two** jobs on any transcript. They are separated:

| Today, on any transcript | After |
|---|---|
| `twilioWs.send({event:'clear'})` — stops TTS | **Removed.** Only a stop keyword stops TTS |
| `isSpeaking = false` | **Removed** — it was making the flag lie while audio was still being produced |
| `stopMusic()` | **Kept.** Thinking music should stop when the caller speaks; it is a hold tone, not an answer |
| `resetIdleTimer()` | **Kept** — the caller is present |

The stop-keyword handler at `:10125` gains `cancelTTS()` alongside the `clear` it already sends. **That single addition is what makes it work** — it already sends `clear`, which has been draining a buffer that instantly refilled.

### 3.3 Non-stop-word speech during playback — the fifth question, answered

**The problem this creates.** Today, speech during playback triggers barge-in, which stops her, and the message is then processed normally. Remove that, and the message is still processed immediately (`:10226`: `if (pendingText.trim() && !isProcessing) processUserMessage(...)`) — **while she is still talking.** Two responses would overlap.

**The answer uses machinery that already exists.** The server already defers input that arrives while it is busy:

```js
} else if (pendingText.trim() && isProcessing) {
  deferredText = (deferredText ? deferredText + ' ' : '') + pendingText.trim();   // :10229
}
function releaseProcessing() {          // :10254
  isProcessing = false;
  if (deferredText) { ...; processUserMessage(deferred); }
}
```

**The change is to extend that condition from `isProcessing` to `isProcessing || isSpeaking`**, and to release on speech-end as well as on processing-end. The `response_end` mark handler (`:13500`) already sets `isSpeaking = false` and is the natural release point.

**Behaviour:** Robert speaks mid-answer without a stop word → Naavi finishes her sentence → then answers what he said. He is heard, not ignored, and not talked over.

**Rejected alternative — discard it.** Simpler, and wrong: a user who answers a question slightly early would be silently dropped, which is worse than the defect being fixed.

### 3.4 Prune the stop-keyword list

**Current list** (`:10126`) — 10 entries:

```
stop · enough · got it · ok · okay · thanks · thank you · next · that's enough · i got it
```

**Proposed** — 6 entries:

```
stop · naavi stop · enough · that's enough · cancel · next
```

| Removed | Reason |
|---|---|
| `ok`, `okay`, `thanks`, `thank you` | Flagged by both Wael and the reviewer. These are what a listener says while *agreeing* — a user saying "ok" as Naavi explains something would be cut off mid-answer. This is the accidental stopping the whole keyword decision exists to prevent |
| `got it`, `i got it` | ⚠️ **Borderline — see §6 Q1.** Genuinely ambiguous: can mean "I have what I need, stop" or simply "I follow you" |

| Added | Reason |
|---|---|
| `cancel` | Requested by Wael |
| `naavi stop` | Already matched by the regex; listed explicitly so the intended vocabulary is visible in one place |

**Unchanged:** the `naaviStopRe` regex covering Deepgram's spellings of the wake word, and the ≤4-word starts-with/ends-with heuristic. Both exist because Deepgram appends hallucinated words to short utterances — removing them would reintroduce a solved problem.

## 4. Change Impact Matrix

Every row stated explicitly.

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **No** | No mobile file changes. Mobile's Stop already works and its generation-counter pattern is the *model* for this fix, not a target of it. Phase 1A confirmed the capability is Voice-only by nature, not duplicated |
| **Voice** | **Yes** | `naavi-voice-server/src/index.js` — the four changes in §3. Protected Core |
| **Shared Core** | **No** | `streamTTSToTwilio` calls Deepgram directly (`:5740`); the `text-to-speech` Edge Function is not on this path and is untouched |
| **Database** | **No** | No schema change, no new column, no data written |
| **Cron** | **No** | No scheduled job involved |
| **API contracts** | **No** | No request or response shape changes. `streamTTSToTwilio`'s signature and return value are unchanged; cancellation is internal |
| **Tests** | **Yes** | New suite `tests/catalogue/b11f-voice-stop.ts`, registered in `tests/runner.ts` |

## 5. Risk assessment

**Overall: Medium-High.** Protected Core, and the audio path every caller hears.

| Risk | Likelihood | Mitigation |
|---|---|---|
| A caller is cut off mid-answer by accident | Low | The pruned keyword list removes every pure acknowledgement. Regression bar: an uninterrupted answer must play to completion — tested explicitly |
| Cancellation leaves the call in a broken state | **Medium** | §6 Q2 must be settled before coding. `response_end` drives `isSpeaking = false` and the idle timer (`:13500`); a loop that breaks without it could leave the call unable to speak again |
| The Deepgram HTTP stream leaks after cancellation | Low | `reader.cancel()` on both bail paths |
| One caller's stop cancels another caller's audio | **Very low, severe if wrong** | Counter scoped per-connection, not module-level (§3.1). CLAUDE.md Rule 10 |
| Deferred text produces a delayed, confusing reply | Medium | Release on speech-end, so the gap is one sentence rather than an unbounded wait |
| The 43 `sendAudioToTwilio` sites regress | **None** | Not modified. Phase 1A established they have no post-`clear` production window |

## 6. Open questions — ALL DECIDED at Phase 2 review (2026-08-19)

| # | Question | Decision |
|---|---|---|
| Q1 | Keep `got it` / `i got it`? | **Drop.** Too ambiguous. Final list: `stop`, `naavi stop`, `enough`, `that's enough`, `cancel`, `next` |
| Q2 | Send `response_end` after cancellation? | **Yes.** Preserve the state transition, or `isSpeaking` and the idle timer become inconsistent |
| Q3 | Record a cancelled response in history? | **Record only what was actually sent/heard** — ⚠️ **see §6a: this is not achievable as written** |
| Q4 | How is cancellation tested? | **Rule 15a exception accepted** — automate the reachable logic, mandatory live staging verification for cancellation itself |
| Q5 | Keep the ≤4-word heuristic? | **Keep**, and explicitly test false-positive phrases at Phase 7 |

## 6a. ⚠️ Q3 cannot be implemented as decided — and the simpler option is the truthful one

The reviewer asked Phase 3 to verify that Q3 "can be implemented reliably without widening Protected Core changes unnecessarily." Checking it first, before sending it onward: **it cannot be implemented faithfully at all**, for two independent reasons.

**1. Bytes are not words.** The only thing recoverable at cancellation is `totalBytes` (`:5760`) — a count of mulaw bytes. Converting that to "how much of the sentence was spoken" means bytes → seconds (8000 bytes/sec at 8 kHz) → words, and that last step requires *assuming a speaking rate*. The result is an estimate presented as a fact.

**2. Sent is not heard.** `clear` discards audio Twilio had buffered but not yet played. So the caller heard **strictly less** than was sent, by an unknown amount. Even a perfect bytes-to-words conversion would overstate what reached them.

**This is precisely the pattern CLAUDE.md Rule 18 forbids** — reshaping a fact to fit the data model. Writing an estimated truncation into conversation history *as if it were what the caller heard* is the Victoria Day bug in a different costume: the system inventing a precise-looking value because its storage shape demanded one.

**Recommended instead:** record the **full text, explicitly marked as interrupted** — e.g. appending a marker such as `[interrupted by caller]` to the assistant turn. This:

- is **true** — Naavi did begin that answer and was cut off;
- requires **no estimation** and no byte-to-text mapping;
- gives Claude what it actually needs for the next turn — that the answer did not land — without pretending to know which word it stopped on;
- is **smaller** than the decided option, which directly answers the reviewer's scope-creep concern.

**This overturns a decision the reviewer just made, so it goes to Phase 3 explicitly rather than being applied quietly.** If the reviewer prefers estimation despite the above, that is their call to make with the limitation in front of them.

## 7. What this phase does not authorize

No code. Phase 3 is the mandatory external technical review before implementation, and Phase 4 begins only after Wael's explicit go-ahead following it.
