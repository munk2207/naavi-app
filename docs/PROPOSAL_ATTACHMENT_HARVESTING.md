# Proposal — Ambient Document Harvesting

**Working name:** Attachment Harvesting / "Robert's Extended Brain"
**Date:** April 17, 2026
**Status:** Proposed for next development phase (recommended immediately after mobile-voice update + morning-call verification)

---

## 1. The real problem (starts with Robert, not with technology)

Robert is retired, sharp, still fully himself. His calendar isn't what it used to be. But the list of things he has to consciously hold in his head is *longer*, not shorter. Names, dates, prescriptions, warranties, payment methods, renewals — things that used to come without effort now require active attention.

The worst of it is the inbox. What used to take twenty minutes — skim, sort, reply, file — now outpaces him. Fewer messages arrive than when he was working, but the *proportion* that are neither obvious junk nor clearly urgent has grown faster than his reading stamina. **Telling the important apart from the unimportant requires actually reading each one. He can't read them all.**

So the unread count climbs. And when he deletes to make room, he sometimes deletes a notice from the government, the condo board, the insurance company — not because he didn't care, but because he never had time to tell which was which. He carries that for days.

The concrete consequences are real and already in the founder letter:

- Paying for a repair that was still under warranty from last year
- A recurring payment declined because the card expired and no one updated it
- An appointment quietly missed
- A grandchild's birthday remembered a day too late for the gift to arrive on time
- Arriving at a family dinner empty-handed

**Every one of these has a paper trail that already exists — in his email, as an attachment or a structured body text. The information is there. It is just unreachable.**

---

## 2. What Naavi does about it

Naavi doesn't read Robert's emails the way an email client does. She doesn't surface conversations, summarise threads, or make Robert clear his inbox. Her job is narrower and sharper: **she captures the documents that prove things, so that deletion doesn't erase them, and retrieval is a single voice query away.**

Two inputs, one memory:

1. **Attachments.** PDFs, images, Word/Excel files. Roughly 90% of meaningful life documents arrive this way — invoices, warranties, statements, tickets, lab results, referrals, tax slips, confirmations.
2. **Structured data from email bodies** when no attachment exists. Dates, amounts, vendors, reference numbers. (Think: GST refund notices, airline tickets, delivery confirmations that live in body text.)

Nothing else from the email is stored. No conversations. No personal exchanges with family. No marketing content. **Attachment-first is the privacy line.**

The captured documents live in the user's own Google Drive under `MyNaavi/Documents/`, organised by category (Invoices, Warranties, Medical, Contracts, Tickets, Other). Text and metadata are indexed into `knowledge_fragments` with a Drive link back to the original file. From then on:

> Robert: *"Hey Google, call Naavi. Do I have a warranty for my brake repair from last year?"*
> Naavi: *"Yes. On November 14, 2025 you had brake service at Centretown Auto, $847.50. The work is covered for 24 months or 40,000 kilometres. I can open the invoice on your phone if you'd like."*

Even if Robert has since deleted the email, the document and its indexed facts remain. **Deletion doesn't erase the evidence.**

---

## 3. Why this matters more than it sounds

1. **It makes the founder letter real.** Every pain we named — warranty, expired card, missed notice from the condo board — becomes a solved problem, not a sympathetic observation.
2. **It's differentiated.** Siri, Google Assistant, Alexa do not do this. Nor do general AI apps. An ambient document memory that answers by voice is a genuine product moat.
3. **It respects the trust line.** By capturing only attachments + structured body data, not conversational email, the intrusion feels proportional to the value.
4. **It extends the orchestration thesis.** Naavi is the navigation layer above tools Robert already uses. His email remains his email. Drive remains his Drive. Naavi simply connects them into a searchable extended brain.
5. **It closes the cognitive-offload gap explicitly named in the letter.** The research already says offloading doesn't partially help — it closes the gap. This is the feature that operationalises that insight.

---

## 4. Technical architecture (fits the current stack)

No new platforms needed. Uses what's already in place: Gmail OAuth, Supabase Edge Functions, Google Drive, Claude for classification, existing `knowledge_fragments` retrieval.

### Background sync pipeline

1. **Cron / push-based Gmail watch** triggers on new messages with attachments (or on a 6-hour sweep for first 12 months).
2. **Filter** by attachment type (PDF / JPG / PNG / DOCX / XLSX) and size. Exclude obvious spam.
3. **Download** attachment → upload to user's Google Drive under `MyNaavi/Documents/<category>/` using the existing `save-to-drive` Edge Function pattern.
4. **Extract text** —
   - Text-layer PDFs: `pdftotext` or Claude with the file directly.
   - Image-based PDFs and photos: OCR (Google Vision API or AWS Textract).
   - DOCX / XLSX: native parsers.
5. **Classify with Claude** — prompt returns structured fields:
   ```json
   {
     "type": "warranty|invoice|receipt|contract|medical|ticket|statement|other",
     "vendor": "Centretown Auto",
     "date": "2025-11-14",
     "amount": 847.50,
     "currency": "CAD",
     "reference": "INV-4421",
     "expiry": "2027-11-14",
     "summary": "Brake repair — front pads and rotors — 24-month warranty"
   }
   ```
