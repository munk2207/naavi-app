# Naavi — Architecture Overview

**Audience:** non-technical founders, technical advisors, prospective investors, beta partners.
**Last updated:** 2026-04-30, V57.8.

---

## What Naavi is, in one paragraph

Naavi is an AI life-orchestration companion for active seniors. Robert (our target user, 68) has Gmail, Google Calendar, contacts, an inbox of bills, and three doctors. The tools don't talk to each other. Naavi connects them: a single voice or chat interface that knows when his doctor emails, what's on his calendar tomorrow, where he keeps the warranty for his car, and how long it takes to drive to the cottage.

Naavi runs on his phone (mobile app) and his landline (call-in number), backed by a single shared backend that handles email syncing, calendar reading, document harvesting, and reminders.

---

## 1. Logical Architecture

### Frontend (what runs on the user)

| Surface | Technology | What Robert sees |
|---|---|---|
| **Mobile app** | React Native (Expo), iOS + Android | Chat, today's brief, visit recorder, settings, alerts |
| **Voice phone** | Twilio inbound number | Robert calls a number, talks to Naavi over the phone |
| **Marketing site** | Static HTML, Vercel-hosted | mynaavi.com — product info, no auth, no user data |

### Backend (one shared platform)

```
        Mobile app                  Voice phone (Twilio)
            │                                │
            │   JWT auth                     │   Caller phone lookup
            ▼                                ▼
    ┌─────────────────────────────────────────────────┐
    │             Supabase Edge Functions              │
    │  (~40 serverless endpoints — naavi-chat,         │
    │   sync-gmail, evaluate-rules, send-sms, etc.)    │
    └────────────────┬─────────────────┬───────────────┘
                     │                 │
                     ▼                 ▼
    ┌─────────────────────┐    ┌─────────────────────┐
    │  Supabase Postgres  │    │  Third-party APIs   │
    │  (user data,         │    │  Google / Anthropic /│
    │   RLS-protected)     │    │  Deepgram / Twilio  │
    └─────────────────────┘    └─────────────────────┘
```

The Twilio voice server runs separately (Node.js on Railway) but talks to the same Supabase backend, so phone calls and mobile chat share the same data.

### Integrations / Third-party APIs

| Service | What it does for Naavi |
|---|---|
| **Anthropic Claude** | The brain — interprets speech, decides actions |
| **Google APIs** | Gmail, Calendar, People (Contacts), Drive, Maps, Vision (OCR) |
| **Deepgram** | Voice → text (Nova) + text → voice (Aura) |
| **Twilio** | Phone calls, SMS, WhatsApp |
| **OpenAI** | Embeddings for semantic memory search |
| **Apple/Google Push** | Notification delivery |

### Customer segregation — multi-user safety

Every piece of data is tied to a `user_id`. Two layers of enforcement:

1. **Database layer (Row-Level Security)** — every user-owned table has RLS policies that make Postgres itself refuse to return another user's data, regardless of who's asking.
2. **API layer** — every Edge Function resolves user identity through this exact chain (CLAUDE.md "Rule 4"):
    - **(a)** JWT from the mobile app's signed-in session
    - **(b)** Explicit `user_id` in the request body (voice server, server-side webhooks)
    - **(c)** **Reject with 401** — no "default user" fallback

A 2026-04-29 auto-tester audit caught 4 Edge Functions that previously had a fallback to "first user with a Google token", which bound unauthenticated callers to whoever was first in the database. All four are now fixed.

The voice server resolves user identity by **caller phone number** lookup against `user_settings.phone` — so Robert calling from his cellphone reaches his data, and his wife calling from hers reaches hers. The same multi-user-safety chain applies inside every Edge Function the voice server then calls.

---

## 2. LLM Calls — when, and why

Naavi makes 5 different kinds of Claude calls. Each has a specific purpose:

| Edge Function | Fires when | Why Claude is needed |
|---|---|---|
| **naavi-chat** | Every user chat turn (mobile or voice) | Understand free-form speech; decide which actions to emit |
| **extract-actions** | After every visit recording | Turn doctor-visit transcript into structured prescription / appointment / follow-up actions |
| **extract-email-actions** | Per tier-1 email that matches actionable keywords (cost-optimized pre-filter) | Classify what's actionable (invoice, appointment, etc.) |
| **extract-document-text** | Per harvested attachment | OCR + classify scanned documents (invoice, receipt, warranty, etc.) |
| **ingest-note** | When the user says "remember X" | Break free text into atomic, searchable facts |

### Why Claude (and not rules / regex)

- Senior speech is irregular, full of context, doesn't follow templates.
- A doctor visit might say *"let's schedule a follow-up in 3 weeks"* — needs date math + intent recognition.
- Classifying an email as an "invoice" needs to read the body, not just match the subject line.

### Why Haiku (not Sonnet)

