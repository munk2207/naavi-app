# Session Handoff — 2026-06-19
## F8a + F8b: SMS Ticket Flow + Inbound Reply Loop
**Branch:** main | **Commit:** 690b362 | **Tests:** 350/350 green

---

## ⭐⭐⭐ TOP PRIORITY NEXT SESSION — F8c (requires AAB)

**OAuth scope verification + auto-retry on missing scopes.**

**Problem:** Google's "granular permissions" feature allows users to uncheck individual OAuth scopes during sign-in. When a scope is missed, features silently fail (Calendar, Contacts, Gmail, Drive stop working). The customer never sees an error — things just don't work. Discovered this session via `mynaavi2207@gmail.com` account behavior.

**Solution (designed, not yet built):**
1. After OAuth completes, silently test each required scope with a lightweight API call
2. If any return 401 → automatically re-trigger OAuth for the missing scopes only
3. Customer sees a second Allow screen pop up automatically — one tap, no diagnosis needed

**Files to edit:** `lib/calendar.ts` + `lib/supabase.ts` (mobile only → needs AAB)
**Holding list:** F8c

---

## What Was Shipped This Session

### F8a — Complete
- **T3c voice regression suite** — 6 automated voice tests via `/test/ask` endpoint
- **isTestTicket guard** in `ingest-ticket` — suppresses email/SMS for `firebase-testlab@mynaavi.com`, `*.example.com`, `TICKET-TEST-` subjects
- **deleteTestTickets fix** — URL encoding bug fixed (`encodeURIComponent(SMOKE_PREFIX + '%')`)
- **source_channel** shown in staff portal list + detail views (`voice-call` badge)
- **SMS outbound reply** — `send-ticket-reply` sends full SMS to `reporter_phone` for `voice-call` tickets
- **Email inbound reply loop** — `receive-ticket-reply` Edge Function parses Postmark inbound webhook, matches ticket by number in subject, verifies sender, strips quoted text, appends to thread, resets status to `new`
- **ReplyTo fixed** — was hardcoded `wael.aggan@gmail.com`, now `0711007d25ae18da311a4386f94e5744@inbound.postmarkapp.com`

### F8b — Partial (one gap remains)
- **`receive-sms-reply`** Edge Function — Twilio inbound webhook → finds most recent open ticket by `reporter_phone` → appends reply to thread → resets status to `new`
- **Close detection** — SMS body containing "close" sets ticket status to `closed`
- **internal-relay SMS** — `send-ticket-reply` now fires SMS for both `voice-call` AND `internal-relay` channels
- **Twilio configured** — `+1 249 523 5394` messaging webhook set to `receive-sms-reply`
- **SMS indicator** in staff portal thread — "📱 SMS also sent to +1XXXXXXXXXX" shown on outbound replies

**Remaining gap (F8b):** Staff portal channel selector — staff should be able to choose email vs SMS per ticket rather than auto-determined by source_channel.

---

## End-to-End Flow (verified working)

1. Robert calls Naavi voice line → says "I need help" → 3-turn bypass → ticket created
2. Robert receives SMS confirmation + email acknowledgment automatically
3. Staff sees ticket in portal with `voice-call` badge
4. Staff sends reply from portal → Robert receives email + SMS simultaneously
5. Robert replies to SMS → appears in ticket thread as inbound message
6. Robert texts "close" → ticket status set to `closed`
7. Robert replies to email → appears in ticket thread as inbound message (Postmark inbound)

---

## Infrastructure Configured This Session

| Item | Value |
|------|-------|
| Postmark inbound address | `0711007d25ae18da311a4386f94e5744@inbound.postmarkapp.com` |
| Postmark inbound webhook | `https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/receive-ticket-reply` |
| Twilio messaging webhook | `https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/receive-sms-reply` |
| Twilio number | `+1 249 523 5394` |

---

## Open Items After This Session

| ID | Description | Priority |
|----|-------------|----------|
| **F8c** | **OAuth scope verification + auto-retry — AAB required** | **⭐ TOP** |
| F8b | Staff portal channel selector | Medium |
| F2b | Demo line maturity | Low |
| F5b | Self-cleansing memory on voice | Low |

---

## Test Baseline
- **350/350 green** — no failures, no skips
- New tests added: `session-2026-06-19.ts` — 10 tests covering F8a + F8b
- Run: `npm run test:auto` from `C:\Users\waela\OneDrive\Desktop\Naavi`
