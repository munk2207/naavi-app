# MyNaavi — Status Brief

*For internal team review • April 21, 2026*

---

## Current state in one paragraph

MyNaavi is a private-preview voice assistant for active seniors, currently shipping on Android via Google Play Internal Testing. Build V54.2 (103) is live on the test device with 11 of 11 end-to-end user journeys verified. The product spans a mobile Expo React Native app, a Twilio-based phone-call service on Railway, and 30+ Supabase Edge Functions orchestrating Anthropic Claude models, Deepgram speech, Google Workspace APIs, Open-Meteo weather, and Twilio messaging. The assistant supports four trigger types (email, time, calendar, weather, contact-silence, location), context-aware alerts that fan out across SMS + WhatsApp + Email + Push simultaneously, and a verified-address flow that refuses to create location alerts from guesswork.

---

## 1. Functional surface — what Naavi does today

### A. Natural-language orchestration

- Creates calendar events, reminders, memory notes, and alerts from a single spoken sentence (multi-action parsing).
- Answers retrieval questions across the user's calendar, contacts, email, lists, sent messages, saved documents, memory (pgvector), and Google Drive.
- Drafts messages (SMS / WhatsApp / email) on the user's behalf, reads them back, waits for explicit *"yes"* before sending.

### B. Alerts and triggers

- **Six trigger types**: `email`, `time`, `calendar`, `weather`, `contact_silence`, `location`.
- **Self-alerts fan out to 4 channels** (SMS + WhatsApp + Email + Push) in parallel for reliability across WiFi-only / cell-only conditions.
- **Context-carrying alerts**: any rule can attach inline tasks (`tasks: []`) or reference a live list (`list_name`) — the list's current contents are resolved at fire time, not stored at creation.
- **Expiry awareness**: temporal phrases ("this weekend", "next 3 days") auto-set an `expiry` on the rule; a daily cron disables expired rules across every trigger type.

### C. Morning brief call

- Phone call from a Twilio number at the user's chosen time.
- Reads today's calendar, current weather, priority emails summarized, reminders due.
- Composed by Claude in one natural paragraph; spoken via Deepgram Aura Hera voice.
- Missed-call fallback: brief saved to Drive for later reading.

### D. Voice-call recording and summarization

- During a Twilio call, user says *"record my visit"*. Naavi records the conversation.
- After call: transcribed (AssemblyAI), summarized (Claude Sonnet), saved to Drive, emailed to user, indexed to knowledge for future recall.
- Use case: doctor's visits, mechanic appointments, phone interviews.

### E. Email attachment pipeline (OCR → classify → harvest)

- Inbound Gmail attachment pipeline runs asynchronously after `sync-gmail`:
  1. Attachment downloaded (PDF/JPG/PNG/DOCX/XLSX).
  2. Classified by Claude Haiku into one of 11 document types (invoice / warranty / receipt / contract / medical / statement / tax / ticket / notice / calendar / other).
  3. Uploaded to `MyNaavi/Documents/{type}/` in user's Drive.
  4. Text extracted (PDF text layer OR Google Vision OCR for scanned images).
  5. Indexed to `documents` table for Global Search.
- Result: scanned paper invoices become searchable in seconds.

### F. Location intelligence

- Place names resolved via Google Places API, biased by the user's home address.
- Every resolved address requires user confirmation before the rule is saved.
- Background geofencing uses Android OS-level fences (via Expo Location + TaskManager) — survives app kill, battery-efficient.
- Personal keyword shortcuts ("home" / "office") map to saved addresses in `user_settings`.

### G. Global Search

- Single Edge Function fans out to **10 adapters** in parallel (knowledge, rules, sent_messages, contacts, lists, calendar, gmail, email_actions, drive, reminders).
- Query normalization layer handles plural/singular ("payments" = "pay"), synonyms (bill ↔ pay, meeting ↔ appointment), email-username expansion.
- Results grouped by source for the UI, flat-ranked for voice read-aloud.

