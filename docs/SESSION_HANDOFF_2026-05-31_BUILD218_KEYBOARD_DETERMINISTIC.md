# Session Handoff — 2026-05-31 | Build 218 | Next: Test 218 + WebView Decision + HubSpot Ticket

---

## ⭐⭐⭐ NEXT SESSION — THREE PRIORITIES IN ORDER

---

### Priority 1 — Test Build 218 (Google Play Internal Testing)

Install from Google Play Internal Testing (allow 5–15 min to appear after AAB submission).

**Test checklist:**
1. **Keyboard** — tap the chat input, type — keyboard must stay open, no jump, no dismiss
2. **Three-dot menu** — Alerts → native screen, Lists → native screen, Notes → native screen
3. **Settings** — no "Advanced Settings" row anywhere
4. **Deterministic Naavi Level A** — test each handler:
   - "List my alerts" → active alerts from DB
   - "Find [contact name]" → Google People API
   - "Do I have a dentist appointment?" → live calendar
   - "What do we have about Hussein?" → global search
   - "What lists do I have?" → active lists
   - "What reminders do I have?" → upcoming reminders
   - "What did I tell you about my medication?" → saved memories only
5. **Level B disclosure** — ask something Claude can't verify → "Here's my best reading…" must appear
6. **Latency** — conversational messages should be faster than before (universal gate fast pre-filter)

Report every failure. Do not move to Priority 2 until 218 is confirmed stable.

---

### Priority 2 — WebView Decision

**Background:** This session, web management pages were built for Alerts, Lists, Notes, and Settings — then fully reverted after testing showed they didn't match the native screens and introduced regressions. Wael's decision: no WebView.

**Open question for next session:** The CLAUDE.md principle "Mobile = Conversation. Web = Management" is still a stated design rule. If Wael wants to revisit the WebView approach in the future, the web pages exist on mynaavi.com (alerts.html, lists.html, notes.html, settings.html) but are unreachable from the app. Do NOT rebuild the WebView without explicit direction from Wael.

**Current state:** Native screens for everything. No WebView anywhere in the app.

---

### Priority 3 — HubSpot Ticket System (F6a Phase 1)

**Context:**
- HubSpot handles EXTERNAL inbound support: user fills form on mynaavi.com → Formspree webhook → HubSpot ticket → auto-acknowledgment email → Wael replies via HubSpot → email sent to user. ✅ Working.
- B4k: cosmetic "automation error" banner on HubSpot reply — not blocking, awaiting HubSpot support response.

**The gap — internal relay (F6a Phase 1):**
When a user (e.g. Hussein) reports an issue directly to Wael by SMS, phone, or in person, there is no formal tracking. The design:

1. Wael tells Naavi in chat: *"New ticket for Hussein — his grocery list is empty this morning"*
2. Naavi creates a row in a `tickets` table (ticket_number, source_channel, user_id, subject, body, status)
3. Naavi sends Wael an SMS confirmation with ticket number
4. Wael investigates → tells Naavi what to draft
5. Naavi drafts the reply (Claude) → Wael approves → Naavi sends to Hussein
6. Status logged to audit_trail throughout

**Rule:** Every outbound claim must trace to direct evidence (CLAUDE.md no-unverified-claims rule). Claude drafts, Wael always approves before anything is sent.

**Scope:** ~2 hours. Server-side only, no AAB needed.

**Files to create:**
- New `tickets` table (migration)
- `ingest-ticket` Edge Function (Formspree webhook for external; Naavi chat command for internal)
- `naavi-chat` routing for "new ticket for X" command

---

## What shipped this session

### Deterministic Naavi — Universal Gate (server-side, live)
- Every message classified Level A / Level B / action / chat — no message reaches Claude unclassified
- Level A → deterministic handler → verified answer from real data, no qualifier
- Level B → Claude answers + Path B disclosure always wraps response
- 7 handlers: LIST_RULES, LOOKUP_CONTACT, CALENDAR_SEARCH, PERSON_LOOKUP, LIST_READ, REMINDER_READ, MEMORY_SEARCH
- Step 1.4 low-confidence resolver, Step 1.5 disambiguation resolver
- Fast pre-filter: obvious chat messages skip Haiku (~50% latency reduction)

### Build 218 — V57.34.0 — Keyboard Fix + WebView Revert
**Keyboard:**
- Replaced `ScrollView` with `KeyboardAwareScrollView` (`react-native-keyboard-aware-scroll-view`)
- `enableOnAndroid=true`, `keyboardShouldPersistTaps="handled"`
- Confirmed working on Wael's device (APK 217 passed)

**WebView revert:**
- `app/manage.tsx` deleted
- `app/_layout.tsx` manage screen removed
- Three-dot menu: Alerts/Lists/Notes → native screens
- Settings: "Advanced Settings →" row removed

**Also in 218:**
- B6a — re-arm expired location alert automatically
- B4f — mobile TTS address normalization
- Universal gate (Level A/B/action/chat)

---

## Lessons — do not repeat

1. **Never build without explicit approval.** WebView screens built without asking → wasted session hours + regressions.
2. **Investigate before building keyboard fixes.** 5 APK builds before finding the right solution.
3. **Auto-tester 217/217 green before every build.**

---

## Build reference

| Item | Value |
|---|---|
| Build | 218 |
| Version | V57.34.0 |
| versionCode | 218 |
| Auto-tester | 217/217 ✓ |
| Submitted | Google Play Internal Testing |
| EAS AAB | https://expo.dev/artifacts/eas/6xbLx8M8AwpNaKdJkksxDc.aab |
