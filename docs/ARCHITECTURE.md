# NAAVI
## Technical Architecture Document
**Version:** 2.0 &nbsp;|&nbsp; **Date:** March 19, 2026 &nbsp;|&nbsp; **Status:** Phase 8 — Live

---

# Naavi — Technical Architecture Document
**Prepared for:** CTO Review
**Date:** March 19, 2026
**Version:** 2.0
**Build Status:** Phase 8 complete — live and fully integrated
**Prepared by:** Engineering (Claude Code)
**Live URL:** https://naavi-app.vercel.app

---

## 1. What Naavi Is

Naavi is a life orchestration companion for active seniors. The primary user is Robert, 68, Ottawa. Robert's problem is that his tools — calendar, Gmail, Drive, health records, contacts, maps — do not talk to each other. Naavi connects them through a single conversational interface: he speaks or types, Naavi responds with voice and executes actions autonomously on his behalf — no app switching, no copy-pasting, no token management.

**Zero-friction principle:** Robert never authenticates, reconnects, manages tokens, or copies data between tools. Everything runs server-side automatically.

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Robert's Device                              │
│                    (browser — any device)                            │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              Naavi App  (Expo / React Native Web)              │  │
│  │                                                                │  │
│  │  Morning Brief    Conversation    Action Cards    Notes        │  │
│  │  (grouped,        (bubbles)       (Draft/Event/   (Memory +    │  │
│  │  collapsible)                      Contact/Drive)  Drive tab)  │  │
│  │                                                                │  │
│  │  Voice Input ─────────────────────────────────────────────    │  │
│  │  ┌──────────────┐  ┌──────────────────────────────────────┐   │  │
│  │  │ Whisper (🎙)  │  │ Web Speech API (green button)        │   │  │
│  │  │ clip→Whisper  │  │ real-time browser STT                │   │  │
│  │  └──────┬────────┘  └───────────────┬──────────────────────┘   │  │
│  │         └──────────────┬────────────┘                          │  │
│  │                        ↓                                       │  │
│  │                useOrchestrator.ts                              │  │
│  │                        ↓                                       │  │
│  │               naavi-client.ts  ←── buildSystemPrompt()        │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
└─────────────────────────┼────────────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
          ↓                               ↓
┌──────────────────┐           ┌─────────────────────────┐
│  Anthropic API   │           │   Supabase               │
│  claude-sonnet   │           │                          │
│  -4-6            │           │  Auth (Google OAuth)     │
│  max_tokens:2048 │           │  Postgres + pgvector     │
│  Returns JSON:   │           │  14 Edge Functions       │
│  {speech,        │           │  Row-Level Security      │
│   actions[],     │           └────────────┬────────────┘
│   pendingThreads}│                        │
└──────────────────┘                        │
                               ┌────────────┴────────────────────────┐
                               │         Google APIs                  │
                               │  Gmail · Calendar · Drive · Contacts │
                               │  Maps Distance Matrix                │
                               │  OpenAI Whisper + Embeddings         │
                               └─────────────────────────────────────┘
