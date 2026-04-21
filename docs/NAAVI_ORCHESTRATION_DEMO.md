# MyNaavi — Orchestration in Action

## 15 commands that prove Naavi is not just integration

> *Integration* forwards data between two apps. *Orchestration* transforms it, reasons about it, and acts across many services on the user's behalf. Every command below reaches through at least three systems to deliver a result no single app can match.

---

## How to read this sheet

- **User says** — what Robert types or speaks, with natural variants.
- **Services touched** — each system Naavi calls to answer.
- **Naavi replies** — an example answer using real data shape.
- **What this replaces** — the human effort that goes away.

---

### 1. Buried warranty, instantly surfaced

**User says:**
- *"Find the warranty for my washing machine."*
- *"When does the washer warranty expire?"*
- *"Pull up my warranty paperwork."*

**Services touched:**
Gmail → Claude Haiku (classify) → Google Drive (harvest) → Google Vision OCR → Supabase `documents` → Global Search → Claude Sonnet (answer)

**Naavi replies:**
> *"LG 4.5 Cu. Ft. WM3900H washing machine — warranty covers through July 14, 2028. The document is in your MyNaavi Drive folder."*

**What this replaces:** Remembering which email, downloading the scanned PDF, trying to read faded image text, finding the expiry date.

---

### 2. Geofenced grocery list that stays current

**User says:**
- *"Alert me at Costco with my grocery list."*
- *"When I get to Costco, remind me what I need."*

**Services touched:**
Google Places API → Supabase `action_rules` → Supabase `lists` → Google Drive (live Doc content) → phone GPS + OS geofence → Twilio SMS + WhatsApp + Gmail + FCM push

**Naavi replies (on arrival at Costco):**
> *"Arrived at Costco. Grocery list: milk, eggs, bread, coffee, toilet paper."*

**What this replaces:** A static reminder the user has to remember to update, open, and read on the right device at the right moment.

---

### 3. School calendar question answered from the PDF

**User says:**
- *"When is the first day of school?"*
- *"What's the next PA day?"*
- *"When does spring break start?"*

**Services touched:**
Gmail (attachment harvest) → Claude Haiku (classify as `calendar`) → Drive → Supabase `documents` → Claude Sonnet reads the PDF grid at ask-time → answer

**Naavi replies:**
> *"The first day of school is September 2, 2026."*

**What this replaces:** Opening the school website, locating the PDF, navigating to September in a grid layout.

---

### 4. Ambient absence detection

**User says:**
- *"Tell me if my sister Sarah hasn't emailed me in 30 days."*
- *"Let me know if John goes quiet for two weeks."*

**Services touched:**
Gmail sync → Supabase `gmail_messages` → evaluate-rules cron (every minute) → Twilio SMS + WhatsApp + Gmail + FCM push

**Naavi fires (when silence threshold hits):**
> *"Heads up — Sarah hasn't emailed you in 30 days. Worth a check-in."*

**What this replaces:** No existing app reminds about the *absence* of something. This is a novel class of reminder.

---

### 5. Morning brief as a phone call

