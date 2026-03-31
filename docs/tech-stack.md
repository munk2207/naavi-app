# Naavi — Technology Stack

> Version 0.1 — March 2026
> Every decision explained in plain English. No jargon without a translation.

---

## The Core Question

Robert uses a phone. He wants to talk to something that understands him. That thing needs to remember everything, connect to his existing tools, and work whether or not his WiFi is fast. It needs to handle English and French. And it needs to not feel like an app built for someone's grandmother — because Robert is sharp.

Here is what that requires technically, and what we chose.

---

## The Stack at a Glance

```
Layer                   | Technology           | Plain English
------------------------|----------------------|----------------------------------
Mobile app              | React Native (Expo)  | One app, works on iPhone + Android
Voice input             | Whisper (OpenAI)     | Robert speaks, it understands
Voice output            | ElevenLabs           | Naavi speaks back, naturally
AI brain                | Claude (Anthropic)   | The reasoning and language engine
Profile storage (local) | SQLite               | Fast, offline, on the phone
Profile storage (cloud) | Supabase (Postgres)  | Backup, sync, cross-device
Semantic memory         | pgvector             | Finds relevant memories by meaning
Authentication          | Supabase Auth + FaceID| Robert uses his face, not a password
Internationalisation    | i18next              | English/French switching, seamless
Calendar / Health sync  | Expo APIs            | Reads Robert's existing tools
Smart home              | REST APIs (per brand)| Talks to Ecobee, Hue, Schlage
Notifications           | Expo Notifications   | Reminders, nudges, alerts
Data residency          | Supabase ca-central-1| Robert's data stays in Canada
```

---

## Decision 1 — Mobile Framework: React Native with Expo

**What it is:** A way to build one application that runs on both iPhone (iOS) and Android, using a single codebase.

**Why not native (building separate iPhone and Android apps)?**
Native gives the best possible performance, but it means building and maintaining two completely separate codebases. For a small team starting a new product, that doubles cost and complexity with limited benefit.

**Why not Flutter?**
Flutter (by Google) is a strong alternative. We chose React Native because:
- Larger talent pool in Canada
- Expo (the toolkit that sits on top of React Native) dramatically reduces setup time
- Better ecosystem for the integrations Naavi needs (calendar, health, voice)

**Why Expo specifically?**
Expo is like a power strip for React Native. Without it, connecting to the phone's camera, calendar, microphone, or health data requires deep technical surgery. With Expo, those connections are pre-built. This lets us focus on Robert's experience, not plumbing.

**Senior-specific consideration:** React Native has mature, well-tested libraries for large text, high-contrast interfaces, and accessibility — all important for an older audience.

---

## Decision 2 — Voice Input: OpenAI Whisper

**What it is:** A speech-to-text model. Robert speaks; Whisper converts his words to text that Claude can reason about.

**Why Whisper over alternatives?**

| Option | Accuracy | French | Cost | Notes |
|--------|----------|--------|------|-------|
| Whisper (OpenAI) | Excellent | Excellent | Low | Best bilingual accuracy |
| Google Speech | Very good | Good | Low | Tied to Google ecosystem |
| Apple Speech | Good | Good | Free | On-device, no internet needed |
| Azure Speech | Very good | Excellent | Medium | Strong enterprise option |

Whisper wins because its French Canadian accuracy is the best available in its price range. Robert switching mid-sentence between English and French ("Je cherche mon... my appointment on Thursday") is handled naturally.

**Offline consideration:** For a future version, we can run a smaller Whisper model directly on Robert's phone. For now, it sends a short audio clip to the cloud (under 1 second of latency on a normal connection).

---

## Decision 3 — Voice Output: ElevenLabs

**What it is:** A text-to-speech engine. Naavi's responses are converted to spoken audio.

**Why not the phone's built-in voice?**
The built-in voice (Siri's voice, Google's voice) sounds robotic. For a companion that Robert interacts with daily, that matters. ElevenLabs produces voices that sound like a calm, clear human.

