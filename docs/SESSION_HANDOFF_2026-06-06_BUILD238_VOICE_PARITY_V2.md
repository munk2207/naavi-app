# Session Handoff — 2026-06-06 — Voice Parity Investigation (Part 2)

## Session Goal
Close Items 1–6 from the voice vs mobile parity list. Items 1, 2, 3 already confirmed passing. This session focused on Items 4, 5, 6 and fixing the contact lookup pipeline.

---

## What Was Done This Session

### ✅ Keyterm Boost Fix
- Name keyterms now sent to Deepgram as `Fatma:5` (with boost) instead of plain `Fatma`
- File: `naavi-voice-server/src/index.js` — `buildDeepgramUrl()`

### ✅ Phone Before Email (all locations)
Fixed in 4 places — contact lookup was returning email before phone even when phone exists:
- `naavi-voice-server/src/index.js` — bypass handler (line ~2344) and `arch1HandleLookupContact`
- `supabase/functions/lookup-contact/index.ts`
- `supabase/functions/naavi-chat/intentHandlers.ts`
- `supabase/functions/naavi-chat/index.ts`
- `supabase/functions/assistant-fulfillment/index.ts`

### ✅ batchGet Fix (Google People API)
`searchContacts` endpoint does not reliably return phone numbers even when in `readMask`. Fixed in all locations by adding a `people:batchGet` call after search to fetch full contact data.
Fixed in:
- `supabase/functions/lookup-contact/index.ts` — primary fix
- `supabase/functions/naavi-chat/intentHandlers.ts`
- `supabase/functions/naavi-chat/index.ts`
- `supabase/functions/assistant-fulfillment/index.ts`

### ✅ ARCH-1 Classifier — Removed PERSON_LOOKUP
`PERSON_LOOKUP` intent removed from Haiku classifier — was causing global search hallucination for "find Fatma". All name lookups now route through `LOOKUP_CONTACT`.

### ✅ Contact Not Found → Prompt to Spell
When `arch1HandleLookupContact` returns no results, Naavi now says:
*"I didn't find [name]. Could you spell that name for me, letter by letter? For example, F A T M A."*
And automatically enters `awaiting_spell` mode.

### ✅ ARCH1_CANDIDATE_RE Widened
"find [name]" pattern broadened to catch more variants. Syntax error was introduced, then fixed. Server is now ACTIVE.

### ✅ Sami Al-Husseini — Working
- Deepgram transcribes "Find Sami" correctly
- ARCH-1 fires → LOOKUP_CONTACT → phone returned: *"Sami Al-Husseini — (613) 290-5576"* ✅

---

## Open Issue — Fatma (Root Cause Confirmed from Logs)

**Observation (from Railway logs, Jun 6 19:08:11 EST):**
- User said "find Fatma"
- Deepgram transcribed: **"Fatima."** — dropped the word "find" entirely
- `user_message: "Fatima."` went to Claude with no verb
- Claude ran GLOBAL_SEARCH → hallucinated reminder data

**This is NOT a code bug we introduced.** Deepgram drops the leading verb sometimes. The widened `ARCH1_CANDIDATE_RE` cannot help when "find" is missing from the transcript.

**Proposed fix (NOT yet implemented — next session decision):**
When the entire utterance is a bare proper name (1–2 words, no verb), route to `LOOKUP_CONTACT` instead of Claude. On a voice call, a bare name always means "find this person."

---

## Auto-Tester Status
- 2 tests still erroring on version string mismatch (v104 vs v105)
- Fix: deploy `get-naavi-prompt` Edge Function
- Command: `npx supabase functions deploy get-naavi-prompt --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx`
- Then run `npm run test:auto` — should go 222/222

---

## Next Session Priorities (in order)

1. **Deploy `get-naavi-prompt`** → run `npm run test:auto` → confirm 222/222
2. **Investigate bare-name utterance fix** — when Deepgram drops "find", a bare "Fatima." must still route to LOOKUP_CONTACT not Claude
3. **Test Fatma after fix** — confirm no hallucination
4. **Write session regression tests** (Rule 15a) for all confirmed items
5. **Build 238** — only after auto-tester is 100% green

---

## Voice Server State
- Repo: `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server`
- Branch: `main`
- Latest commit: `d805459` — Fix regex syntax error in ARCH1_CANDIDATE_RE
- Railway: **ACTIVE** ✅
- Sami lookup: working ✅
- Fatma lookup: still hallucinating when Deepgram drops "find" ❌

## Mobile / Edge Functions State
- `lookup-contact` — deployed with batchGet fix ✅
- `naavi-chat` — deployed with batchGet fix ✅
- `assistant-fulfillment` — deployed with batchGet fix ✅
- `get-naavi-prompt` — NOT redeployed this session (v105 in code but old version live)

## Build State
- No new AAB this session
- Next versionCode: **238**
- Auto-tester: **220/222** (2 version-string errors, fix = redeploy get-naavi-prompt)