### H. Multi-user architecture

- Two user accounts in production (`wael.aggan@gmail.com`, `heaggan@gmail.com`), each identified by caller phone on the voice side and JWT in the mobile app.
- Every Edge Function uses a strict 3-step user resolution: JWT → body `user_id` → `user_tokens` fallback. No `.limit(1)` shortcuts on shared tables.

---

## 2. AI and service stack — what powers each function

| Function | Primary model / service | Secondary / fallback |
|---|---|---|
| Main conversation reasoning | **Anthropic Claude Sonnet 4.6** | (via Anthropic SDK, keys stored in Supabase secrets — never on device) |
| Email action extraction, document classification | **Anthropic Claude Haiku** | — |
| Text-to-speech (app + phone call) | **Deepgram Aura (aura-hera-en voice)** | expo-speech (Android native TTS) on network failure |
| Speech-to-text (phone call live stream) | **Deepgram Nova-2** | — |
| Speech-to-text (in-app mic) | **Deepgram** via transcribe-memo | — |
| Voice-call recording transcription | **AssemblyAI** | — |
| OCR on scanned images / PDFs without text layer | **Google Vision DOCUMENT_TEXT_DETECTION** | — |
| Knowledge search (semantic) | **pgvector** + Claude-embedding-based search | ILIKE fallback on identifier-shape queries |
| Place resolution | **Google Places Text Search API** + Google Geocoding API | — |
| Calendar read / write | **Google Calendar API** | — |
| Email read / send | **Google Gmail API** (user's own OAuth) | — |
| Contacts | **Google People API** (live) | Local `contacts` table for phones only |
| Drive read / write | **Google Drive API v3** | — |
| Weather | **Open-Meteo (free tier)** | — |
| SMS + WhatsApp outbound | **Twilio Programmable Messaging** | — |
| Voice inbound call | **Twilio Voice** on Railway Node service | — |
| Push notifications | **FCM (Android)** + VAPID Web Push | — |
| All persistence + auth | **Supabase (Postgres + Edge Functions + Auth)** | — |
| Vector embeddings storage | **Supabase pgvector** | — |

---

## 3. Core architectural patterns

### Single source of truth for the Claude system prompt

One Edge Function (`get-naavi-prompt`) serves both the mobile app and the voice server. Either surface fetches the latest prompt at session start and appends channel-specific context (brief items for mobile, calendar/knowledge for voice). Prompt is currently at **v13**.

### Single rule store

Every trigger (email, time, calendar, weather, contact_silence, location) lives in one `action_rules` table with a generic `trigger_type` + `trigger_config` (JSONB) shape. One `evaluate-rules` cron runs every minute and fires matching rules. Adding a new trigger type means adding a handler branch and extending the CHECK constraint — no new tables, no new crons.

### Alert fan-out on self-alerts

Self-alerts (the alert is addressed to the user's own phone or email) fan out to SMS + WhatsApp + Email + Push in parallel. Third-party alerts stay on their requested channel. Rationale: SMS requires cell reception; a senior on WiFi-only misses SMS silently. Reliability trumps per-send cost.

### Verified-address-only location rules

Naavi never creates a location alert from a guessed address. Every rule's address is either already saved in memory from a prior conversation, or freshly resolved and explicitly confirmed by the user in-conversation with a readback ("Found Costco at 1280 Merivale Rd. Say yes to set the alert…"). After 3 failed clarification attempts, Naavi stops and asks the user to call back with specifics.

### Global-first user data

`user_settings` schema carries `timezone`, `home_address`, `work_address`, `phone`, `name`. Every feature reads from there, none from backend defaults. Mobile app auto-detects device timezone at signin. Foundation already in place for users outside Canada.

---

## 4. Channels — how the user reaches Naavi

| Channel | Stack | Primary use |
|---|---|---|
| **Mobile chat (typed)** | Expo React Native → naavi-chat Edge Function → Claude Sonnet | Precise queries, list review, settings |
| **Mobile voice (in-app mic)** | Expo Audio → Deepgram STT → Claude → Deepgram Aura TTS → expo-av playback | Hands-free capture of notes, commands while multitasking |
| **Phone call (Twilio)** | Twilio inbound → Railway Node server → Deepgram streaming STT → Claude → Deepgram Aura TTS | Conversations, morning brief, recording doctor visits |

All three share session memory, rule store, and knowledge. Saying *"text my daughter"* on a phone call produces the same draft flow as typing it in chat.

---

## 5. Privacy and data boundaries

- No third-party telemetry on user data. All personal data lives in the user's Supabase project and their own Google Workspace.
- Every outbound message (SMS, WhatsApp, email) requires explicit user *"yes"* before sending — voice-confirm pattern on every channel.
- Location is stored only as "last-known", never as history. Geofence crossings are transient events; no trail is persisted.
- The mobile app requests `ACCESS_BACKGROUND_LOCATION` only after a clear pre-ask screen explaining what Naavi does with it (Google Play policy compliance).

---

## 6. Ship state

- **Mobile app:** V54.2 build 103 on Google Play Internal Testing. Bundled via EAS on Expo SDK 55.
- **Voice server:** Node + Twilio + Deepgram + Claude on Railway. Auto-deploys from GitHub main.
- **Backend:** 30+ Supabase Edge Functions. Postgres with pgvector + RLS policies per table.
- **Cron jobs:** `evaluate-rules` (every minute — expiry sweep + all trigger types), Gmail sync, sent-message logging.
- **Test accounts:** 2 live users (Wael, Huss).

### Recent deployment highlights (Session 20, this week)

- V54.0 → V54.1 → V54.2: three AAB builds covering weather + contact-silence + location trigger, verified-address flow, alert fan-out, mobile UX polish, voice-loss-mid-session fix.
- 4 new migrations: `action_rules_weather`, `action_rules_contact_silence`, `action_rules_location` (+ `user_places`), `user_settings_addresses`.
- Prompt v11 → v12 → v13: added location rule + clarification cap.

---

## 7. What's next

### Focus of next session: end-to-end test and validation

- Formal E2E test matrix (15 commands × 3 channels).
- Pre-ship smoke checklist (10 tests in 5 minutes before each AAB release).
- Server-only Node.js harness that exercises every Edge Function programmatically.
- Voice + text parity tester — confirm both input paths produce identical database side-effects.
- Bug triage workflow — documented diagnostic path when a test fails.

### Known bugs deferred to focused sessions

- Voice STT mangles proper nouns — works for text, fails for voice name lookups. Voice server fix.
- Chat response text occasionally truncates ("Nothing stored on" missing the name token). Likely `isBroadQuery` regex widening the prompt + malformed multi-JSON from Claude. Diagnostic logging live; needs a repro capture in next session.
- Voice stop-word regression (*"Naavi stop"* no longer interrupts TTS). Voice server fix.

### Backlog items flagged but not started

- `list_change` trigger (7 design questions logged, deferred).
- Voice-side privacy UX (4-piece feature for not reading medical/financial aloud in public).
- `location` trigger full polish (Phase 3-6 of the 6-phase plan — dwell-specific transitions, Places multi-candidate picker, privacy screens, kill switch).
- Epic FHIR health integration (schema drafted, not activated).
- Health-based triggers (requires Epic / wearable wiring).

---

## 8. Open questions for the team

1. Target rollout timeline to a wider private-preview pool beyond the current 2 users?
2. Appetite to prioritize voice bugs (Deepgram handling of proper nouns, stop-word) ahead of new features?
3. Policy on deferred `list_change` trigger — ship with recommended defaults, or wait for the 7 design questions to be resolved?
4. Plans for iOS port? Current stack (Expo) supports it; would need separate OAuth setup and APNs for push.

---

*Prepared by Wael and Claude Code for internal team review. Questions: hello@mynaavi.com.*
