# Session 15 — Complete Handoff
**Date:** Saturday, April 18, 2026  
**Focus:** Voice reliability fixes + Morning brief improvements  
**Next session:** Global Search & Knowledge Base Access

---

## What Was Done This Session

### 1. Deepgram Watchdog Fix (commit `8127dac`)
**Problem:** Deepgram connected but sent a metadata message immediately on open, which cleared the watchdog before the 6-second timer expired. Silent-hang was never detected.  
**Fix:** Watchdog now only clears on a `Results` message — metadata/open messages are ignored.  
**File:** `naavi-voice-server/src/index.js` — `deepgramWs.on('message')` handler

### 2. Weather on Voice Calls (commit `f7e57f2`)
**Problem:** User asked "what is the weather today" — Naavi said "I don't have access to weather information."  
**Fix:** Detect weather-related keywords in the user message. If matched, call `fetchWeather()` alongside calendar fetch and include weather in Claude's context.  
**File:** `naavi-voice-server/src/index.js` — `processUserMessage()` around line 782  
**Keywords trigger:** weather, temperature, forecast, rain, snow, sunny, cloudy, cold, hot, degrees, celsius, humid, wind, umbrella, outside

### 3. Morning Brief Saved to Drive on Missed Calls (commit `25fd129`)
**Problem:** After 3 missed call attempts, briefing content was lost — only an SMS was sent.  
**Fix:** On 3rd missed attempt, generate the full briefing (weather + calendar + reminders + emails), save it to Drive under the MyNaavi folder titled "Morning Brief — [date]", include the Drive link in the SMS/WhatsApp/push alert.  
**File:** `naavi-voice-server/src/index.js` — `/call-status` webhook, `attempts >= 3` block

### 4. Missed-Call Alert Messages Updated (commits `fc83821` + send-sms deploy)
**Problem:** Alert said "Hi there, Robert shared this message with you..." — wrong name, wrong format.  
**Fix:**  
- Voice server now fetches `name` from `user_settings` in the call-status handler  
- `sendAlerts()` passes `recipient_name` and `sender_name: 'Naavi'` to send-sms  
- send-sms Edge Function updated to use `ContentSid` + `ContentVariables` for WhatsApp template  
- SMS now reads: "Hi Wael, Naavi tried calling you 3 times... Your briefing is on Drive: [link]"  
- WhatsApp now reads: "Hi Wael, Naavi shared this message with you: tried calling you 3 times... [link] — Sent via MyNaavi."  
**Files:** `naavi-voice-server/src/index.js`, `supabase/functions/send-sms/index.ts`

---

## Current System State

| Area | Status |
|------|--------|
| Voice call — STT (Deepgram nova-3) | Working, watchdog active |
| Voice call — Claude (Sonnet) | Working, shared prompt from Edge Function |
| Voice call — TTS (Deepgram aura-hera-en) | Working, Stage 2 streaming |
| Voice call — weather questions | Working |
| Voice call — list lookup | Working (fuzzy match for "Costco list" → "Costco") |
| Morning brief — call delivery | Working |
| Morning brief — missed → Drive save | Working (new this session) |
| Morning brief — missed → SMS/WhatsApp | Working with correct name |
| Deepgram silent-hang watchdog | Working (fixed this session) |

---

## Next Session — Global Search & Knowledge Base Access

### The Problem

Right now, Naavi's data is siloed:
- **Knowledge fragments** — stored in `knowledge_fragments` table, searched per question
- **Google Drive** — searched only when user explicitly says "search my Drive"
- **Emails** — fetched for morning brief only
- **Calendar** — fetched per voice turn
- **Contacts** — looked up per message/call action
- **Lists** — only when user mentions a specific list name

There is no unified "find everything about X" capability. If Robert asks "do I have anything about my insurance?" — Naavi checks knowledge fragments only. It misses the Drive document, the email from the broker, and the calendar appointment for the renewal.

### What to Build

#### Feature 1 — Global Search ("find everything about X")
A single command that searches ALL data sources in parallel and returns ranked results.

**Trigger phrases:**
- "find anything about..."
- "search for..."
- "do I have anything on..."
- "what do I have about..."
- "look up..."

**Sources to search in parallel (Promise.all):**
1. `knowledge_fragments` — REMEMBER items, notes, stored facts
2. Google Drive — documents, notes saved via SAVE_TO_DRIVE
3. Gmail — emails matching the query
4. Calendar — events matching the query
5. Contacts — people matching the query
6. Lists — list items matching the query

**New action type:** `GLOBAL_SEARCH`
```json
{ "type": "GLOBAL_SEARCH", "query": "insurance" }
```

**New Edge Function:** `global-search`
- Accepts `{ query, user_id }`
- Runs all 6 lookups in parallel
- Returns ranked results grouped by source
- Voice server reads top 2-3 results aloud
- Mobile app shows full list with source icons

