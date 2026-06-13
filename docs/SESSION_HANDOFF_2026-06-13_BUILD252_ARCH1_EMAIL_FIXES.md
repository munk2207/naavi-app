# Session Handoff — 2026-06-13 — Build 252 — ARCH-1 Email Fixes

## Build shipped
- **Build 252** — V57.52.0 — production AAB auto-submitted to Google Play ✅
- Firebase Test Lab: PASSED (Pixel 6 + Samsung Galaxy S22) ✅
- auto-tester: 273/273 green ✅

---

## What was fixed this session

### ARCH-1 — GMAIL_SEARCH handler (all server-side, no AAB)

**Bug: "did I get new emails" returned Level B hedge ("I can't verify")**
- Root cause: empty-string keyword `""` is falsy — `&& classification.params.keyword` failed → fell to Claude Level B
- Fix: `&& classification.params.keyword !== undefined` in `naavi-chat/index.ts`

**Bug: email alert never fired**
- Root cause 1: null `sender_name` / `sender_email` in `gmail_messages` threw TypeError inside `findEmailTriggers`, silently crashing the filter
- Fix: null guards (`?? ''`) in `evaluate-rules/index.ts`
- Root cause 2: ARCH-1 alerts have `action_config: {}` (no body field) — `buildAlertBody` returned `""` — `fireAction` hit `if (!body) return false`
- Fix: generate default body from `trigger_config` at fire time in `evaluate-rules/index.ts`

**Bug: email address stored in `from_name` instead of `from_email`**
- Root cause: `useOrchestrator.ts` always wrote the `from` value to `from_name`, even when it contained `@`
- Fix: `@` detection routes to `from_email`, plain name routes to `from_name`

**Bug: global search results appeared alongside alert confirm bubble**
- Root cause: `hasAtSign = /@/.test(userMessage)` triggered on the email address in the alert creation message, firing a pre-search
- Fix: `isEmailAlertCreation` regex exclusion in `useOrchestrator.ts`

### Trash email cleanup (server-side, ongoing issue)
- Emails deleted by user (moved to Gmail Trash) were re-appearing in "check my new emails"
- Root cause confirmed via DB query: trashed emails were being re-inserted on every sync because Gmail's `category:updates` query returns recently trashed emails
- Fixes applied (multiple iterations):
  - Added `-in:trash` to Gmail fetch query in `sync-gmail`
  - Added inline trash cleanup in `handleGmailSearch` using refresh_token → access_token exchange
  - Added trash cleanup pass in `sync-gmail` after main sync loop
- **Status: OPEN** — issue persisted through all fix attempts this session. Wael closed testing and will report as a bug if it recurs. B-level bug to track separately if needed.

### Holding list updates
- **B2m** added — parity audit reference (7 open mobile/voice gaps) pointing to `docs/MOBILE_VS_VOICE_PARITY_AUDIT_2026-06-12.md`
- **ARCH-1** description updated — GMAIL_SEARCH marked shipped, build 252 fixes recorded

---

## ARCH-1 shipped handlers (as of build 252)

| Handler | Status |
|---|---|
| LIST_READ | ✅ Shipped |
| REMINDER_READ | ✅ Shipped |
| MEMORY_SEARCH | ✅ Shipped |
| PERSON_LOOKUP | ✅ Shipped |
| CREATE_TICKET | ✅ Shipped |
| GMAIL_SEARCH | ✅ Shipped (this session) |

---

## ⭐ NEXT SESSION PRIORITY — ARCH-1 CONTINUATION

**Start here.** ARCH-1 is the highest-value next session. The infrastructure is complete — classification, routing, handler pattern all exist. Only the intent taxonomy and remaining handlers need to be built.

**Remaining work (~3-4 hours):**
1. Define the complete Level A intent taxonomy — all intents that should never touch Claude
2. Build deterministic handlers for:
   - `SET_REMINDER` — write to `reminders` table directly
   - `CREATE_EVENT` — call `create-calendar-event` Edge Function
   - `DRAFT_MESSAGE` — route to send-sms / send-email directly
   - `READ_CALENDAR` — query `calendar_events` table directly
   - `FETCH_TRAVEL_TIME` — call travel-time Edge Function directly
   - Any other high-frequency intents identified during taxonomy session
3. T3c (voice automated regression suite) — build AFTER taxonomy is complete

**Why ARCH-1 before B2m:** every new deterministic handler eliminates Claude-hedging for an entire class of queries — affects every user on every request. B2m gaps are voice-side polish affecting users who switch surfaces for specific actions. B2m high-priority gap (re-arm expired location alert) can be added as a quick add-on at the end of an ARCH-1 session.

**Do NOT start ARCH-1 during a pre-AAB build session** — it needs a dedicated focused block.

---

## Files changed this session

- `supabase/functions/naavi-chat/index.ts` — keyword !== undefined fix
- `supabase/functions/naavi-chat/intentHandlers.ts` — trash cleanup + TRASH label query filter
- `supabase/functions/evaluate-rules/index.ts` — null safety + body fallback
- `supabase/functions/sync-gmail/index.ts` — -in:trash query + trash cleanup pass
- `hooks/useOrchestrator.ts` — from_email routing + isEmailAlertCreation exclusion
- `app.json` — versionCode 252
- `app/settings.tsx` — V57.52.0 (build 252)
- `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` — B2m added, ARCH-1 updated
