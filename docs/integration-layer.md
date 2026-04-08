# Naavi — Integration Layer Design

> Version 0.2 — March 2026
> How Naavi connects to Robert's existing tools without replacing them.
> Updated to reflect Phase 9–10 actual implementation.

---

## The Central Idea: Never Call an API During a Conversation

The worst thing Naavi could do is make Robert wait three seconds for his morning brief because the weather service is slow, or fail entirely because MyChart is down for maintenance.

The integration layer solves this with one rule:

> **All reads come from a server-side cache. All external API calls happen in the background.**

When Robert says "What do I have today?", Naavi reads from data already in Supabase — fast, reliable. A background sync process (Supabase Edge Functions on a cron schedule) keeps that data fresh. If the sync fails, the cache serves what it has.

```
┌─────────────────────────────────────────────────────┐
│          BACKGROUND SYNC (Supabase Edge Functions)   │
│  (cron schedule, runs server-side — app not needed)  │
│                                                      │
│  Google Calendar ──┐                                 │
│  Gmail ────────────┤──► Edge Functions ──► Supabase  │
│  Open-Meteo ───────┤                    (Postgres)   │
│  [future: health]──┘                                 │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│              MORNING BRIEF ASSEMBLER                 │
│   reads only from Supabase — never calls APIs        │
│   (mobile/lib/calendar.ts, gmail.ts, weather.ts)     │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│                CLAUDE (AI LAYER)                     │
│         receives the assembled brief                 │
└─────────────────────────────────────────────────────┘
```

> **Note on original design:** The original architecture used SQLite on-device for caching. The actual implementation uses Supabase cloud tables. This is better: refresh tokens never leave the server, sync runs even when the app is closed, and data persists across devices and reinstalls.

---

## The Adapter Pattern

Every integration is built as an **Adapter** — a standardised wrapper around an external service. Each adapter has the same four methods regardless of what it connects to:

| Method | What it does |
|--------|-------------|
| `connect()` | One-time setup — handles OAuth login or API key storage |
| `sync()` | Fetches fresh data from the external service, writes to SQLite |
| `read()` | Returns normalised data from SQLite — never hits the network |
| `status()` | Returns the health of this integration: connected / degraded / disconnected |

The Morning Brief Assembler only ever calls `read()`. The sync scheduler only ever calls `sync()`. These two concerns never mix.

---

## Integrations: Overview

| Integration | What Naavi reads | Sync frequency | Auth method | Status |
|-------------|-----------------|----------------|-------------|--------|
| **Google Calendar** | Next 7 days of events + birthdays | Every 6 hours (cron) | OAuth 2.0 | ✅ LIVE |
| **Gmail** | Unread emails, last 7 days | Every hour (cron) | OAuth 2.0 (same token) | ✅ LIVE |
| **OpenWeatherMap** | Current conditions for Ottawa | On app load | API key (server-side) | ✅ LIVE |
| **Notion** | Notes and pages for person lookup | On demand | Integration token | ✅ LIVE |
| **Google Drive** | Documents for topic search | TBD | OAuth 2.0 (same token) | 🔜 Next |
| **MyChart (FHIR)** | Appointments, medications, conditions | Every 4 hours | OAuth 2.0 | 📋 Planned |
| **Withings / Oura** | Sleep, steps, heart rate | Daily | OAuth 2.0 | 📋 Planned |
| **Ecobee (thermostat)** | Current temp + set points | Every 30 min | OAuth 2.0 | 📋 Planned |
| **Philips Hue (lights)** | Room states | On demand | Local network key | 📋 Planned |
| **Twilio (SMS)** | Send messages on Robert's behalf | On demand | API key | 📋 Planned |

---

## Integration 1: Calendar (Google Calendar / Apple Calendar)

**What Naavi needs:**
- Events for today and the next 7 days
- Event title, start time, location (if set), category (if tagged)

**What Naavi does NOT do:**
- Create or modify events (read-only in Phase 1)
- Access events older than 7 days in the past

**Google Calendar — how it works:**

Robert grants permission once through an OAuth screen in the app. Google gives Naavi a token (a temporary key). The adapter stores this token in Supabase (encrypted), refreshes it automatically, and syncs every 15 minutes.

Sync logic:
1. Fetch events from today through 7 days ahead
2. For each event, classify it: `medical`, `social`, `personal`, `other`
3. Medical classification: checks if event title contains known care team names or clinic names from the Cognitive Profile
4. Write to SQLite `calendar_events` table

**Degradation behaviour:**
- If sync fails: serve cached events, surface a soft note in the brief ("Calendar last updated 2 hours ago — events may have changed")
- If token is fully expired and cannot refresh: show integration as disconnected, notify Robert once

