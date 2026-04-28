# Competitive touchpoints matrix

**Internal document — Naavi product strategy**
**Last updated:** 2026-04-29

Naavi's value comes from the breadth of its integration touchpoints AND the fact that 10 of them feed a single unified Global Search. Competitors aggregate at the suite level — 5 apps under one brand — but each app is its own data silo. This document maps Naavi's integration surface against the major competitor categories.

---

## Naavi's integration touchpoints (~25)

Everything below is operational today (or partially built and noted), beyond Claude's reasoning layer.

### A. Google ecosystem (7)

| # | Touchpoint | What Naavi does |
|---|---|---|
| 1 | Gmail | Reads tier-1 emails, classifies action items, harvests attachments, sends outbound |
| 2 | Google Calendar | Reads ALL calendars (including subscribed + birthdays), creates / edits / deletes events |
| 3 | Google Drive | Saves notes, transcripts, briefs, lists, and harvested attachments into a typed folder tree (`MyNaavi/Documents/invoice/`, etc.); searches both metadata and full-text |
| 4 | Google Maps | Travel time, directions, traffic-aware ETA |
| 5 | Google Places | Location-name resolution (`home` / `office` / branch-specific names) with cache |
| 6 | Google People (Contacts) | Live multi-match lookup with `otherContacts` fallback |
| 7 | Google Vision | OCR on scanned PDFs and image attachments |

### B. Naavi-managed personal data (8)

| # | Touchpoint | What it stores |
|---|---|---|
| 8 | Reminders | One-off time-based reminders (mirrored to Calendar for visibility) |
| 9 | Memory / REMEMBER | Free-text knowledge with pgvector embeddings |
| 10 | Lists | Groceries, todo, packing — synced to Drive Docs |
| 11 | Action Rules | Generic trigger framework: email, time, calendar, weather, contact-silence, location |
| 12 | Sent Messages | Log of every SMS / WhatsApp / email Naavi sent |
| 13 | Documents (typed) | 11 categories: invoice, warranty, receipt, contract, medical, statement, tax, ticket, notice, calendar, other |
| 14 | Email Actions | Structured action items Claude pulls from emails (bills, appointments, renewals) |
| 15 | Conversation Transcripts | Record-a-visit recordings + speaker-diarized transcripts saved to Drive |

### C. Real-world signals (3)

| # | Touchpoint | What Naavi does |
|---|---|---|
| 16 | Geolocation / Geofencing | OS-level geofences fire arrival / departure events for location alerts |
| 17 | Weather | External weather API drives weather-trigger rules |
| 18 | MyChart (Epic) Health portal | OAuth-authenticated read of Robert's medical records, lab results, appointments, and prescriptions from his Epic-backed health system. Brings clinical context into Naavi's brief, search, and reminders alongside the rest of his data. |

### D. Voice and delivery infrastructure (5)

| # | Touchpoint | What it does |
|---|---|---|
| 19 | Twilio Voice | Inbound call line and outbound morning brief calls |
| 20 | Twilio SMS / WhatsApp | Alert delivery and confirmations |
| 21 | Push Notifications (Expo) | Per-device alerts |
| 22 | Deepgram STT + TTS (Aura) | Streaming voice in mobile and voice server |
| 23 | AssemblyAI | Conversation diarization for Record-a-visit |

### E. Document processing pipeline (2)

| # | Touchpoint | What it does |
|---|---|---|
| 24 | Attachment harvesting | Pulls PDF / JPG / PNG / DOCX / XLSX off tier-1 Gmail messages, uploads them into typed Drive folders, de-dupes per `(user, message, filename)` |
| 25 | OCR + classification + routing | Claude Haiku reads PDF text layer; Vision DOCUMENT_TEXT_DETECTION handles scanned PDFs and images; Haiku classifies into 11 document types; sidecar `.ocr.txt` saved alongside; Drive file moved to the correct typed folder if the content-based classification differs from the harvest-time guess |

---

## Comparison table

| Service | Touchpoints | What's covered | What's missing vs Naavi |
|---|---|---|---|
| **Naavi** | **~25** | Full list above + unified Global Search across 10 of them | Banking, smart home, photos, music, wearables (planned in later phases) |
| **Google Workspace + Gemini** | 5–8 | Gmail, Calendar, Drive, Meet, Chat — Gemini adds Photos, Maps, Search context | No phone-call interface, no morning brief, no proactive triggers, no SMS / WhatsApp, no attachment harvesting, no senior-friendly voice loop |
| **Microsoft 365 + Copilot** | 5–8 | Outlook, Teams, OneDrive, Word / Excel / PowerPoint, LinkedIn (light) | Same gaps as Google. No voice-first or phone-line mode. |
| **Apple Intelligence (Siri)** | 8–10 | Mail, Calendar, Notes, Reminders, Contacts, Maps, Photos, Health, Find My, Music | Shallow reasoning, no proactive briefs, no email harvesting, no SMS / WhatsApp / email triggers, no Twilio voice line, iOS-only |
| **ChatGPT (with connectors)** | 4–6 | Drive, OneDrive, Slack, web browsing, file upload, basic memory | No phone calls, no SMS triggers, no calendar control, no geofencing, no document harvesting pipeline |
| **Amazon Alexa** | 4–6 | Calendar (via integration), lists, music, smart home, skills, reminders | Voice-only single device, no email / SMS understanding, no document layer, no global knowledge across sources |
| **Lively (Best Buy)** | 3 | Phone, urgent response, concierge | Single-device, no AI knowledge layer, no calendar / email / drive |
| **GrandPad** | 5 | Photos, video calls, music, games, family feed | Tablet-only, no AI, no email / calendar / drive integration |

---

## Why the count matters

Most competitors aggregate at the suite level (multiple apps under one brand), but each app is its own data silo. Naavi is the only product where 10 touchpoints feed a single unified Global Search — when Robert asks *"when do I owe Bell?"*, the answer pulls from `gmail` + `email_actions` + `drive` + `sent_messages` simultaneously and composes one sentence.

The 10 Global Search adapters live today: knowledge, rules, sent_messages, contacts, lists, calendar, gmail, email_actions, drive, reminders.

### How competitors stack up against the unified-search axis

- **Google Gemini** is moving toward unified search but stops at the Workspace boundary. No SMS, no Twilio voice, no proactive brief.
- **Apple Intelligence** is closest in personal-data breadth (~10 sources) but narrowest in reach. iOS-only, no phone-call interface for seniors, no third-party SMS / WhatsApp, no proactive morning brief.
- **Senior-care products** (Lively, GrandPad) have fewer than 5 touchpoints and zero AI knowledge layer. They solve hardware needs, not orchestration.

### The pipeline effect

Five touchpoints chain together to make a single email attachment searchable, classified, and ready for retrieval:

```
Gmail (1)
  -> Attachment harvesting (24)
  -> OCR + classification (25)
  -> Drive typed folders (3)
  -> Documents store (13)
  -> Global Search (drive adapter)
```

No competitor today owns this end-to-end orchestration for a senior user.

---

## Notes for revisions

- This document is internal. Re-cut for investor / sales decks as needed (see `docs/LAUNCH_PLAN.md` for messaging).
- When Naavi adds a new touchpoint, update Section A–E above and bump the total count in the comparison table.
- When a competitor announces meaningful new coverage (e.g. Apple Intelligence adds third-party SMS), update their row.
