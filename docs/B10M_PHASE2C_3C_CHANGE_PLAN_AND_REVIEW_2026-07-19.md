# B10m — Phase 2c/3c: Change Plan + Technical Review (audio-content diagnostic)

**Date:** 2026-07-19. Combined into one document (Change Planning + Technical Review Before Coding) because this change is the same risk category as B10m's original diagnostic logging (Low — additive `console.log` only, no behavior change), unlike the Medium-risk watchdog fix (2b/3b) which warranted full separation. Still Protected Core, still requires review regardless of risk tier (Governance §4).

No code was written in producing this document.

---

## 0. What this plans

Following the watchdog fix (Phase 4b-6b), a live test showed the fix works as designed (watchdog fired twice, reconnected twice) but the underlying hang persisted across all three connection attempts in that call — new evidence suggesting the problem may not be connection-specific. This plans a diagnostic to distinguish two very different explanations:

- **Audio genuinely not reaching Deepgram as real signal** (our own Twilio→Railway audio path) — actionable, fixable on our side.
- **Real audio reaching Deepgram, Deepgram simply not transcribing it** — a third-party issue, actionable only via escalation to Deepgram.

## 1. Files that will change

- `naavi-voice-server/src/index.js` — the only file.

## 2. The change, exact

**Extends the existing per-100-frame heartbeat** (`naavi-voice-server/src/index.js:12687-12690`, the `[FrameIn] #N...` block) — same gate, same cadence, no new `if` condition introduced:

```js
if (inboundFrameCount % 100 === 0 && callStartAt) {
  const dgState = deepgramWs ? ['CONNECTING','OPEN','CLOSING','CLOSED'][deepgramWs.readyState] : 'null';
  console.log(`[FrameIn] #${inboundFrameCount} at +${nowMs - callStartAt}ms since call-start (DG state: ${dgState})`);
  // [B10m-diag] Audio-content sample — after the watchdog fix (2026-07-19)
  // proved reconnecting doesn't resolve the hang, this checks whether real
  // signal is present in the raw audio Twilio sends us, or whether it's
  // effectively digital silence. mu-law's two zero-representations are
  // 0xFF and 0x7F; a frame that's almost entirely those bytes carries no
  // real voice content. See docs/B10M_PHASE1_PROBLEM_DEFINITION_2026-07-19.md
  // Section 4.
  let silentBytes = 0;
  for (let i = 0; i < audio.length; i++) {
    if (audio[i] === 0xFF || audio[i] === 0x7F) silentBytes++;
  }
  const silentPct = audio.length ? Math.round((silentBytes / audio.length) * 100) : 0;
  console.log(`[B10m-diag] Audio sample at frame #${inboundFrameCount}: ${audio.length} bytes, ${silentPct}% near-silence`);
}
```

**Design decisions:**
- **Reuses `audio`, the already-decoded `Buffer`** from `msg.media.payload` (line 12670) — no new decoding, no new variable scope beyond the loop locals.
- **Runs only every 100th frame** (~once per 2 seconds), inside the existing gate — negligible cost (a ~160-byte loop, twice a second at most).
- **Heuristic, not exact:** counts bytes equal to μ-law's two zero-representations (0xFF, 0x7F) as a proxy for silence. This is a coarse signal-presence check, not a precise loudness measurement — sufficient to distinguish "clearly no signal" from "clearly some signal," which is all this diagnostic needs to answer.
- **No control flow, state, timing, or external interface changed** — purely an additional log line, same category as the original `[B10m-diag]` additions (Phase 4 checklist precedent).

## 3. Risk classification: Low

Same category as B10m's original diagnostic logging — additive only, no behavior change, no new state read by any decision branch. Protected Core review is mandatory regardless (Governance §4), but risk itself is Low, not Medium like the watchdog fix (which changed real reconnect behavior).

## 4. Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | No | Voice-only, unchanged from every prior B10m phase's finding. |
| Voice | Yes | One additional log line, same insertion point family as existing `[FrameIn]` heartbeat. |
| Shared Core | No | |
| Database | No | |
| Cron | No | |
| API contracts | No | |
| Tests | No | No test harness exists for this repo; diagnostic logging is not meaningfully unit-testable (Rule 15a exception, same as every prior B10m diagnostic addition). |

## 5. Regression Impact

All "No" — same reasoning as every prior B10m diagnostic phase: purely additive logging, no control-flow change, negligible performance cost (a short loop over already-in-memory bytes, run twice a second at most).

## 6. Implementation Boundaries Confirmed

- **Authorized file, exactly one:** `naavi-voice-server/src/index.js`, the single block shown in §2, inserted inside the existing `if (inboundFrameCount % 100 === 0 && callStartAt)` gate at line 12687.
- **No additional files, no refactoring, no other change to the `'media'` case handler** (the Deepgram-send logic, the buffering-during-handshake logic, and the gap detector are all untouched).
- **Does not touch the watchdog fix (2b/3b) or the original diagnostic logging (Phase 2-6)** — both remain exactly as previously committed.

## 7. Deferred ideas

**A precise loudness/RMS calculation instead of the byte-heuristic** — not approved for this pass; the coarse heuristic is sufficient to answer the binary question this diagnostic exists for (signal present or not), and a precise calculation would need a proper μ-law decode table, more code, more risk, for a question this doesn't require.

---

## 8. Status

Drafted 2026-07-19. Submitted for Wael's own go-ahead to implement — same phase-gate discipline as every prior B10m change, compressed into one document given the Low risk tier and the hour.