```

---

## 3. Technology Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| App framework | Expo / React Native | SDK 55 | Single codebase: web, Android, iPhone |
| Language | TypeScript + React | React 19.2.4 | Strict typing throughout |
| Navigation | Expo Router v5 | ~55.0.5 | File-based routing |
| AI model | Claude Sonnet 4.6 | claude-sonnet-4-6 | Orchestration + fragment extraction |
| AI SDK | @anthropic-ai/sdk | ^0.79.0 | Used in naavi-chat Edge Function |
| Voice input (clip) | OpenAI Whisper | whisper-1 | Via transcribe-memo Edge Function |
| Voice input (live) | Web Speech API | Browser native | Chrome/Android real-time STT |
| Voice output | Web Speech Synthesis | Browser native | Prefers Microsoft/Google neural voices |
| Vector embeddings | OpenAI text-embedding-3-small | 1536 dimensions | For knowledge fragment semantic search |
| Vector storage | pgvector (Postgres extension) | — | Cosine similarity via RPC |
| Backend | Supabase | — | Auth, Postgres, Edge Functions (Deno) |
| Auth | Supabase Google OAuth | — | Captures Google refresh token at sign-in |
| Hosting (app) | Vercel | — | Auto-deploys from GitHub push (~90s) |
| Source control | GitHub | — | github.com/munk2207/naavi-app |
| i18n | i18next + react-i18next | ^23.0.0 | English / Canadian French |

---

## 4. Repository and Folder Structure

```
Naavi/
├── mobile/                          ← THE LIVE APP
│   ├── app/
│   │   ├── index.tsx                ← Main screen (brief, conversation, cards)
│   │   ├── notes.tsx                ← Notes repository (Memory + Drive tabs)
│   │   ├── settings.tsx             ← Auth, language settings
│   │   └── _layout.tsx              ← Navigation shell
│   │
│   ├── components/
│   │   ├── VoiceButton.tsx          ← Green mic button (Web Speech API)
│   │   ├── BriefCard.tsx            ← Morning brief item cards
│   │   └── ConversationBubble.tsx   ← Chat bubbles
│   │
│   ├── hooks/
│   │   ├── useOrchestrator.ts       ← Conversation loop + action executor
│   │   ├── useVoice.ts              ← Web Speech API integration
│   │   └── useWhisperMemo.ts        ← Whisper clip recording + transcription
│   │
│   └── lib/
│       ├── naavi-client.ts          ← System prompt builder + Claude call
│       ├── supabase.ts              ← Supabase client + DB helpers
│       ├── calendar.ts              ← Google Calendar fetch + BriefItem mapping
│       ├── gmail.ts                 ← Gmail fetch + send
│       ├── drive.ts                 ← Drive search + save + email attachment
│       ├── contacts.ts              ← 3-tier contact resolution
│       ├── memory.ts                ← People table + person context injection
│       ├── knowledge.ts             ← Knowledge fragment ingest + search
│       ├── maps.ts                  ← Travel time fetch + leave-by calculation
│       └── weather.ts               ← Ottawa weather fetch
│
├── supabase/
│   ├── config.toml                  ← verify_jwt = false on all functions
│   └── functions/
│       ├── naavi-chat/              ← Claude API proxy (API key server-side)
│       ├── transcribe-memo/         ← OpenAI Whisper transcription
│       ├── sync-google-calendar/    ← Pulls events → calendar_events table
│       ├── sync-gmail/              ← Pulls messages → gmail_messages table
│       ├── search-google-drive/     ← Drive file search
│       ├── save-to-drive/           ← Creates Google Doc
│       ├── send-drive-file/         ← Sends Drive file as email attachment
│       ├── send-email/              ← Gmail send via OAuth
│       ├── create-calendar-event/   ← Creates Google Calendar event
│       ├── lookup-contact/          ← Google People API contact search
│       ├── store-google-token/      ← Stores Google refresh token at sign-in
│       ├── get-travel-time/         ← Google Maps Distance Matrix API
│       ├── ingest-note/             ← Claude extraction + OpenAI embeddings → DB
│       └── search-knowledge/        ← pgvector cosine similarity search
│
├── docs/
│   └── ARCHITECTURE.md             ← This document
├── schema/                          ← Cognitive Profile TypeScript types
├── src/                             ← Backend orchestration stubs (future)
└── web/                             ← Next.js marketing page
```

---

## 5. Database Schema (Supabase Postgres)

All tables use Row-Level Security. Every insert includes `user_id` matched against `auth.uid()`.

```sql
-- Google token storage (server-side OAuth)
google_tokens (user_id, access_token, refresh_token, expiry_date, scope)

-- Synced calendar events
calendar_events (user_id, google_event_id, summary, start_time, end_time,
                 location, description, attendees, synced_at)

