# Session Handoff — 2026-06-06 — Build 237 — Voice vs Mobile Parity

## What Shipped This Session

**Build 237 (V57.47.0)** — all 5 bugs confirmed passing on device.

| Bug | Description | Status |
|-----|-------------|--------|
| Bug 1 | Pre-confirmation (Rule 12) for possessive address path (e.g. "James's home") | ✅ Passed |
| Bug 2 | Address not repeated in place picker speech | ✅ Passed |
| Bug 3 | Tasks merged correctly after picker Yes confirmation | ✅ Passed |
| Bug 4 | "Say yes to send" prompt in speech + DraftCard shows "Sent" after voice Yes | ✅ Passed |
| Bug 5 | "List my/me email alerts" filters correctly (regex handles "me" + type after "alerts") | ✅ Passed |

**APK:** https://expo.dev/artifacts/eas/w2q3Uc1vntTsH96NdAbAPT.apk
**AAB:** Submitted to Google Play Internal Testing ✅

---

## ⭐⭐⭐ NEXT SESSION TARGET — CLOSE VOICE VS MOBILE PARITY

The entire next session is dedicated to closing every open gap between the voice surface and the mobile surface. Do not start other work until this list is complete.

### 1. Voice Live-Calendar Fetch
**Gap:** Voice cannot read the user's calendar. Mobile can.
**Fix path:** Wire `fetchLiveCalendarEvents()` into the voice server's Claude context (same pattern as B6e mobile fix — server-side bypass in `naavi-voice-server/src/index.js`).
**Holding list ref:** Item 5.

### 2. Voice Stop-Word Interrupt Regression
**Gap:** "Naavi stop" no longer interrupts TTS mid-playback on the voice call.
**Fix path:** Voice server (`naavi-voice-server/src/index.js`) — stop-word detection was broken in a prior session. Trace the barge-in/stop-word path and restore interrupt behavior.
**Holding list ref:** Item 7.

### 3. Voice Deepgram First-Word Truncation on Barge-In
**Gap:** When the user interrupts (barge-in), Deepgram drops the first word of the new utterance.
**Fix path:** Voice server — add leading silence buffer or adjust barge-in timing before Deepgram STT starts.
**Holding list ref:** Item 8.

### 4. Voice Name-Search Phonetic Fallback
**Gap:** "Hussein" and similar names break on voice STT (text handles them fine). Voice server has no phonetic fallback.
**Fix path:** Voice server — add phonetic/fuzzy matching in contact lookup before returning "not found."
**Holding list ref:** Item 9.

### 5. B6d — All Lists Must Be Numbered (Prompt Fix)
**Gap:** Claude sometimes renders option lists as bullets (•) instead of numbered (1./2./3.) — intermittent, prompt-shape-dependent. Violates Rule 13.
**Fix path:** Strengthen Rule 13 in `supabase/functions/get-naavi-prompt/index.ts` to explicitly cover all lists, not just choices. Add prompt-regression test.
**Holding list ref:** B6d.

### 6. ARCH-1 — Deterministic-First Architecture (Layer 2 Intent Gate)
**Gap:** Naavi's responses are probabilistic. Layer 2 (intent verification gate — high confidence → deterministic execution, low confidence → confirm with Robert, out-of-scope → honest-out) is not built.
**Fix path:** Dedicated 3-5 hour sub-session. Requires: complete intent taxonomy → `get-naavi-prompt` changes → `naavi-chat` routing logic → test suite additions.
**Note:** Do NOT start ARCH-1 until items 1-5 above are done. ARCH-1 is the largest item and needs its own focused block.
**Holding list ref:** ARCH-1.

---

## Already Confirmed Closed (Do Not Reopen)

- DELETE_EVENT, LIST_RULES, DELETE_MEMORY on voice — ✅ F4a closed 2026-05-19
- B4e — DELETE_MEMORY voice vs mobile drift — ✅ CLOSED 2026-05-23 (no drift)

---

## Other Open Items (Not This Session)

- Alert task editing (chips with remove) → deferred to web management screen
- Firebase Test Lab — on hold (Rule 15b) until end-to-end review process established
- ARCH-1 prerequisites: full intent taxonomy must be defined before coding begins

---

## Build State

- Main repo: `C:\Users\waela\OneDrive\Desktop\Naavi` (branch: `main`)
- Build clone: `C:\Users\waela\naavi-mobile` (branch: `main`, synced)
- Last commit: `8785f49` — Bump to V57.47.0 build 237
- Auto-tester: was green before build (Rule 15 satisfied)
- Next versionCode: **238**