**User says:**
- *(Robert's phone rings at 8 AM)*

**Services touched:**
Twilio voice → Google Calendar (all subscribed calendars) → Gmail (tier-1 summarization) → Open-Meteo weather → Supabase reminders → Claude Sonnet composes → Deepgram Aura Hera TTS

**Naavi speaks:**
> *"Good morning, Wael. You have two things today: dentist at 2 PM on Bank Street, and Sarah is calling around 5. Ottawa is 4 degrees with rain by 3 PM — grab an umbrella for the dentist run. Two important emails: Bell confirmed your bill is paid, and the condo board sent the AGM date. Anything else?"*

**What this replaces:** Five apps glanced at in sequence, then mentally stitched together.

---

### 6. In-call visit recorder

**User says (during a Twilio call):**
- *"Naavi, record my visit."*

**Services touched:**
Twilio recording → AssemblyAI transcription → Claude summary → Google Drive (save transcript) → Gmail (email summary to self) → Supabase `documents` → Global Search

**Naavi replies, then (after hang-up):**
> *"Recording your visit."* [... conversation happens ...]
> *Email arrives: "Visit summary — Dr. Chen, April 21. BP 142/88, increase Atorvastatin to 40 mg, follow-up in 3 months. Full transcript in your Drive."*

**What this replaces:** Robert trying to remember what the doctor said. Wife calling to ask. Reading scribbled notes.

---

### 7. *"Home"* becomes a real place

**User says:**
- *"Alert me when I arrive home."*
- *"Text me when I'm at the house."*

**Services touched:**
Supabase `user_settings.home_address` → Google Geocoding API → `user_places` cache → phone GPS + OS geofence → Twilio SMS + WhatsApp + Gmail + FCM push

**Naavi replies:**
> *"Your home from Settings — I'll alert you when you arrive."*

**What this replaces:** Having to type coordinates, manually drop a pin, or remember what Google thinks "home" means this week.

---

### 8. Weather + checklist, one morning ping

**User says:**
- *"Text me at 7 AM if rain is forecast tomorrow with my umbrella list."*
- *"Every morning, if it's snowing, remind me to clear the steps and salt the driveway."*

**Services touched:**
Open-Meteo forecast → evaluate-rules cron → user timezone gate → Supabase `lists` → Google Drive (live list content) → Twilio SMS + WhatsApp + Gmail + FCM push

**Naavi fires (when conditions match):**
> *"Heads up — 80% chance of rain tomorrow afternoon. Umbrella list: umbrella, raincoat, waterproof shoes."*

**What this replaces:** Manually checking the forecast, remembering to grab the umbrella, updating a static checklist.

---

### 9. *"What do I know about David?"*

**User says:**
- *"What do I know about David?"*
- *"Pull everything on David Chen."*

**Services touched:**
Google People API (contact card) + Supabase `knowledge_fragments` (REMEMBER notes via pgvector embeddings) + Global Search (emails, SMS sent, calendar events mentioning David) + Claude Sonnet synthesis

**Naavi replies:**
> *"David Chen, architect at Hammond. You haven't emailed him in three weeks. Last message from him: the cottage renovation quote on March 30. You flagged him as 'wife's cousin' in memory last year."*

**What this replaces:** Searching Contacts, then Gmail, then scrolling old messages, then piecing it together.

---

### 10. Bill due surfaced from an invoice PDF

**User says:**
- *"When do I owe money to Bell?"*
- *"What's due on my Bell account?"*

**Services touched:**
Gmail → Claude Haiku extract (`action_type='pay'`) → attachment harvest → Vision OCR on scanned invoice → Supabase `email_actions` → Global Search

**Naavi replies:**
> *"Your Bell invoice for $89.56 is due April 28. That's 5 days away."*

**What this replaces:** Opening the email, downloading the PDF, reading the due line, doing the date math.

---

### 11. Leave time with a weather buffer

**User says:**
- *"What time should I leave for my 3 PM dentist?"*
- *"When do I need to head out for the doctor?"*

**Services touched:**
Google Calendar (find the event + address) → Google Maps Directions API → Open-Meteo weather (rain buffer) → Claude Sonnet reasoning

**Naavi replies:**
> *"Leave at 2:10. Normal drive is 25 minutes but rain is forecast, so I'm adding 15 minutes for traffic."*

**What this replaces:** Looking up the event, copying the address to Maps, guessing the buffer for rain.

---

### 12. Cross-channel recall of a conversation

**User says:**
- *"What did I tell the doctor about my blood pressure?"*
- *"Did I mention to David that I'd be late?"*

**Services touched:**
Supabase `sent_messages` (SMS + WhatsApp + email) + Supabase `documents` (voice transcripts) + Supabase `knowledge_fragments` (saved notes) → Global Search → Claude Sonnet

**Naavi replies:**
> *"On March 30 you told Dr. Chen your BP was running 140 over 85. You also texted Sarah on April 2 saying the new medication made you dizzy."*

**What this replaces:** Scrolling through Messages, then Email, then Voice Memos — no unified search across them exists natively.

---

### 13. Calendar-triggered message to a specific contact

**User says:**
- *"30 minutes before my dentist, text my wife I'll be late for dinner tonight."*
- *"An hour before my flight, email my brother the arrival time."*

**Services touched:**
Google Calendar event match → Supabase `action_rules` (calendar trigger) → Google People API (contact resolution: "my wife") → Twilio SMS + WhatsApp

**Naavi fires (30 min before the event):**
> *(Sends to wife's phone:)* *"He'll be late for dinner tonight — dentist appointment ran over."*

**What this replaces:** Robert having to remember to text his wife while sitting in a waiting room.

---

### 14. One sentence, two writes

**User says:**
- *"Remember Sarah's birthday is April 15."*
- *"Save that my insurance number is POL-8841."*

**Services touched:**
Claude Sonnet (extract) → Supabase `knowledge_fragments` (pgvector embed) → Google Calendar (auto-create annual event) → Global Search coverage

**Naavi replies:**
> *"Saved. Also added 'Sarah's birthday' to your calendar as a yearly reminder on April 15."*

**What this replaces:** Two separate trips — once to the notes app, once to the calendar.

---

### 15. Prescription timeline from unstructured pharmacy email

**User says:**
- *"When does my Atorvastatin run out?"*
- *"How many days of blood pressure pills do I have left?"*

**Services touched:**
Gmail (pharmacy emails) → attachment harvest (prescription PDFs) → Claude Haiku extract (refill date, dosage) → Supabase `email_actions` + `documents` → Global Search → Claude Sonnet

**Naavi replies:**
> *"Your Atorvastatin 40 mg bottle has 12 days left based on the April 8 fill. Refill is authorized through July. Want me to flag a pickup reminder 3 days before?"*

**What this replaces:** Reading the pharmacy label, doing the math, remembering to re-order.

---

## What this list proves

| Claim | Commands that prove it |
|---|---|
| Naavi reads documents, not just emails | 1, 3, 10, 15 |
| Naavi acts on the user's absence, not just their actions | 4 |
| Naavi operates when the user doesn't | 5, 8, 13 |
| Naavi unifies content across channels | 9, 12 |
| Naavi transforms unstructured input into structured output | 1, 3, 10, 14, 15 |
| Naavi respects personal language ("home", "wife", "my sister") | 2, 7, 13 |
| Naavi combines location, time, weather, and content in one action | 2, 8, 11 |

---

## Why this is the product, not a feature

A calendar app tells you what's next. An email app tells you what came in. A weather app tells you whether to bring an umbrella.

MyNaavi reads them all, reasons across them, and acts in the world on the user's behalf — via SMS, voice, email, and push — so that the senior using it never has to stitch any of it together manually.
