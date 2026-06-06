# Session Handoff — 2026-06-06 — Voice vs Mobile Parity (Items 1–6)

## Session Goal
Close all 6 Voice vs Mobile Parity items from the Build 237 handoff.

---

## Items Status

### ✅ Item 1 — Voice Live-Calendar Fetch
**CONFIRMED PASSING — Test 1**
- Added `fetchLiveCalendarEvents(userId)` to voice server
- Fetches from Google Calendar API directly (OAuth refresh), falls back to DB cache
- Handles all-day events (null start_time) correctly
- Voice now shows real calendar data just like mobile

### ✅ Item 2 — Stop-Word Interrupt Regression
**CONFIRMED PASSING — Test 2**
- Root cause: `return` only fired when `isSpeaking || isProcessing` — if Naavi paused between sentences, "navi stop" fell through to Claude which replied "I didn't catch that"
- Fix: always `return` on any stop command — never forward to Claude regardless of speaking state
- Commit: `f614910` (voice server)

### ✅ Item 3 — Deepgram First-Word Truncation on Barge-In
**CONFIRMED PASSING — Test 3**
- Fix was in `trivialRe` (made "what" optional) + barge-in timing adjustments
- Committed earlier in session

### ⚠️ Item 4 — Voice Name-Search for Non-English Names
**NOT YET CONFIRMED — Multiple iterations, last deploy not tested**

#### What was discovered
- Deepgram transcribes "Fatma" → "Fatima", "fat amounts", "fathom a", etc.
- Google People API does NOT fuzzy-match "Fatima" → "Fatma" (different enough)
- Spelling bypass approach (F A T M A letter by letter) was unreliable — Deepgram mangles individual letters too
- The right fix: load all contact names as Deepgram keyterms at call start

#### What was shipped (not yet confirmed)
1. **`list-contact-names` Edge Function** (new) — fetches ALL Google Contacts via `connections.list` API, returns first names for keyterm priming. Falls back gracefully.
2. **`fetchKnownNames()` in voice server** — now calls `list-contact-names` in addition to local contacts table + knowledge fragments. All names go to Deepgram as keyterms at call start.
3. **`lookup-contact` exact first-name filter** — "Sami" search was returning Sami + Samiha + Samir (Google fuzzy match too broad). Added exact first-name filter: only returns broader matches when no exact match exists.
4. **`lookup-contact` prefix fallback** — fixed threshold from `> 5` to `>= 4` chars; uses first word only for prefix.

#### What still needs testing (NEXT SESSION PRIORITY)
- Call and say "find Fatma" → should now transcribe correctly (keyterm loaded)
- Call and say "find Sami" → should return only Sami Al-Husseini, not Samiha/Samir
- Call and say a name NOT in MyNaavi community → verify keyterm covers all contacts

#### Known gap
- Spelling bypass (`extractSpelledName`) was left in code but is unreliable. Can be removed once keyterm approach is confirmed working.
- The ARCH-1 classifier (Haiku) was also normalizing names — classifier prompt now says "copy name EXACTLY as spoken."

### ⚠️ Item 5 — B6d Numbered Lists (Prompt Fix)
**SHIPPED, NOT YET VOICE-TESTED**
- `get-naavi-prompt` bumped to `v105` with strengthened Rule 13 (all lists numbered, not just choices)
- Test added: `prompt-regression.b6d-informational-list-numbered`
- Two auto-tester tests still erroring on version string mismatch (see below)
- Not voice-tested this session

### ⚠️ Item 6 — ARCH-1 Deterministic Intent Gate
**SHIPPED, NOT YET FULLY TESTED**
- `voiceClassifyAndHandleIntent()` added to voice server — Haiku classifies intent before Claude
- Level A handlers: LIST_RULES, LOOKUP_CONTACT, CALENDAR_SEARCH, PERSON_LOOKUP, LIST_READ, REMINDER_READ, MEMORY_SEARCH
- Tested indirectly through Items 1 and 4 testing
- Not formally tested as a standalone item

---

## Auto-Tester Status
**222 tests: 220 passed, 0 failed, 2 errored**

Errors are version-string mismatches in two tests:
```
⨯ b6d.prompt-version-bumped-to-v98
  Expected "2026-05-30-v104-..." got "2026-06-06-v105-..."
⨯ session-2026-05-28.b6d-prompt-version-v100
  Expected "2026-05-30-v104-..." got "2026-06-06-v105-..."
```
These tests need their expected version string updated to `2026-06-06-v105-numbered-lists-final-reminder`.

**Rule 15: auto-tester must be 100% green before next build.**

---

## Files Changed This Session

### Voice Server (`naavi-voice-server/src/index.js`)
- `fetchLiveCalendarEvents()` — new function (Item 1)
- `fetchKnownNames()` — now calls `list-contact-names` Edge Function
- `extractSpelledName()` — new function (spelling bypass, unreliable, candidate for removal)
- `voiceClassifyAndHandleIntent()` — ARCH-1 gate (Item 6)
- `arch1HandleLookupContact()`, `arch1HandlePersonLookup()` — ARCH-1 handlers
- Stop-word detection — always return, never forward to Claude (Item 2)
- `trivialRe` — updated (Item 3)

### Supabase Edge Functions
- `list-contact-names` — NEW — fetches all Google Contacts first names for keyterms
- `lookup-contact` — exact first-name filter + prefix fallback fix
- `get-naavi-prompt` — v105, strengthened Rule 13 (Item 5)

### Tests
- `tests/catalogue/session-2026-06-06.ts` — not yet created (Rule 15a gap — next session)
- `tests/catalogue/prompt-regression.ts` — `b6d-informational-list-numbered` added

---

## Next Session Priorities (in order)

1. **Fix the 2 auto-tester version errors** — update expected version string in both tests
2. **Confirm Item 4** — call and say "find Fatma", "find Sami" — verify keyterm approach works
3. **Confirm Item 5** — call and ask for a list-style answer, verify numbered format
4. **Confirm Item 6** — test ARCH-1 gate directly (list my alerts, find contact, calendar search)
5. **Write session-2026-06-06 tests** for all items confirmed this session (Rule 15a)
6. **Build 238** — only after auto-tester is 100% green

---

## Build State
- Main repo: `C:\Users\waela\OneDrive\Desktop\Naavi` (branch: `main`)
- Voice server: `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server` (branch: `main`)
- Last mobile commit: `58e1670` — Item 5 B6d numbered lists
- Last voice commit: `3495468` — list-contact-names keyterm loading
- No new AAB built this session (no mobile code changes)
- Next versionCode: **238** (when ready)
- Auto-tester: **220/222** — 2 errors must be fixed before build