-- Synced Gmail messages
gmail_messages (user_id, message_id, thread_id, from_email, from_name,
                subject, snippet, received_at, is_important)

-- Contacts saved by Naavi
contacts (user_id, name, email)

-- Rich people table (for context injection)
people (user_id, name, email, phone, relationship, notes, last_contact)

-- Topics / preferences / concerns
topics (user_id, subject, note, category, created_at)

-- Reminders
reminders (user_id, title, datetime, source, created_at)

-- Knowledge fragments (semantic memory)
knowledge_fragments (
  user_id, type, content, classification, source, confidence,
  embedding vector(1536),   ← pgvector
  created_at, last_retrieved_at
)

-- Drive notes metadata (docs saved via SAVE_TO_DRIVE)
naavi_notes (user_id, title, web_view_link, created_at)
```

**pgvector RPC:**
```sql
search_knowledge_fragments(query_embedding, match_count, p_user_id)
  → cosine similarity search on knowledge_fragments.embedding
```

---

## 6. Data Flow — One Full Conversation Turn

```
1. Robert taps microphone (red Whisper button or green Web Speech button)
        ↓
2a. Whisper path:
    useWhisperMemo → records MediaRecorder clip → base64 encodes
    → calls transcribe-memo Edge Function → OpenAI Whisper API
    → returns transcript text

2b. Web Speech path:
    useVoice → SpeechRecognition API (browser-native, runs locally)
    → returns transcript text
        ↓
3. useOrchestrator.send(transcript) is called
        ↓
4. Person context injection (lib/memory.ts):
   extractPersonQuery() checks if Robert is asking about a person
   if yes → getPersonContext() queries people + topics tables
   → formatPersonContext() appends structured context block to message
        ↓
5. naavi-client.ts → sendToNaavi():
   isSupabaseConfigured() → true → callNaaviEdgeFunction()
   → POST to naavi-chat Edge Function with {system, messages, max_tokens:2048}
   → Edge Function holds ANTHROPIC_API_KEY server-side
   → calls claude-sonnet-4-6
        ↓
6. Claude returns raw text
        ↓
7. parseResponse() — 3-pass parser:
   Pass 1: standard JSON.parse after stripping markdown fences
   Pass 2: fix literal newlines inside string values
   Pass 3: strip all control characters, fix trailing commas, quote unquoted keys
   Fallback: regex-extract speech value as last resort
   fixSentLanguage(): corrects "I sent" → "Draft is ready" when DRAFT_MESSAGE present
        ↓
8. useOrchestrator executes actions in parallel loops:
   SAVE_TO_DRIVE   → saveToDrive() + saveDriveNote() to naavi_notes
   REMEMBER        → ingestNote() → ingest-note Edge Function
                     → Claude extracts fragments → OpenAI embeds → knowledge_fragments
   CREATE_EVENT    → createCalendarEvent() → create-calendar-event Edge Function
   DRIVE_SEARCH    → searchDriveFiles() → search-google-drive Edge Function
   DRAFT_MESSAGE   → accumulated in drafts[] state
   ADD_CONTACT     → saveContact() + savePerson() → Supabase
   SET_REMINDER    → saveReminder() → Supabase
   LOG_CONCERN     → saveTopic() → Supabase
   UPDATE_PROFILE  → saveTopic() → Supabase
        ↓
9. speakResponse() — voice output:
   Web: speakWeb() → Web Speech Synthesis API
        Voice priority: Microsoft Aria Natural → Jenny Natural → Google UK Female
        → Google US English → any matching language
   Native: expo-speech (iOS/Android TTS)
   Rate: 0.9 (slightly slower — designed for seniors)
        ↓
10. index.tsx re-renders:
    New conversation bubbles
    Action cards rendered per type (see Action System section)
```

---

## 7. Morning Brief Pipeline

```
App mount
    ↓
fetchOttawaWeather() → weather BriefItem (immediate, no auth needed)
    ↓
supabase.auth.getSession() → currentUserId
    ↓
