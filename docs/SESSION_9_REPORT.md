# Session 9 Report — April 14-15, 2026

## CURRENT STATE

### Voice Server: PARTIALLY BROKEN
- Server is running on Railway (responds to HTTP and WebSocket tests)
- Calls intermittently fail — phone rings but no greeting, busy tone
- When it works: calendar, contacts, WhatsApp, lists, memory, voice confirm all function
- Last working state was around commit `0eaadc6` (before music re-add)

### Mobile App: V50 build 90 — STABLE (unchanged this session)

---

## WHAT WAS ACCOMPLISHED

### Railway Setup (DONE)
- Deleted old "overflowing-luck" service, created fresh "naavi-voice-server"
- 6 Railway variables: ANTHROPIC_API_KEY, DEEPGRAM_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
- New Railway URL: naavi-voice-server-production.up.railway.app
- Twilio webhook updated to new URL
- Old Anthropic API key deleted, new one created
- New Deepgram API key created ("Railway Voice Server 2")

### Voice Server Features Built (DONE)
1. **Date/time** — Eastern timezone (was UTC)
2. **Naavi pronunciation** — "Nahvee" for TTS
3. **Supabase connected** — calendar, contacts, WhatsApp, lists, memory
4. **Direct Claude call** — skips Supabase hop for speed
5. **Background actions** — execute after TTS, don't block response
6. **Voice confirm** — yes/no for drafts (email, WhatsApp, SMS)
7. **Contact lookup** — searches Google Contacts via People API
8. **Calendar context** — next 7 days injected into every Claude call
9. **Knowledge search** — stored memories injected into prompt
10. **Barge-in** — interrupt Naavi by speaking
11. **Stop words** — "stop", "got it", "enough" cut response short
12. **Idle prompt** — "Robert, are you still there?" after 10s silence, hangup after 3 prompts
13. **Spelling detection** — "spelled H-E-A-G-G-A-N" → "Heaggan"
14. **Thinking music** — ambient chord plays during processing
15. **Greeting** — "Naavi here, how can I help you Robert?"
16. **TTS slowdown** — pauses between sentences
17. **Self-ping** — prevents Railway cold start (pings every 4 minutes)

### Edge Functions Created/Updated
- `manage-list` — new Edge Function for list operations (create, add, remove, read)
- `lookup-contact` — updated to support service role key (voice server)
- `search-knowledge` — updated to support service role key (voice server)

---

## BUGS AND ERRORS MADE THIS SESSION

### 1. Railway variable delivery (FIXED)
- **Problem**: Old Railway service didn't deliver 3 of 4 env vars
- **Fix**: Deleted entire service, created fresh one
- **Lesson**: When Railway variables are stuck, delete and recreate

### 2. Wrong calendar column name (FIXED)
- **Problem**: Used `summary` instead of `title` for calendar_events table
- **Fix**: Changed to `title`
- **Lesson**: Check actual DB column names, don't assume

### 3. Knowledge search parameter name (FIXED)
- **Problem**: Sent `{ query }` instead of `{ q }` to search-knowledge Edge Function
- **Fix**: Changed to `{ q: query }`

### 4. Contact lookup auth failure (FIXED)
- **Problem**: lookup-contact Edge Function required JWT user token, voice server sends service role key
- **Fix**: Updated Edge Function to fall back to finding user from gmail_messages table
- **Lesson**: All Edge Functions called by voice server need service role key support

### 5. search-knowledge auth failure (FIXED)
- **Problem**: Same as #4 — required JWT, got service role key
- **Fix**: Same pattern — added fallback user resolution
- **Later**: Switched to direct DB query to bypass Edge Function entirely

### 6. Person name regex bug (FIXED)
- **Problem**: "What do you know about Sarah?" → regex captured "about" not "Sarah"
- **Fix**: Reordered regex to match "know about" before "about"

### 7. Knowledge fragments — Claude ignoring them (PARTIALLY FIXED)
- **Problem**: 20 fragments loaded from DB but Claude said "I don't have preferences"
- **Root cause 1**: Knowledge section label was too generic — Claude didn't know to read it
- **Root cause 2**: Fragments include task/meeting notes mixed with real preferences
- **Fix 1**: Added strict instruction telling Claude to read ONLY from that section
- **Fix 2**: Filtered by type (preference, relationship, routine, etc.)
- **Status**: Still mixing some irrelevant items — needs further filtering or DB cleanup

### 8. "Are you still there?" during TTS playback (FIXED)
- **Problem**: Idle timer kept running while Naavi was speaking a long response
- **Fix**: Clear idle timer when TTS starts, restart when TTS ends

### 9. manage-list Edge Function didn't exist (FIXED)
- **Problem**: Voice server called `manage-list` but no such function existed
- **Fix**: Created the Edge Function