#### Feature 2 — Knowledge Base Management ("what do you know about me?")
Currently when Robert asks "what do you know about me?", Claude reads raw knowledge fragments. No structure, no categories, no way to edit.

**What to build:**
- **Auto-tagging on save:** When a REMEMBER action fires, Claude categorizes it (medical, family, financial, legal, property, routine, preference, other)
- **Tag stored in:** `knowledge_fragments.tags` column (add via migration)
- **Browsable by category:** "What do you know about my medical stuff?" → shows only medical-tagged fragments
- **Editable:** "Forget that I said X" already works via DELETE_MEMORY. "Update my doctor to Dr. Smith" → replaces old fragment.
- **Expiry flag:** Some memories should be temporary. "Remember I'm out of milk" → tag as `expires_after: 7 days`

**Schema addition:**
```sql
ALTER TABLE knowledge_fragments 
  ADD COLUMN tags text[] DEFAULT '{}',
  ADD COLUMN expires_at timestamptz DEFAULT NULL;
```

#### Feature 3 — Proactive Knowledge Surfacing
When Naavi detects a calendar event coming up, automatically surface relevant knowledge without being asked.

**Example:**
- Calendar event: "Dentist appointment Friday 2pm"
- Naavi proactively includes in morning brief: "I also have a note that your dentist is Dr. Ahmed at 123 Main Street, and your last visit was January 15."

**How:** In morning brief context builder, for each calendar event — run a quick `searchKnowledgeForPerson(eventTitle, userId)` and append any matches.

---

## Architecture — What Already Exists

| Component | Status | Notes |
|-----------|--------|-------|
| `knowledge_fragments` table | Exists | Has `content`, `user_id`, `created_at` |
| `search-knowledge` Edge Function | Exists | Semantic search via embeddings |
| `ingest-note` Edge Function | Exists | Adds to knowledge_fragments |
| `search-google-drive` Edge Function | Exists | DRIVE_SEARCH action |
| `gmail_messages` table | Exists | Populated by email sync |
| `DRIVE_SEARCH` action | Exists | Already in Claude prompt (Rule 10) |
| `REMEMBER` / `DELETE_MEMORY` actions | Exists | Rules 5 + 11 |

**What needs to be built:**
- `global-search` Edge Function (new)
- `GLOBAL_SEARCH` action type in Claude prompt + voice server executor
- `tags` + `expires_at` columns on `knowledge_fragments`
- Auto-tagging logic in `ingest-note` Edge Function
- Knowledge category browsing in Claude prompt rules

---

## Ideas to Consider Before Building

### 1. Voice vs App — Different Result Formats
On a voice call, reading 6 search results is too long. Design a two-tier response:
- Voice: "I found 3 things. A note from January, a Drive document, and an email from last week. Want me to read any of them?"
- App: Full list with source icons, tap to open

### 2. Search Quality — Embeddings vs Keyword
`search-knowledge` uses semantic embeddings (good for meaning). For Drive/email/calendar, keyword search is faster. Use embeddings for knowledge fragments, keyword for the rest. Merge results by relevance score.

### 3. Knowledge Expiry Cron Job
Add a pg_cron job that runs daily and deletes `knowledge_fragments` where `expires_at < now()`. Small job, big value — prevents stale memories accumulating.

### 4. "What do you know about me?" — Read Limit
Currently reads ALL fragments. With enough usage this becomes a 2-minute monologue. Add a limit: read the 10 most recent, offer "want to hear more?"

### 5. Privacy — Sensitive Tags
Medical and financial fragments should be flagged. On voice calls, if Robert is not alone ("put me on speaker"), Naavi should offer to send the info as an SMS instead of reading it aloud.

---

## Files to Read at Start of Next Session

| File | Why |
|------|-----|
| `supabase/functions/search-knowledge/index.ts` | Understand current search logic before extending |
| `supabase/functions/ingest-note/index.ts` | Where to add auto-tagging |
| `supabase/functions/search-google-drive/index.ts` | Understand Drive search to incorporate into global search |
| `naavi-voice-server/src/index.js` lines 1168–1185 | DRIVE_SEARCH action executor — model for GLOBAL_SEARCH |
| `naavi-voice-server/src/index.js` lines 845–870 | How entity/knowledge lookup works per turn |

---

## Commits This Session

| Commit | Description |
|--------|-------------|
| `8127dac` | fix: watchdog clears only on Results, not metadata open message |
| `f7e57f2` | feat: fetch live weather for voice call weather questions |
| `25fd129` | feat: save morning brief to Drive on 3rd missed call |
| `fc83821` | fix: use actual user name in morning-brief missed-call alerts |
| send-sms deploy | Updated to use ContentSid + ContentVariables for WhatsApp template |