**What we configure:**
- A consistent voice identity for Naavi — not overly cheerful, not clinical
- Speed: slightly slower than default (research shows 10–15% slower speech is preferred by users over 60)
- French voice available instantly when Robert switches languages

**Cost note:** ElevenLabs charges per character of text spoken. A typical Naavi interaction is 50–150 characters. This is a small, predictable cost.

---

## Decision 4 — AI Brain: Claude (Anthropic)

**What it is:** The large language model that reads Robert's Cognitive Profile, understands what he said, decides what to do, and composes the response.

**Why Claude over ChatGPT or others?**
- Claude has a 200,000-token context window — meaning it can hold Robert's *entire* Cognitive Profile in a single conversation without forgetting earlier parts. ChatGPT-4's window is significantly smaller.
- Claude's instruction-following is exceptionally precise. When we tell it "never be condescending to Robert" or "speak French when he switches," it reliably follows those rules.
- Claude is designed for thoughtful, nuanced responses — appropriate for a companion, not a search engine.
- Anthropic's approach to AI safety aligns with Naavi's ethos of trustworthy, bounded behaviour.

**How it is used:**
Every time Robert speaks to Naavi, his message + relevant parts of his Cognitive Profile are sent to Claude. Claude reasons about what matters, consults the profile, and generates a response. It does not remember the conversation on its own — the Cognitive Profile is the memory.

---

## Decision 5 — Database: SQLite (local) + Supabase (cloud)

**This is the most important architectural decision.** Naavi needs two kinds of storage for different reasons.

### Local storage: SQLite

**What it is:** A tiny, fast database that lives directly on Robert's phone.

**Why it matters:** Robert should be able to ask Naavi "What time is my appointment today?" and get an instant answer — even if his WiFi is down, even if he's at his golf club with poor signal. The Cognitive Profile (or a compressed version of it) lives on-device.

SQLite is used by every iPhone and Android phone already. It is battle-tested, extremely reliable, and requires no internet connection.

### Cloud storage: Supabase

**What it is:** A hosted database service built on PostgreSQL — the most trusted database technology in the world.

**Why Supabase over others (Firebase, AWS, etc.)?**

| Criteria | Supabase | Firebase (Google) | AWS |
|----------|----------|-------------------|-----|
| Canadian data residency | Yes (ca-central-1) | Limited | Yes (but complex) |
| Open source | Yes | No | No |
| Setup complexity | Low | Low | Very high |
| SQL (structured data) | Yes | No | Yes |
| Cost | Predictable | Can spike | Complex |

**Canadian data residency** is the deciding factor. Robert's health context, routines, and relationship data may intersect with information regulated under Ontario and federal Canadian privacy law (PIPEDA). Supabase has a Canada (Central) region — Robert's data never leaves Canada unless he explicitly chooses otherwise.

### pgvector: The semantic memory layer

**What it is:** An extension to Supabase that stores memories as mathematical "meaning vectors."

**Why it matters:** If Robert says "remember the thing about my brother and the golf trip," a regular database search finds nothing — because he did not say "Claude" or "Gatineau." A vector search understands *meaning*. It finds the relevant memory even when the words do not match exactly.

This is how Naavi feels like it remembers — not just stores.

---

## Decision 6 — Authentication: Supabase Auth + Biometrics

**What it is:** How Robert proves to Naavi that he is Robert.

**Design choice:** Robert should never type a password. Ever.

- First setup: email link (one tap)
- Every subsequent login: Face ID or fingerprint

Supabase Auth handles the security layer. Expo LocalAuthentication handles the Face ID / fingerprint on the phone. From Robert's perspective: he opens Naavi, his phone recognises him, he starts talking.

---

## Decision 7 — Internationalisation: i18next

**What it is:** A library that manages all the text in the app in multiple languages.

**How English/French works in Naavi:**

Naavi has two language layers:

1. **App interface language** — all buttons, menus, labels. Set once at setup.
2. **Conversation language** — what Robert speaks and what Naavi speaks back. Can switch mid-conversation.

