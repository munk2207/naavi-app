# Phase 1A — Architecture Completeness Review — B11f — The Stop Control on Voice

**Date:** 2026-08-19
**Governance version:** v4.0
**Phase 1:** `docs/B11F_PHASE_1_VOICE_STOP_CONTROL_2026-08-19.md` — approved by review
**Architecture Reference version used:** **`2026.07.18.5`** — must be re-confirmed unsuperseded before Phase 8 merge
**Status:** Complete. **Awaiting Wael's go-ahead for Phase 1A → 2.**

**Provenance:** all findings **[FRESH]** — read from source this session with `file:line`.

---

## 1. The six mandatory questions

**Q1 — What is the architectural owner of the affected capability?**
`naavi-voice-server/src/index.js`, specifically the audio transport that carries synthesised speech to the caller. There is no Shared Core component involved: `streamTTSToTwilio` calls Deepgram's `/v1/speak` endpoint directly (`:5740`), not the `text-to-speech` Edge Function.

**Q2 — Shared Core, Duplicated, or Platform-specific?**
**Platform-specific (Voice-only), Protected Core.** Voice-only *by nature*, not by duplication: a phone call's audio transport has no mobile equivalent, in the same way geofencing has no voice equivalent.

**Q3 — If duplicated, were all documented implementations investigated?**
Not duplicated across surfaces. **But duplicated *within* the voice server** — see §2, which is the substantive finding of this phase.

**Q4 — Which implementations were investigated, and which were not?**
All three surfaces swept — §3. None excluded without justification.

**Q5 — Does the documented problem scope match the Architecture Reference?**
**No — and the mismatch is a gap in the Reference, not in the problem.** §2 of the Architecture Reference has **no row for voice audio transport**. Its capability table describes *what Naavi says*; nothing describes how audio reaches the caller. Phase 1 flagged this as **"Architecture location not proven"** and resolved it by fresh grep, which is what governance requires. **Adding that row is carried as a Phase 8 merge precondition.**

**Q6 — Is any documented implementation excluded from the investigation?**
No. One is explicitly declared out of scope with justification — `sendAudioToTwilio`, §2.2.

## 2. ⭐ The finding: two audio paths inside the voice server

Phase 1 named `streamTTSToTwilio` as the cause. This phase asked the question Phase 1 did not: **is it the only sender?** It is not.

| Path | Call sites | Shape | Affected? |
|---|---|---|---|
| `streamTTSToTwilio` (`:5730`) | **14** | **Asynchronous** — reads Deepgram's stream and pushes frames as they arrive | **YES — the defect lives here** |
| `sendAudioToTwilio` (`:5802`) | **43** | **Synchronous** — the whole buffer is already in memory and is queued in one pass | **No — see §2.2** |

### 2.1 Why the defect is confined to the streaming path

The distinction is *not* which function is "newer" — it is whether a producer is still running when `clear` arrives.

`clear` drains what Twilio has buffered. It cannot address a producer.

- `streamTTSToTwilio` is **still producing** when barge-in fires. Twilio's buffer empties, and the loop refills it on the next `reader.read()`. **This is the conversational reply path** — all 14 call sites are immediately preceded by `isSpeaking = true` (e.g. `:10758`, `:10796`, `:10811`). It is what a caller hears when Naavi answers a question, which is exactly when Wael wants to interrupt.
- `sendAudioToTwilio` has **finished producing** before control returns — a plain `for` loop over an in-memory buffer (`:5822-5832`). By the time any transcript could be processed, everything is already queued at Twilio, so `clear` drains all of it. Interruption already works on this path.

### 2.2 Explicit out-of-scope declaration (Architecture Scope Rule)

**`sendAudioToTwilio` and its 43 call sites require no matching change.** Justification: it is synchronous and has no post-`clear` production window, so the failure mode described in Phase 1 cannot occur there. Governance forbids silence in either direction, so this is stated rather than assumed.

**⚠️ Constraint this places on Phase 2:** the fix must **not** be applied by changing how `clear` is issued, or by altering shared interrupt sites in a way that assumes one sender. A change at the interrupt site touches both paths; a change inside `streamTTSToTwilio` touches one. **Phase 2 should prefer the narrower blast radius**, which matters because this file is Protected Core with 43 call sites of the other function.

## 3. Cross-Repository Verification — all three surfaces

| Surface | Equivalent logic? | Evidence | Needs a matching change? |
|---|---|---|---|
| **Voice** | The defect itself | `src/index.js:5763-5779` — send loop with no cancellation path | **Yes** — this work item |
| **Mobile** | **Yes, and it works** | `hooks/useOrchestrator.ts:5068` `stopSpeaking()` | **No** — see §3.1 |
| **Shared Core** | **Not involved** | `text-to-speech` returns a complete response body (`supabase/functions/text-to-speech/index.ts`); it is a synthesis endpoint, and the client owns playback. Voice does not call it at all — `streamTTSToTwilio` goes straight to Deepgram (`:5740`) | **No** |

### 3.1 ⭐ Mobile already solved this exact problem — adopt its pattern, do not invent one

Mobile's `stopSpeaking()` uses a **generation counter**:

```js
let _speechGen = 0;                       // :5048
export function stopSpeaking(): void {
  _speechGen++;                           // :5070 — invalidate any in-flight speakResponse
  ...
}
// inside the speak path:
const myGen = ++_speechGen;               // :5148
const isStale = () => _speechGen !== myGen;   // :5149
```

The playback loop checks `isStale()` and bails (`:5400`). **That is precisely Phase 1's Option A**, already proven in production on the other surface.

Two details worth carrying across, both learned the hard way on mobile:

1. **Increment before anything else.** `stopSpeaking` bumps the counter first, so an in-flight loop bails at its next check even if teardown is still running.
2. **Capture state before firing cleanup.** A recorded mobile bug (`B-NEW-4`, comment at `:5071`) was that cleanup nulled `_currentSound` before the stop path read it, so `stopAsync()` was never called and playback continued on Android. **The voice fix has the same hazard**: whatever cancellation flag is introduced must be read in an order that does not depend on teardown having run.

**This is not a duplication to be consolidated.** The two implementations sit on structurally different transports — a React Native audio player versus a Twilio WebSocket. What transfers is the *pattern*, not the code.

## 4. Does the problem scope match the Reference?

**Two gaps, both recorded rather than worked around:**

1. **No row for voice audio transport in §2** (Q5). Carried as a Phase 8 precondition. Its absence is the reason this defect had no documented owner, and the reason Phase 1 had to declare "architecture location not proven".
2. **The intra-voice-server duplication of audio senders is undocumented anywhere.** §5a's Duplication Inventory does not list it. Two send paths with materially different cancellation semantics is exactly the sort of thing that inventory exists to surface — and the fact that Phase 1 named one without noticing the other is the evidence that it should be listed.

## 5. What this phase changes about the plan

Phase 1 recommended Option A. **Phase 1A does not change that recommendation, and narrows it:**

- The fix belongs **inside `streamTTSToTwilio`**, not at the interrupt sites — smallest blast radius in a Protected Core file.
- It should follow **mobile's generation-counter pattern**, which is proven, rather than a new design.
- `sendAudioToTwilio`'s 43 call sites are explicitly untouched.

## 6. What this phase does not authorize

No code. Phase 2 (change plan) follows on Wael's explicit go-ahead, and carries the five open questions — Phase 1's four, plus the fifth raised after the Phase 1 review: **what happens to non-stop-word speech during playback**, once any-speech barge-in is no longer an active stop mechanism.