- Naavi's tasks are well-defined enough for **Claude Haiku 4.5** — 3-5× cheaper per token than Sonnet.
- Haiku handles 95% of cases. We tested Sonnet for one specific case (extract-actions on visit transcripts) and reverted to Haiku after the audit showed Haiku is sufficient.

### Cost-optimized LLM call patterns (2026-04-30)

- **Pre-filter before Claude**: emails are keyword-checked against ~25 actionable signals before paying for a Claude call. ~70% of tier-1 emails skip Claude entirely.
- **Prompt caching**: the ~50KB system prompt is cached on Anthropic's side; repeat calls within 5 minutes pay only for the changing fragment.
- **Dormancy filter**: users who haven't signed in for 30+ days are skipped on cron syncs entirely.
- **Per-call output cap**: chat output is hard-capped at 1024 tokens (Naavi replies are short by design).

These four optimizations cut projected per-user cost from ~$290/month to ~$30-50/month at scale.

---

## 3. Tech Stack — what each piece does

### Mobile

| Tech | Purpose |
|---|---|
| **React Native + Expo** | Cross-platform mobile framework — write once, run on iOS + Android |
| **Expo Router** | Screen navigation |
| **expo-av / expo-speech** | Audio recording + voice playback |
| **expo-location / expo-task-manager** | Geofencing (location-based alerts that fire when the phone arrives at a place) |
| **expo-notifications** | Push notifications |
| **expo-secure-store** | Encrypted token storage on the device |
| **EAS Build / Submit** | Cloud build pipeline + automatic Play Store / App Store submission |

### Backend / Cloud

| Tech | Purpose |
|---|---|
| **Supabase** | Postgres database + Auth + serverless Edge Functions + Row-Level Security — the entire backend on one platform |
| **Deno** | JavaScript runtime for Edge Functions (no Node.js required) |
| **TypeScript** | Used everywhere — mobile, Edge Functions, voice server. Type safety = fewer bugs |
| **Vercel** | Hosts mynaavi.com marketing site (auto-deploys from GitHub) |
| **Railway** | Hosts the Twilio voice server (Node.js — handles inbound phone calls) |

### External / paid services

| Service | Purpose | Cost driver |
|---|---|---|
| **Anthropic Claude** | LLM brain (Haiku 4.5) | Per input/output token — biggest single line item (~70% of total) |
| **Google Cloud APIs** | Gmail, Calendar, People, Drive, Maps, Vision | Free under generous quotas; scales with volume |
| **Deepgram** | Voice TTS (Aura) and STT (Nova) | Per minute of audio |
| **Twilio** | Phone calls, SMS, WhatsApp | Per minute / per message |
| **OpenAI** | Embeddings only (text-embedding-3-small) | Per token — very cheap |
| **Supabase** | Database + Edge Function compute | Flat tier ($25/mo Pro + $10-60/mo compute) |

### Build / Dev tooling

| Tool | Purpose |
|---|---|
| **GitHub** | Source-of-truth code repo, branch history, audit log |
| **EAS (Expo Application Services)** | Build mobile AAB + auto-submit to Play Store |
| **Auto-tester** (custom, built 2026-04-29) | Server-side regression suite — catches multi-user safety bugs, action-rule logic, prompt regressions. 31+ tests. |

---

## How a single user request flows end-to-end

Example: Robert says *"Alert me when I arrive at the cottage."*

1. **Mobile app** records voice → sends to **Deepgram Nova STT** → gets transcript.
2. Transcript sent to **`naavi-chat`** Edge Function with the cached system prompt.
3. **Claude Haiku 4.5** decides this is a `SET_ACTION_RULE` action with `trigger_type: 'location'`, `place_name: 'cottage'`.
4. The mobile orchestrator intercepts the action and calls **`resolve-place`** Edge Function.
5. `resolve-place` checks `user_settings`, then `user_places` cache, then **Google Places API**, returns coordinates.
6. Mobile orchestrator inserts a row into `action_rules` (RLS verifies ownership).
7. **`useGeofencing`** hook registers the geofence with the OS via expo-location.
8. Mobile orchestrator calls **`text-to-speech`** Edge Function → **Deepgram Aura TTS** → returns audio.
9. App plays back: *"Alert set — one time you arrive at the cottage."* and shows a card with a "Make it recurring" toggle.

When Robert later arrives at the cottage:

10. OS fires the geofence event → app's `TaskManager` task runs.
11. Task posts to **`evaluate-rules`** Edge Function (which also runs on cron every minute).
12. `evaluate-rules` reads `action_rules`, sees the trigger fired, calls **`send-sms`** + push.
13. Robert gets SMS + WhatsApp + Email + Push notifications (the alert fan-out rule — multi-channel for senior reliability).

---

## Where to read more (in this repo)

- `CLAUDE.md` — full project rules and architecture decisions.
- `docs/ARCHITECTURE.md` — earlier (March 2026) technical architecture document.
- `docs/SESSION_*.md` — chronological development log per session.
- `tests/` — auto-tester source + test catalogue.
- `supabase/functions/` — every Edge Function source.
