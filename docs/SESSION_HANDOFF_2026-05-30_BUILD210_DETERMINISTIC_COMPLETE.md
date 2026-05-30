# Session Handoff — 2026-05-30 | Build 210 | Next: Test 210 + Naavi Ticket System

---

## ⭐⭐⭐ NEXT SESSION PRIORITIES (START HERE)

### Priority 1 — Test Build 210 on phone
Install Build 210 from Google Play Internal Testing. Test every change in this build:

1. **Three-dot menu** — Alerts, Lists, Notes all open WebView (not native screens)
2. **Alerts web page** — shows active alerts only, delete disables (not hard-delete)
3. **Lists web page** — shows active lists, Drive link opens if available
4. **Notes web page** — shows saved memories, delete removes permanently
5. **Keyboard** — no flicker/jump when keyboard opens; chat scrolls to bottom
6. **Location alert re-arm** — say "alert me at [place with expired rule]" → Naavi re-arms it automatically, no "go to Alerts and tap Reactivate"
7. **TTS address reading** — postal codes, street abbreviations (Dr./St./Ave.), province codes (ON/QC) read correctly
8. **Deterministic Naavi** — test all 7 Level A handlers:
   - "List my alerts" → active alerts only
   - "Find [contact name]" → Google People API result
   - "Do I have a [appointment type]?" → calendar result
   - "What do we have about [name]?" → global search
   - "What lists do I have?" → active lists only
   - "What reminders do I have?" → upcoming reminders
   - "What did I tell you about [topic]?" → saved memories only
9. **Level B disclosure** — ask something Claude can't verify → "Here's my best reading…" always appears
10. **Latency** — conversational messages should be faster (fast pre-filter skips Haiku)

### Priority 2 — Build Naavi Ticket System (F6a Phase 1)

**Context:** HubSpot handles external inbound support (form submissions from mynaavi.com → auto-acknowledged → Wael replies via HubSpot). Works.

**The gap:** When a user reports an issue to Wael directly (SMS, phone call, in person), there is no formal tracking. F6a Phase 1 closes this with an internal relay workflow.

**Design (approved, ready to build — ~2 hours):**

Add a `tickets` table:
```
id, ticket_number, created_at, source_channel, user_id,
subject, body, status (new/investigating/drafted/approved/sent/closed),
linked_holding_id, draft_response, approved_by, approved_at,
sent_message_sid, audit_trail jsonb
```

Two entry points — both write to the same table:
- **External**: `ingest-ticket` Edge Function called by Formspree webhook on every mynaavi.com form submission
- **Internal**: Wael tells Naavi in chat — *"new ticket for Hussein — empty todo list this morning"* → Naavi creates the row

Downstream flow (same for both):
1. SMS notification to Wael with ticket number
2. Wael investigates → tells Naavi what to draft
3. Naavi drafts response (Claude) → Wael approves
4. Naavi sends reply to user
5. Status transitions logged to `audit_trail`

**Key rule (CLAUDE.md — no unverified claims outbound):** Every claim in the reply must trace to direct evidence. Claude drafts, Wael approves before anything is sent.

The canonical example: Hussein's 2026-05-20 incident — empty todo list. Wael relayed to Claude, Claude investigated, Wael approved, Naavi sent SMS to Hussein.

**Phases deferred (not this session):**
- Phase 2: auto-triage on ingest
- Phase 3: admin UI
- Phase 4: pattern detection

---

## Build 210 — What Shipped

### Server-side (already live — no build needed)
- **Universal gate** — every message classified Level A/B/action/chat — no message reaches Claude unclassified
- **7 Level A deterministic handlers** — LIST_RULES, LOOKUP_CONTACT, CALENDAR_SEARCH, PERSON_LOOKUP, LIST_READ, REMINDER_READ, MEMORY_SEARCH
- **Path B honest disclosure** — every Level B answer wrapped with "Here's my best reading…"
- **Step 1.4** — low-confidence yes/no resolver (PENDING_INTENT marker)
- **Step 1.5** — disambiguation pick resolver
- **Active-only filtering** — alerts and lists show enabled=true only
- **MEMORY_SEARCH** — scoped to knowledge_fragments only (not emails/calendar)
- **Latency fix** — fast pre-filter (chat/list-connection bypass Haiku) + shorter classifier prompt (~50% faster)

### Mobile (Build 210)
- **B6a** — Re-arm expired location alert automatically (commit `318e522`)
- **B6c** — Keyboard flicker/jump fix (app.json resize + KAV iOS-only)
- **B4f** — Mobile TTS address normalization (postal codes, street abbreviations, province codes)
- **Keyboard scroll** — `keyboardDidShow` listener scrolls chat to bottom on Android
- **Three-dot menu** — Alerts/Lists/Notes open WebView management pages

### Website (already live on mynaavi.com)
- `manage/alerts.html` — active alerts management
- `manage/lists.html` — lists with Drive links
- `manage/notes.html` — saved memories management

---

## Build 210 Reference

| Item | Value |
|---|---|
| Build | 210 |
| Version | V57.33.0 |
| versionCode | 210 |
| Auto-tester | 217/217 ✓ |
| AAB | building (EAS, auto-submit to Google Play Internal Testing) |
| APK | building (EAS preview profile, for Wael's phone) |

---

## HubSpot Support System — Current State

- **External inbound** ✅ — mynaavi.com forms → Formspree → HubSpot ticket → auto-ack email → Wael replies via HubSpot → email sent to user
- **B4k** — cosmetic "automation error" banner on HubSpot reply (not blocking, awaiting HubSpot support response)
- **Internal relay** ❌ — F6a Phase 1 not built. See Priority 2 above.

---

## Deterministic Naavi — Architecture Reference

Full design: `memory/project_naavi_deterministic_design.md`

Achievement against complete target: **~70-75%** (after Build 210)

Remaining gaps:
1. Level A handler coverage still partial (Gmail queries, Drive queries, more shapes)
2. TRAVEL_TIME hits Level B — needs GPS from mobile client (future AAB)
3. Voice parity — zero (dedicated session, separate codebase)