Promise.all([
  fetchUpcomingEvents(7, userId),    ← calendar_events table
  fetchUpcomingBirthdays(userId),    ← calendar_events (birthday type)
  fetchImportantEmails(userId),      ← gmail_messages (is_important = true)
])
    ↓
enrichWithTravelTime(calendarItems)
    For each calendar event with location + startISO within next 8 hours:
    → fetchTravelTime() → get-travel-time Edge Function
    → Google Maps Distance Matrix API (server-side, API key never on device)
    → returns { durationMinutes, distanceKm, leaveByMs, summary }
    → item.detail updated with location + travel summary
    → item.leaveByMs set for banner trigger
    ↓
setBrief() → renders grouped, collapsible category sections
    ↓
Background sync (parallel):
Promise.all([triggerCalendarSync(), triggerGmailSync()])
    → sync-google-calendar Edge Function → Google Calendar API → calendar_events
    → sync-gmail Edge Function → Gmail API → gmail_messages
    ↓
Re-fetch + re-enrich → setBrief() updated silently
    ↓
Leave-time alert timer (setInterval 30s):
    Checks all brief items with leaveByMs
    If now >= leaveByMs AND now <= startMs + 60min:
    → green banner: "🚗 Time to leave — [title]. Tap to navigate"
    → red banner: "⚠️ Running late — [title]. Tap to navigate"
    → tap → opens Google Maps navigation to destination
```

**BriefItem categories:** `calendar | health | weather | social | home | task`

---

## 8. Action System

| Action | Trigger (system prompt rule) | Execution | UI |
|---|---|---|---|
| `DRAFT_MESSAGE` | Any: write/draft/compose/send/email/message | Stored in drafts[] | Blue card — To/Subject/Body + Send button |
| `ADD_CONTACT` | Name + email or phone given | saveContact() + savePerson() → Supabase | Green card with contact details |
| `SET_REMINDER` | Set reminder/alert/notification | saveReminder() → Supabase | (stored — no card yet) |
| `CREATE_EVENT` | Schedule/book/meeting/appointment | create-calendar-event Edge Function → Google Calendar | Green card — tap to open in Google Calendar |
| `DRIVE_SEARCH` | Ask about any file/document | search-google-drive Edge Function | Blue file cards with tap-to-open |
| `SAVE_TO_DRIVE` | Save/note/store/write down/keep/record | save-to-drive Edge Function → Google Doc + saveDriveNote() | Amber card — tap to open in Google Docs |
| `REMEMBER` | Remember/don't forget/keep in mind/note that | ingest-note Edge Function → knowledge_fragments | Purple card — "🧠 Saved to memory — N fragments" |
| `LOG_CONCERN` | Health/social/routine concern | saveTopic() → Supabase | (stored — no card yet) |
| `UPDATE_PROFILE` | Preference or profile change | saveTopic() → Supabase | (stored — no card yet) |

**Email Send flow (DraftCard):**
1. Auto-lookup on mount: if `to` has no `@`, call lookupContact()
2. 3-tier resolution: local `contacts` table → `gmail_messages` sender cache → Google People API (`searchContacts`)
3. If still not found: browser prompt for manual entry + saveContact() for future
4. sendEmail() → send-email Edge Function → Gmail API (OAuth, server-side)

---

## 9. Knowledge & Memory Layer

This is the deepest subsystem — a semantic long-term memory for Robert.

### Write path (REMEMBER action):
```
Robert: "Remember that I prefer aisle seats on flights"
    ↓
Naavi returns: { "type": "REMEMBER", "text": "Robert prefers aisle seats on flights" }
    ↓
ingestNote(text, 'stated') → supabase.functions.invoke('ingest-note')
    ↓