### 10. Music blocking speech recognition (REVERTED then RE-ADDED)
- **Problem**: Ambient music sent to Twilio stream confused Deepgram STT
- **Fix**: Removed music during idle waiting, only play during processing
- **Later**: Re-added with delay — may be causing current call failure

### 11. SSML prosody tags in greeting (REMOVED)
- **Problem**: Added `<prosody volume="x-loud">` to make "Naavi here" louder
- **Concern**: May have broken Twilio's Say verb (unconfirmed)
- **Fix**: Removed SSML, back to plain text

### 12. Call connection failures (CURRENT — NOT FIXED)
- **Problem**: Calls intermittently fail — 2-4 attempts needed before connecting
- **Possible causes**:
  - Railway container switching during redeployment
  - Music starting on WebSocket `start` event conflicting with greeting
  - Self-ping keeping server alive but not the WebSocket handler
  - Too many rapid deployments causing Railway to cycle containers
- **Last known good commit**: `0eaadc6` (before music re-add to idle waiting)
- **Current commit**: `745181e`
- **NEXT SESSION SHOULD**: Revert to `0eaadc6` and add features one at a time

---

## ARCHITECTURE DECISIONS

1. **Direct Claude call** (not through Supabase) — faster response, Supabase only for actions
2. **Background action execution** — TTS plays first, actions run after
3. **Direct DB queries** for contacts and knowledge — faster than Edge Functions, avoids auth issues
4. **Self-ping** to prevent Railway cold start
5. **Deepgram Aura TTS** for phone (not OpenAI) — native mulaw format, no conversion needed

---

## FILES CHANGED

### Voice Server (naavi-voice-server/src/index.js)
- Complete rewrite from Step 3b to Step 4
- ~1060 lines

### Edge Functions
- `supabase/functions/manage-list/index.ts` — NEW
- `supabase/functions/lookup-contact/index.ts` — updated auth
- `supabase/functions/search-knowledge/index.ts` — updated auth

### CLAUDE.md
- Added rule #4: detailed step-by-step instructions for non-technical user

### Memory files updated
- `project_naavi_active_bugs.md` — current state
- `feedback_detailed_instructions.md` — NEW

---

## NEXT SESSION PRIORITIES

1. **FIX CALL RELIABILITY** — revert to last working state (`0eaadc6`), then add features one at a time
2. **Fix knowledge/preferences** — clean DB or better filtering
3. **Music during idle** — find approach that doesn't break calls or STT
4. **Hey Google** — not working on phone
5. **Outbound calls** — Naavi calls Robert for morning brief

---

## GIT COMMITS THIS SESSION (voice server)

```
745181e Delay music 5s after stream start so greeting plays fully first
07480b2 Fix greeting — remove SSML prosody tags that may break Twilio Say
6f6dcd8 Re-add ambient music during idle waiting
140b00e Prevent cold start — self-ping every 4 minutes
e430199 Filter knowledge to preferences/relationships/routines only
1ba5102 Strict: read stored items then STOP
adde30b Debug: log system prompt length and knowledge preview
311fc4f Fix knowledge — always load all fragments
fe0546b Strict knowledge rule — quote exactly, never add or infer
b830e25 Fix: only read stored knowledge + pause idle timer during TTS
52ed32a Slow down TTS — add pauses between sentences
16d8811 Fix knowledge — label clearly so Claude reads stored preferences aloud
6e202b9 Add detailed logging for knowledge search debugging
1a8b7a0 Search knowledge_fragments directly from DB
a402f8a Fix greeting — remove pause between Naavi and Robert
67ed65b Add 'Robert are you still there?' + fix preference/knowledge search
0eaadc6 Only play music during processing — not while waiting for speech
a85baed Add stop words (stop, enough, got it, ok, thanks)
6cd4b5f Play music after every response + remove fade-in
fed4e13 Constant volume thinking music
b49c71d Loop music continuously, fix greeting volume, stop music on barge-in
c254d78 Change greeting + play ambient music while waiting
78fd70b Change greeting to 'Naavi here. How can I help you Robert?'
52a7437 Add spelling detection
5bbac9f Add thinking chime
4b38474 Add barge-in + fix fabrication about people
f3669d3 Fix person lookup — query DB directly, add calendar search
1794936 Fix person name regex
5921e0e Use lookup-contact Edge Function (now supports service key)
7e0a93e Fix calendar (title not summary), knowledge (q param), contact (nested response)
4ba7300 Add calendar, knowledge, and contact context to voice calls
22fbe82 Direct Claude call + background action execution for speed
99a5ce3 Reduce silence detection to 1s for faster response
7023e3b Add lists, contact lookup for WhatsApp/email, trim prompt
31ca3a1 Step 4: Connect voice server to Supabase naavi-chat with action execution
6bd5dad Fix Naavi pronunciation — spell as Nahvee for TTS
528361e Fix date/time — use Eastern timezone instead of UTC
```