---

## Integration 2: MyChart (Health Portal via FHIR)

**What is FHIR?**
FHIR (Fast Healthcare Interoperability Resources) is the Canadian and US standard for exchanging health data. MyChart, used by most Ottawa-area health networks, supports FHIR R4. It is how apps are legally allowed to read health records with patient consent.

**What Naavi reads from FHIR:**

| FHIR Resource | What it contains | How Naavi uses it |
|---------------|-----------------|-------------------|
| `Appointment` | Upcoming appointments with date, provider, location | Morning brief, reminders |
| `MedicationRequest` | Prescribed medications, doses, prescriber | Reconciles against profile, refill tracking |
| `Condition` | Diagnosed conditions | Health context in profile |
| `Observation` | Lab results, vitals (BP, A1C, glucose) | Trend analysis — plain language summaries only |

**What Naavi does NOT do with FHIR data:**
- Interpret lab results or give medical opinions
- Surface raw numbers to Robert unprompted ("Your A1C is 6.8")
- Share any FHIR data with family members, ever

**Sync logic:**
1. Every 4 hours, call FHIR endpoints
2. On `Appointment`: compare with calendar — if an appointment is in FHIR but not in calendar, flag it as a pending thread ("Your MyChart shows a physiotherapy appointment on April 3 that isn't on your calendar. Want to add it?")
3. On `MedicationRequest`: compare against profile.health.medications — flag discrepancies
4. On `Observation`: compute trend direction (stable / rising / falling) over last 3 readings — never store raw values in the Cognitive Profile

**Canadian data note:**
FHIR data is subject to provincial health privacy law (PHIPA in Ontario, plus PIPEDA federally). This data is stored locally (SQLite) and in Supabase's Canada Central region. It is never sent outside Canada. It is never used to train models.

---

## Integration 3: Weather (Open-Meteo)

**Why Open-Meteo instead of a paid service?**
Open-Meteo is a free, open-source weather API with no API key required. It uses Environment Canada data for Canadian locations. There is no cost, no rate limiting for reasonable use, and no vendor lock-in.

**What Naavi reads:**
- Today's temperature, precipitation chance, condition (clear / cloudy / rain / snow)
- Next 3 days (for planning — golf, walks, family visits)

**How location works:**
Naavi uses Ottawa's coordinates (45.4215, -75.6972). No live GPS tracking — just the home city from Robert's profile. This is sufficient for weather context.

**How weather enters the brief:**
Weather is only mentioned in the morning brief if it is *relevant to something Robert cares about*. The adapter computes a `relevance_reason` field:
- If walking is in his morning routine and it is raining → relevant
- If it is golf season (May–October) and weekend is clear → relevant
- If it is -15°C and he usually walks → relevant
- If it is a mild Tuesday in November → not mentioned

---

## Integration 4: Smart Home

**Naavi's role in the smart home:**
Naavi does not proactively manage the smart home. Robert asks, Naavi acts. "Turn up the heat." "Lock the front door." "Dim the bedroom lights." Naavi translates natural language into API calls.

**Three devices in Robert's home:**

### Ecobee Thermostat
- Auth: OAuth 2.0 (Ecobee developer account)
- Reads: current temperature, set-point, mode (heat/cool/auto)
- Writes: set-point adjustments
- Sync: every 30 minutes (passive awareness — Naavi may note "it's 17°C in the house" if relevant)

### Philips Hue Lighting
- Auth: local bridge key (no cloud account needed — works even without internet)
- Reads: current state of each zone (on/off, brightness, colour temp)
- Writes: on/off, brightness, scene selection
- Sync: on demand only — Naavi does not poll lights constantly

### Schlage Smart Lock
- Auth: Schlage Access cloud API
- Reads: locked / unlocked state
- Writes: lock / unlock commands
- Sync: reads state when Robert asks — Naavi does NOT automatically lock/unlock
- Safety rule: Unlock commands require explicit confirmation ("Lock or unlock the front door?") — never done silently

**Voice command translation examples:**

| Robert says | Naavi does |
|------------|-----------|
| "Turn the heat up" | Ecobee: increase set-point by 1°C from current |
| "Set it to 22" | Ecobee: set heating set-point to 22°C |
| "Turn off the kitchen lights" | Hue: zone "kitchen" → off |
| "Dim the bedroom" | Hue: zone "bedroom" → 30% brightness |
| "Is the door locked?" | Schlage: read state, report verbally |
| "Lock up" | Schlage: lock front door, confirm verbally |
| "Unlock the door" | Ask: "Unlocking the front door — confirm?" before acting |