ingest-note Edge Function:
  1. POST to Claude claude-sonnet-4-6 with classifier prompt
     → extracts typed fragments: [{ type, content, classification, confidence }]
     Types: life_story | important_date | preference | relationship | place | routine | concern
     Classifications: PUBLIC | PERSONAL | SENSITIVE | MEDICAL | FINANCIAL
  2. For each fragment: POST to OpenAI text-embedding-3-small (1536 dimensions)
  3. INSERT into knowledge_fragments with user_id, embedding as vector
    ↓
UI: purple card shows "🧠 Saved to memory — N fragments stored"
```

### Read path (person context injection):
```
Robert: "Tell me about my meeting with Sarah"
    ↓
extractPersonQuery(message) → returns "Sarah"
    ↓
getPersonContext("Sarah") → queries people + topics tables
    ↓
formatPersonContext() → structured markdown block injected into message:
  "## What Naavi knows about Sarah
   - Relationship: colleague
   - Email: sarah@example.com
   - Topics: project budget (2026-03-15)"
    ↓
enrichedMessage sent to Claude → Claude answers with full context
```

### Semantic search (search-knowledge Edge Function):
```
query → OpenAI embedding → pgvector cosine similarity RPC
→ top-K fragments by similarity → updates last_retrieved_at
```

---

## 10. Contact Resolution (3-Tier)

When Robert says "send an email to Heaggan" with no `@` in the name:

```
Tier 1: SELECT name, email FROM contacts WHERE user_id = ? AND name ILIKE '%heaggan%'
    ↓ (not found)
Tier 2: SELECT from_email, from_name FROM gmail_messages
         WHERE user_id = ? AND from_name ILIKE '%heaggan%' LIMIT 1
    ↓ (not found)
Tier 3: Google People API — people.searchContacts?query=heaggan
         Requires scope: contacts.readonly
         Requires People API enabled in Google Cloud Console
    ↓ (not found)
Fallback: browser window.prompt() → user enters email manually
          → saveContact() stores for future lookups
```

---

## 11. Voice System

### Input — Two modes

| | Whisper (red 🎙 button, left) | Web Speech API (green button, right) |
|---|---|---|
| Technology | OpenAI Whisper via Edge Function | Browser SpeechRecognition API |
| Flow | Record clip → base64 → POST to transcribe-memo → Whisper API → transcript | Browser listens → real-time transcript |
| Latency | ~1-3s after recording stops | Near-instant |
| Quality | Higher accuracy, handles accents | Varies by browser/accent |
| Cost | OpenAI API call per use | Free (browser-native) |
| Availability | All browsers | Chrome/Edge/Android only |

**Android Chrome:** requests `getUserMedia` to stop active streams, then starts `SpeechRecognition`.
**iOS Safari:** goes directly to `SpeechRecognition.start()` — calling getUserMedia first conflicts with mic access on iOS.

### Output

Web Speech Synthesis with voice priority:
1. Microsoft Aria Online (Natural) — Edge
2. Microsoft Jenny Online (Natural) — Edge
3. Microsoft Natasha Online (Natural) — Edge
4. Google UK English Female — Chrome
5. Google US English — Chrome
6. Any voice matching language code

Rate: 0.9 (designed for seniors). Language: `en-CA` or `fr-CA`.

---

## 12. Security Model

### Authentication
- Google OAuth via Supabase Auth
- Google refresh token captured at `SIGNED_IN` event → stored in `google_tokens` table server-side
- App never holds the refresh token after sign-in

### API Keys
- `ANTHROPIC_API_KEY` — Supabase Edge Function secret (server-side only)
- `OPENAI_API_KEY` — Supabase Edge Function secret (server-side only)
- `GOOGLE_MAPS_API_KEY` — Supabase Edge Function secret
- Device holds only: Supabase anon key (public by design) + Supabase URL

### JWT / RLS
- All Edge Functions: `verify_jwt = false` in `config.toml`
- Auth handled inside each function: `userClient.auth.getUser()` with forwarded Authorization header
- All tables: RLS enabled, policies enforce `auth.uid() = user_id`
- **Known issue resolved:** JWT key rotation (HS256 → ECC) caused 401s at the Supabase gateway. Fix: disable gateway-level JWT verification, let Edge Functions handle auth via RLS. This is now the standard pattern for all functions.

---

## 13. Deployment Pipeline

```
Edit file locally (C:\Users\waela\OneDrive\Desktop\Naavi\mobile\)
        ↓