6. **Index** into `knowledge_fragments` with a new source value `'documents'`, a pointer to the Drive file, and the structured metadata as JSON.

### Retrieval path

Already in place via `searchKnowledgeForPerson` and the broad-memory fetch. Claude receives the indexed entries in context and synthesises a natural answer, including the Drive link when relevant. No new retrieval infrastructure required.

### Opt-in, not on-by-default

First release:

- **Category-level opt-in.** User chooses which document types Naavi may capture: warranties, invoices, medical, etc. Each category is a separate toggle.
- **12-month historical back-fill** on opt-in, with a progress indicator ("processing 847 attachments — this may take a few hours").
- **One-tap delete from Drive**. Removing a file also deletes the fragment. No orphan memory.
- **Transparent log.** A simple screen in the mobile app showing what's been captured, from where, and when.

---

## 5. Phase split

### Phase 1 — six-week MVP

- Gmail only
- Text-layer PDFs only (no OCR yet — covers ~70% of attachments, at $0 cost)
- Three categories: invoices, warranties, receipts
- 12-month back-fill on opt-in
- Drive storage under `MyNaavi/Documents/` with three subfolders
- Index to `knowledge_fragments` with vendor + date + amount + expiry + link
- Voice retrieval works via the existing "tell me about X" path (already handles any entity)
- New privacy pillar added to `/guide` explicitly covering document capture

### Phase 2 — another 4-6 weeks

- Image OCR (Google Vision) for scanned receipts and photographed documents
- Email body extraction for the 10% of receipts/warranties that arrive without attachments
- Medical records (separate, tighter-consent opt-in)
- Cross-reference to calendar events (the invoice links to the repair visit automatically)
- Outlook / Yahoo Mail support for non-Gmail users
- Structured renewal reminders ("Your condo insurance expires in 30 days")

---

## 6. Honest caveats

1. **OCR costs real money.** Google Vision runs ~$1.50 per 1,000 pages. A user with 10 years of email + many scanned receipts could mean $20-40 of OCR per onboarding. Budget it; don't run OCR in Phase 1.
2. **Structured body parsing is the missing 10%.** Some important documents (Service Canada notices, some invoices) arrive as HTML body text without attachments. Without Phase 2 body extraction, they'll be missed.
3. **Trust is everything.** A poorly-communicated rollout — "Naavi now reads your email" — will kill adoption in this demographic. Messaging must be precise: *"Naavi captures attachments from your email so you don't lose receipts or warranties. She doesn't store email text, never reads your conversations, and never shares anything."*
4. **Compliance.** PIPEDA allows this with consent. Medical records in particular need a separate consent flow given their sensitivity. Phase 2, not Phase 1.
5. **Gmail API rate limits.** Historical back-fill over large inboxes can take hours. Build with incremental progress, resumable state, and clear status in the mobile app.
6. **Deletion semantics.** If the user deletes the original email in Gmail, what happens to the stored attachment in Drive? Recommendation: attachments in Drive persist unless the user explicitly deletes them from Drive. Two actions, two intentions.

---

## 7. Privacy messaging update (website + guide)

New pillar to add to `/guide` → "Your data is yours":

> **📎 Documents, not conversations**
> Naavi captures the attachments your life generates — invoices, warranties, receipts, tickets — so you never lose them. She doesn't store the emails themselves and doesn't read your conversations. You control which categories she captures, and deleting anything is one tap.

Also add a short section to the homepage `/scene` or adjacent showing a voice exchange:
> Robert: *"Do I have a warranty on the fridge?"*
> Naavi: *"Yes — purchased from Sears on June 3, 2024, 5-year parts and labour warranty. Expires June 2029. I have the receipt if you want me to open it."*

---

## 8. Why this is the right next thing

After conversation recording, this is the most leveraged single feature you could build. Here's the test — does it make the founder letter true in a way it isn't yet?

Today the letter says:
- *"Paying for a repair that was still under warranty from last year."* — Naavi today cannot prevent this. After attachment harvesting, she can.
- *"A recurring payment declined because the card expired."* — Naavi today cannot prevent this. After structured body extraction, she can prompt: *"Your Visa ending 6411 expires next month. Three recurring charges use it — shall I remind you to update them?"*
- *"You sometimes delete a notice from the government, the condo board, the insurance company."* — Naavi today cannot recover this. After attachment harvesting, the document is in Drive even if the email is gone.

Every line of the letter becomes a fulfilled promise rather than an empathetic diagnosis.

---

## 9. Recommendation

**Build it.** Phase 1 starts after the mobile-app voice update + morning-call verification are complete. Six weeks to an MVP that closes the single biggest gap between the letter's promise and the product's capability.

Also worth considering: whether a short demo-video of this exact interaction — *"Do I have a warranty on my brake repair?"* → Naavi answers from the invoice — becomes the hero video on the homepage. Nothing else you could show has the same emotional pay-off for the target audience.

---

*Generated April 17, 2026 as part of the Session 11 / website-pass work. Local document, not committed to git.*