---

## Integration 5: Apple Health (HealthKit)

**What Naavi reads:**
- Steps (daily total, 7-day average)
- Sleep duration (last night, 7-day average)
- Resting heart rate (weekly average — only if available via Apple Watch)

**What Naavi does with it:**
- Compares steps to Robert's stated goal (7,500/day)
- Detects significant deviation from his pattern (3+ days below average)
- Surfaces in the morning brief ONLY if relevant ("You've been sleeping under 6 hours the last 3 nights — might be worth noting for Dr. Patel")

**What Naavi does NOT do:**
- Display raw numbers in conversation ("You took 4,382 steps yesterday")
- Alert Robert to minor fluctuations
- Draw medical conclusions from trends

**Sync:** Once daily at 07:00, before Robert typically opens the app. This ensures health data is fresh when the morning brief is assembled.

---

## Degradation Hierarchy

What happens when things go wrong — in order of priority:

```
1. Sync failure (network down, API error)
   └─► Use cached data. Note "last synced X hours ago" in brief if > 2 hours.

2. Token expired (auth issue with Google/MyChart/Ecobee)
   └─► Integration moves to 'degraded'. Data still served from cache.
       Naavi mentions once: "I've lost access to your calendar — you may want
       to reconnect it." Does not repeat.

3. Integration fully disconnected (Robert revoked, or never connected)
   └─► That integration's section is simply absent from the brief.
       Naavi does not apologise or explain. It just works with what it has.

4. SQLite corruption or phone storage issue (rare)
   └─► Pull last known state from Supabase cloud. Rebuild local cache.

5. All integrations unavailable (no data at all)
   └─► Naavi still works from the Cognitive Profile alone.
       "I don't have today's calendar handy. Want to tell me what's on?"
```

---

## The Sync Scheduler

The sync scheduler is a background process that runs on the phone even when Naavi is not open. It is managed by Expo Background Fetch.

```
Sync schedule:

07:00  ─── Apple Health (daily)
           ─── Morning brief pre-assembly (prepares brief before Robert wakes)

Every 15 min ─── Google Calendar / Apple Calendar

Every 30 min ─── Ecobee (thermostat state)

Every hour   ─── Open-Meteo (weather)

Every 4 hours ── MyChart (FHIR health data)

On demand    ─── Philips Hue (only when Robert gives a light command)
             ─── Schlage (only when Robert asks about or commands the lock)
```

Battery consideration: background sync is lightweight — each task is a small HTTP request and a SQLite write. Apple and Android have strict rules about background apps; Expo Background Fetch is the approved, battery-efficient way to do this. The sync schedule above is within Apple's limits (15-minute minimum interval on iOS).

---

## OAuth Token Management

OAuth is how Robert gives Naavi permission to read his Google Calendar or MyChart without giving it his password. Here is how that works in practice:

1. **First setup:** Robert taps "Connect Google Calendar" in Naavi. A browser window opens showing a Google consent screen. He approves. Google gives Naavi a short-lived *access token* (valid 1 hour) and a long-lived *refresh token* (valid until revoked).

2. **Token storage:** Both tokens are stored encrypted in Supabase, associated with Robert's user ID. They are never stored in plain text.

3. **Token refresh:** One minute before the access token expires, the adapter automatically exchanges the refresh token for a new access token. Robert never sees this happen.

4. **Revocation:** If Robert revokes access (in his Google settings, or by tapping "Disconnect" in Naavi), the tokens are immediately deleted from Supabase. Naavi moves the integration to `disconnected` status.

---

## What the Integration Layer Exposes to the Rest of the App

The rest of Naavi's code (the Morning Brief Assembler, the AI orchestration layer, the smart home command handler) never imports individual adapters directly. They go through a single unified interface: the **Integration Orchestrator**.

```typescript
// What the rest of the app sees:

const orchestrator = useIntegrationOrchestrator();

// Read normalised data (always from cache):
const events = await orchestrator.calendar.getEventsForToday();
const weather = await orchestrator.weather.getTodaySummary();
const health = await orchestrator.healthPortal.getUpcomingAppointments();

// Execute a smart home command:
await orchestrator.smartHome.executeCommand("set thermostat to 22");

// Check status of all integrations:
const status = await orchestrator.getStatus();
// Returns: { calendar: 'connected', myChart: 'degraded', weather: 'connected', ... }
```

No part of the app needs to know whether Robert uses Google Calendar or Apple Calendar, or whether MyChart is currently reachable. The orchestrator handles all of that invisibly.