git add [files] && git commit -m "..." && git push origin main
        ↓
GitHub (munk2207/naavi-app) receives push
        ↓
Vercel webhook triggers build:
  npx expo export --platform web  →  dist/  (static HTML/CSS/JS)
        ↓
Vercel deploys dist/ to CDN
  → Live at https://naavi-app.vercel.app
  Total time: ~90 seconds
        ↓
Edge Functions deployed separately:
  npx supabase functions deploy [function-name] --no-verify-jwt
  (requires Docker OR uses Supabase's remote build)
```

---

## 14. Current Capabilities (Phase 8 — Live)

### Core Conversation
- [x] Full conversation with Naavi via text or voice
- [x] Claude sees full conversation history + today's brief on every turn
- [x] 3-pass JSON parser with regex fallback — never leaves Robert without a response
- [x] English / Canadian French bilingual

### Morning Brief
- [x] Real Google Calendar events (synced)
- [x] Real Gmail important emails (synced)
- [x] Birthday reminders from calendar
- [x] Ottawa weather (live)
- [x] Cards grouped by category (Weather / Calendar / Email / Birthdays / Health / Home)
- [x] Collapsible sections (start collapsed — cleaner screen)
- [x] Travel time + leave-by time on events with location
- [x] Automatic leave-time banner (green/red) with tap-to-navigate

### Actions
- [x] Draft email → one-tap send via Gmail
- [x] Save contact → persisted to Supabase
- [x] Create calendar event → Google Calendar
- [x] Search Google Drive → file cards with tap-to-open
- [x] Save note to Drive → Google Doc created
- [x] Remember → semantic memory stored with embeddings
- [x] Tap calendar event with location → opens Google Maps navigation

### Notes Repository (📋)
- [x] Memory tab — all REMEMBER fragments, typed and classified
- [x] Drive Notes tab — all SAVE_TO_DRIVE docs + Drive search for older files
- [x] Pull-to-refresh

### Infrastructure
- [x] API key fully server-side (Supabase Edge Functions)
- [x] Google OAuth with server-side token management
- [x] Background calendar + Gmail sync
- [x] pgvector semantic search (1536-dimension embeddings)
- [x] 14 Edge Functions in production

---

## 15. Known Issues & Engineering Debt

| Issue | Root Cause | Status |
|---|---|---|
| `ingest-note` returned empty fragments | Claude wraps JSON in ` ```json ``` ` fences — parser choked | Fixed: strip fences before parse |
| `REMEMBER` action not firing | System prompt rule too weak — Claude responded with speech only | Fixed: strengthened RULE 7 with example and more trigger phrases |
| Contact lookup refusal | Claude said "I don't have access to contacts" | Fixed: explicit system prompt rule forbidding this response |
| `saveContact` silently failing | Missing `user_id` in INSERT — RLS blocked silently | Fixed: fetch session, include user_id |
| JWT 401 on Edge Functions | Supabase rotated from HS256 to ECC JWT — gateway rejected tokens | Fixed: `verify_jwt = false` on all functions, auth via RLS |
| Draft card showing resolved email | UI showed `resolvedEmail` instead of `action.to` name | Fixed: show contact name with email in parentheses |
| Travel time not enriching after background sync | Background sync overwrote brief without re-calling `enrichWithTravelTime` | Fixed: enrich in both initial load and background sync paths |
| People API 500 | Google People API not enabled in GCP + JWT issue | Fixed: user enabled API; JWT issue resolved above |
| Old Drive notes not in Notes screen | `naavi_notes` table is new — pre-existing Drive docs were session-only | Partial fix: Drive search tab lets user find old docs manually |
| `knowledge_fragments` SELECT blocked | RLS SELECT policy not created (only ALL policy existed for inserts) | Fixed: added SELECT policy |

---

## 16. Recommendations & Roadmap

### Immediate (next sprint)

**1. Automatic knowledge retrieval at conversation start**
Currently, person context is injected only when Robert names someone. The `search-knowledge` Edge Function exists but is not yet wired into the morning brief. Recommended: at app load, run `searchKnowledge("today morning context")` and inject top-5 relevant fragments into the system prompt. This would make Naavi remember Robert's preferences automatically without being asked.

**2. `LOG_CONCERN`, `SET_REMINDER`, `UPDATE_PROFILE` action cards**
These actions are stored in Supabase but have no visual confirmation in the UI. Robert receives no feedback that a reminder or concern was saved. Low-effort, high-trust improvement.

**3. Drive notes recovery**
Documents saved to Drive before the `naavi_notes` table existed are not tracked in the app. Recommend: on first load of the Drive Notes tab, if `naavi_notes` is empty, auto-search Drive for Google Docs created by the authenticated user and backfill `naavi_notes`. This can be done once via a one-shot migration Edge Function.

### Medium-term

**4. Push notifications**
The leave-time banner only shows when the app is open. Robert needs to be notified even when the browser tab is closed. Implement via Web Push API + Supabase pg_cron job that sends push at `leaveByMs`.

**5. Native mobile app (EAS Build)**
The app runs well as a web app but has no home-screen icon on iOS. Expo EAS Build produces an installable `.ipa` / `.apk` from the same codebase with no code changes needed.

**6. Two voice buttons — UX confusion**
Robert has noticed that the red (Whisper) and green (Web Speech) buttons behave differently in his mental model. Consider consolidating to a single button with automatic fallback: try Web Speech API first, fall back to Whisper clip if unsupported or if speech is not detected within 3 seconds.

**7. Health integrations**
Withings (scale + blood pressure monitor) has a REST API. MyChart uses FHIR R4. Robert's medication reminders are currently manual. Connecting these would make the health category in the morning brief genuinely useful.

**8. Twilio SMS**
Robert's social circle includes people who do not use email. Naavi currently only drafts emails. Adding a `DRAFT_SMS` action type with Twilio delivery would cover this gap.

### Architectural

**9. Conversation memory across sessions**
The `history` state in `useOrchestrator` is in-memory — it resets when the browser tab closes. Long-term, conversation turns should be persisted in Supabase and the last N turns loaded at app start. This would give Robert genuine continuity: "as we discussed yesterday..." would work.

**10. Multi-user / caregiver mode**
The current architecture is single-user. A caregiver (family member, home care worker) could benefit from a read-only view of Robert's brief and concerns. Supabase RLS can be extended with a `caregivers` table and shared read policies without restructuring the data model.

---

## 17. Files a CTO Should Read First

In priority order:

1. **`mobile/lib/naavi-client.ts`** — system prompt (`buildSystemPrompt`) and Claude integration. This is the product's intelligence layer. All action rules live here.
2. **`mobile/hooks/useOrchestrator.ts`** — the conversation loop and action executor. Understand this and you understand the entire runtime flow.
3. **`mobile/app/index.tsx`** — the screen Robert sees. Morning brief pipeline, leave-time logic, action card rendering.
4. **`supabase/functions/ingest-note/index.ts`** — the knowledge ingestion pipeline. Shows how Claude + OpenAI + pgvector are composed.
5. **`mobile/lib/contacts.ts`** — the 3-tier contact resolution. A good example of the graceful degradation pattern used throughout.
6. **`supabase/functions/naavi-chat/index.ts`** — the API proxy. Shows the Phase 8 security model: API key server-side, RLS auth.

---

*Document reflects the live deployed state as of March 2026.*
*All architecture decisions, known issues, and recommendations are derived from the actual implementation.*