i18next manages layer 1. Whisper + Claude manage layer 2 dynamically.

When Robert says "parle-moi en français," Claude detects the switch, updates the active language in the Cognitive Profile, and begins responding in French. When he says "switch to English," it switches back. This preference is remembered.

**Canadian French consideration:** We configure French language models to use Canadian French vocabulary and idioms where they differ from European French. "Courriel" not "email." "Stationnement" not "parking."

---

## Decision 8 — Integrations: Expo SDK + REST APIs

**Calendar (Google Calendar / Apple Calendar):**
Expo provides a `Calendar` API that reads from whatever calendar app Robert uses — no migration required. Naavi reads events; it does not rewrite Robert's calendar unless he asks.

**Health data (Apple HealthKit / Google Fit):**
The `react-native-health` library reads from Robert's phone's health data (steps, sleep, heart rate if available). Robert grants permission once. Naavi reads trends, not raw values.

**Smart home (Ecobee, Philips Hue, Schlage):**
Each device brand has a cloud API. Naavi stores access tokens (securely, in Supabase) and makes API calls when Robert gives a voice command. "Set the thermostat to 22" → Naavi calls the Ecobee API.

**Health portal (MyChart):**
MyChart has a FHIR API (a Canadian/US health data standard). With Robert's credentials, Naavi can pull upcoming appointments, lab results, and medication lists. This is the most sensitive integration — handled with explicit consent and re-confirmation.

---

## Data Flow for a Single Interaction

When Robert says: *"Do I have anything important today?"*

```
1. Robert speaks
   ↓
2. Whisper converts speech to text
   ↓
3. App retrieves relevant profile sections (calendar, rhythms, pending threads)
   from local SQLite — fast, offline-capable
   ↓
4. App sends to Claude:
   - Robert's message
   - Today's calendar events
   - Pending medication reminder
   - Any pending threads due today
   - Robert's preferences (concise morning response)
   ↓
5. Claude reasons and responds:
   "Yes — Dr. Patel at 2pm, and your metformin refill reminder is set for March 28.
   Nothing else pressing."
   ↓
6. ElevenLabs converts response to speech
   ↓
7. Robert hears the answer
   ↓
8. Interaction is logged to Supabase (text only, no audio)
   Profile signals updated (morning interaction, appointment confirmed)
```

Total time: 1.5–3 seconds.

---

## What This Stack Costs to Run

| Component | Pricing Model | Estimated Monthly (Year 1) |
|-----------|--------------|---------------------------|
| Claude API | Per token (~$3/million tokens) | ~$15–30/month active use |
| ElevenLabs | Per character (~$0.30/1K chars) | ~$5–10/month |
| Whisper | Per audio minute ($0.006/min) | ~$3–5/month |
| Supabase | Free tier → $25/month Pro | $0–25/month |
| Expo | Free (EAS Build: $99/yr) | ~$8/month |
| **Total** | | **~$30–70/month running cost** |

This is the cost to operate for one user. At scale, all of these prices drop significantly with volume agreements.

---

## What This Stack Does NOT Include (Yet)

- **Push notifications for emergency contacts** — when to involve Sophie (Phase 2)
- **Wearable integration** — Apple Watch, Garmin (Phase 2)
- **Web dashboard** — for Robert to review his profile on a computer (Phase 3)
- **Family view** — optional read-only view for Sophie, with Robert's consent (Phase 3)
- **On-device AI** — running a small model directly on the phone for full offline AI (Phase 4)

---

## Security & Privacy Summary

| Concern | How it is handled |
|---------|------------------|
| Robert's data leaves Canada | Supabase ca-central-1. Data never leaves Canada. |
| Audio recordings stored | No. Transcripts only. Audio is discarded after transcription. |
| Health data shared with family | Off by default. Robert explicitly enables, person by person. |
| What happens if phone is stolen | Biometric lock + Supabase auth token expires after 24 hours |
| Data deletion | Robert can request full deletion. Purged within 24 hours. |
| Financial data | Not connected. Not stored. Not requested. |
