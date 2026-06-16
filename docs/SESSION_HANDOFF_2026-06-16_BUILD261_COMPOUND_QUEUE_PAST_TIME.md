# Session Handoff — 2026-06-16 — Build 261 — Compound Queue + Past-Time Fixes

## Build Status
- **Build 261** ✅ submitted to Google Play Internal Testing
- **316/316 auto-tester** ✅ green (ran before this session's AAB)
- **Firebase Test Lab** ✅ PASSED (Pixel 6 Android 13 + Samsung S22 Android 14)

## What Was Shipped This Session

### Voice Server (`naavi-voice-server`) — committed + auto-deployed to Railway

**Compound queue B4y bypass** (commit 20dfe01)
- Problem: compound multi-action requests (e.g. "Book meeting with Bob. Add item to list. Set alert.") were executing the first intent but silently dropping subsequent actions — the B4y Phase 2 gate was rejecting them because sub-task user messages ("Book meeting with Bob") don't look like "yes" confirm replies.
- Fix: added `opts.skipConfirmGate` flag to `askClaude`. Compound sub-task calls now pass `{ skipConfirmGate: true }` — the queue IS the confirmation layer.
- Also fixed `executeDraft` returning `undefined` on contact-not-found (now returns `{ok:false, error:'contact_not_found'}`).
- Also added Turn 2 fallback to `continuationTasks` path (Deepgram chunk 2 tasks were queued with empty actions).

**Calendar 7-day window** (commit 13c0862)
- Problem: `fetchCalendarEvents` Supabase fallback used a 2-day window for all-day events — a birthday on June 18 was invisible when fetched on June 16.
- Fix: extended `briefWindow` and `allDayUrl` upper bound from 2 days to 7 days.
- Note: the 2-day limit was set by a prior Claude session (B4q fix) without Wael approving it.

### Main Repo (`naavi-app`) — committed + in build 261

**Past-time calendar event rejection** (commit 3c3cb56)
- Problem: Naavi created calendar events at past times (user said "book meeting at 11 AM" when it was 3:23 PM).
- Fix: added PAST-TIME RULE to `get-naavi-prompt` Edge Function. Claude checks whether the requested time has already passed and rejects with "11 AM today has already passed. What time did you mean?" — timezone-agnostic (works for travelers).
- Decision: server-side Eastern timezone check was considered and rejected — hardcoding EST is wrong for users calling from other timezones. Prompt rule is correct because Claude uses the time shown in the prompt, which matches the user's local time as reported by their phone.

**Capability question answer restored** (commit 896c9dc)
- Restored structured sections with examples after a prior session accidentally degraded the answer.

**Build 261 version bump** (commit fd972d6)
- `app.json`: version `1.0.261`, versionCode `261`
- `app/settings.tsx`: `MyNaavi — V57.58.0 (build 261)`

## Next Session — Review Build 261 in Detail

Test the following on the phone after installing from Google Play Internal Testing:

### 1. Compound multi-action queue
Full 4-task test:
> "Book a meeting with Bob for Thursday at 2 PM. Remind me to call Jasmine tomorrow morning. Add milk to my shopping list. Alert me when I arrive home."

Expected: Naavi walks through each sub-task one by one, asking "say yes to confirm" for each. All 4 actions execute.

Known open bug: if Deepgram splits the utterance across two chunks, Task 1 (first sentence) may be dropped — it goes through the regular path and gets no "yes" because the compound queue consumes subsequent replies.

### 2. Past-time rejection
Test: "Today is Tuesday, book a meeting for Tuesday at [time that already passed]"
Expected: "X AM today has already passed. What time did you mean?"

Test: "Book a meeting for Thursday at 2 PM" (future)
Expected: Normal create_event flow.

### 3. Jasmine birthday (calendar window)
Test: "Remind me the day before Jasmine's birthday" (birthday June 18)
Expected: Naavi finds the birthday and says "I'll remind you the day before Jasmine's birthday, which is Wednesday June 17."

### 4. Capability question
Test: "What kinds of complex questions are you equipped to handle?"
Expected: Detailed structured answer with section headers and examples — NOT generic "I handle your life" prose.

## Open Items (NOT in build 261)

| # | Item | Priority |
|---|------|----------|
| 1 | Compound queue: Bob's meeting dropped when Deepgram splits 4-sentence utterance | Medium |
| 2 | "Saved to memory" wording — too technical for Robert; should say "Got it, I'll remember that" | Low |
| 3 | Deepgram echo/feedback (TTS picked up by caller's mic) — Wael said do not investigate | Deferred |
| 4 | Rule 15a: no new auto-tester tests added for compound queue bypass / past-time rule / calendar window | Open |

## Key Files Changed This Session

| File | Repo | Change |
|------|------|--------|
| `naavi-voice-server/src/index.js` | naavi-voice-server | B4y bypass, calendar 7-day window, executeDraft fix |
| `supabase/functions/get-naavi-prompt/index.ts` | naavi-app | Past-time rule, capability answer restored |
| `app.json` | naavi-app | versionCode 261 |
| `app/settings.tsx` | naavi-app | build 261 label |

## Branch State
- Main repo (`naavi-app`): `main` at commit `fd972d6`
- Build clone (`C:\Users\waela\naavi-mobile`): synced to `fd972d6`
- Voice server (`naavi-voice-server`): `main` at commit `13c0862`
