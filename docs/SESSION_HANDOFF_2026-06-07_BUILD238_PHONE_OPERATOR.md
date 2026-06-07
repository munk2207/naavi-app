# Session Handoff — 2026-06-07 — Phone-Operator Confirmation State Machine

## What Was Done This Session

### ✅ Phone-Operator Confirmation State Machine (voice server)

Established design principle: **"Naavi, as an old phone operator, will never go to search without 100% knowledge of what is the question."**

Two new qaStates added to `naavi-voice-server/src/index.js`:

**`awaiting_confirm_topic`** — Naavi asks "Are you asking about [X]?"
- yes → enter `awaiting_confirm_name`
- no → re-enter spell flow

**`awaiting_confirm_name`** — Naavi asks "Is [X] a name?"
- yes → contact lookup via `arch1HandleLookupContact`
- no → Naavi asks "What would you like to know about [X]?" (user formulates full question)

### Complete flow (confirmed working ✅):
1. User says garbled/unfamiliar name → ARCH-1 or Claude prompts to spell
2. User spells letter by letter (or NATO in one sentence) → `finalizeSpelling` or SpellingBypass
3. → "Are you asking about [X]?" (awaiting_confirm_topic)
4. → "Is [X] a name?" (awaiting_confirm_name)
5. → contact lookup OR ask full question

### Files changed (voice server only, no AAB needed):
- `naavi-voice-server/src/index.js`
  - `finalizeSpelling` contact_lookup path → enters confirmation flow
  - SpellingBypass → enters confirmation flow instead of direct lookup
  - Added `awaiting_confirm_topic` handler
  - Added `awaiting_confirm_name` handler
  - Fixed "no" branch: ask full question instead of naked `askClaude` call

### Commits (voice server):
- `bd28e58` — Add phone-operator confirmation state machine
- `d4fee83` — Fix awaiting_confirm_name 'no' branch

### ✅ Auto-Tester
- 4 new regression tests in `tests/catalogue/session-2026-06-06.ts`
- 226/226 green

### ✅ get-naavi-prompt deployed
- Fixed 2 version-string test failures (220→226)

---

## Test Results (Wael, 2026-06-07)
- Test 1 (NATO in one sentence — Hussein): **PASSED** ✅
- Test 2 (letter-by-letter spelling — Fatma): **PASSED** ✅
- Test 3 (topic not a name → ask full question): **PASSED** ✅

---

## Voice Experiments — Tried and Reverted

### Andromeda on phone calls — REVERTED
- Switched `textToMulaw` and `createPlayToken` from `aura-hera-en` → `aura-2-andromeda-en`
- Problem: Andromeda (Aura-2) full-buffer generation takes 2-4s vs <1s for Hera (Aura-1)
- Streaming TTS attempted (`streamTTSToTwilio` with 160-byte chunks) — voice quality unacceptable, delay worse
- **Decision: phone calls stay on Hera (`aura-hera-en`)** — fast, clean, no delay
- Website stays on Andromeda — two voices, two surfaces, by design

### Demo line (1-888-91-NAAVI) — Hera assessed, NOT recommended
- Demo line runs on Polly Joanna (Twilio built-in, instant playback)
- Root cause of prior Cora failure (8.6s) was Deepgram fetch latency — applies to ALL Deepgram voices
- Hera is faster (Aura-1) but still requires live Deepgram HTTP call → same latency problem
- **Right fix when ready: pre-baked static MP3s recorded with Hera, served as files**
- Demo line stays on Polly Joanna until that work is done

---

## State
- Voice server: Railway **ACTIVE** ✅, commit `a1283db`
- Auto-tester: **226/226** ✅
- No AAB this session (voice server only)
- Next versionCode: **238** (no mobile changes this session — next AAB stays at 238)

## Next Session Priorities

1. **End-to-end test V237 (build 237)** — full test pass across all features before any new work
2. **Bare-name intercept** — when Deepgram drops "find" and transcribes just "Fatima.", route to confirmation flow instead of Claude (falls through to hallucination currently)
3. **Holding list** — review `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md` for next item
