# Session 17 — Complete Handoff
**Date:** Sunday, April 19, 2026
**Focus:** Global Search expansion, Email pipeline (tier-1 + LLM extraction), Morning brief rewrite, Drop-detection instrumentation, V52 mobile build

---

## Quick recap for the next session

Four big themes shipped this session:

1. **Global Search grew from 3 to 7 adapters** — added contacts (with new `phone` column), lists, calendar, and gmail (tier-1 only). All live server-side, verified end-to-end via curl.
2. **Email pipeline overhaul** — new `is_tier1` column on `gmail_messages`, Claude Haiku extracts structured actions into a new `email_actions` table on every tier-1 ingest, morning brief reads from `email_actions` instead of raw email counts. Plus a multi-user safety bug fix in the voice server (reminders + emails).
3. **GLOBAL_SEARCH voice + mobile wiring** — RULE 19 added to the shared Claude prompt, voice server speaks top 3 ranked results with source labels, mobile V52 handles the action and displays a grouped results card.
4. **Drop-detection instrumentation** — for the intermittent "call drops after greeting" bug, added Call SID logging, a 15s watchdog, and WebSocket close-code logging. Passive — captures the next real occurrence.

---

## What's live (no AAB required)

### Global Search — 7 adapters
Registry order in `supabase/functions/global-search/adapters/_registry.ts`:
1. `knowledge` (OpenAI embeddings via pgvector) — existed
2. `rules` (ILIKE over `action_rules`) — existed
3. `sent_messages` (ILIKE over new `sent_messages` table) — existed
4. **`contacts`** — NEW. ILIKE over name, email, phone. Digit normalization means "613-555-1234", "(613) 555 1234", "+16135551234" all match the same stored number.
5. **`lists`** — NEW. Matches list name + category. (Item content lives in Google Drive — future Drive adapter will cover items.)
6. **`calendar`** — NEW. Matches title, description, location, attendees (JSONB text cast).
7. **`gmail`** — NEW. ILIKE over subject/sender/snippet/body_text, filtered to `is_tier1 = true` only (no marketing).

**Test command:**
```bash
curl -s -X POST "https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/global-search" \
  -H "Authorization: Bearer sb_publishable_Aq3x_es0Eh3WJcLJOV9l9g_gt0G0gUQ" \
  -H "Content-Type: application/json" \
  -d '{"query":"dentist","user_id":"788fe85c-b6be-4506-87e8-a8736ec8e1d1"}'
```

### Email pipeline (server-side)

| Piece | File / Location |
|---|---|
| `is_tier1` column on `gmail_messages` | migration `20260419_gmail_tier1.sql` |
| Tier-1 rule in sync-gmail | `supabase/functions/sync-gmail/index.ts` — sender in contacts OR Gmail IMPORTANT OR CATEGORY_PERSONAL, AND NOT PROMOTIONS/SOCIAL/FORUMS |
| `email_actions` table | migration `20260419_email_actions.sql` |
| Claude Haiku extractor | `supabase/functions/extract-email-actions/index.ts` |
| One-off backfill utility | `supabase/functions/backfill-email-actions/index.ts` |
| Auto-extract hook on ingest | `sync-gmail` fire-and-forget POST per tier-1 email |
| Morning brief rewrite | `naavi-voice-server/src/index.js::fetchEmailActions` + `buildMorningBriefContext` |
| Deep-link brief screen rewrite | `supabase/functions/assistant-fulfillment/index.ts` |

**Wael's data snapshot (Apr 19):** 54 tier-1 of 353 total emails; 15 actionable after LLM extraction.

### Multi-user safety fixes (voice server)
- `fetchEmailActions(userId)` — prior version `fetchEmailSummary()` fetched across all users (Huss's unreads leaking into Wael's brief). Fixed.
- `fetchActiveReminders(userId)` — same bug, same fix.

**Still pending audit (similar pattern likely):** any other `fetch` to `/rest/v1/...` in the voice server without a `user_id=eq.` filter. Worth a grep next session.

### Voice-initiated send-sms / send-email now log to sent_messages
All 5 send-sms calls + send-email draft flow in `naavi-voice-server/src/index.js` now pass `user_id: userId, source: 'voice'`. Verified end-to-end — rows appear in `sent_messages` with `source='voice'` and the correct user_id. Drive transcript link also appended to the post-call ping.

### GLOBAL_SEARCH voice wiring
- `get-naavi-prompt` v5: RULE 19 added (trigger phrases: "find anything about", "search for", "what do I have on", "look up", etc.)
- Voice server executes the action inline, reads back top 3 results grouped by source ("In calendar: …. In email: …. Plus 5 more.")
- Verified on a real voice call ("Find anything about my dentist" → spoke the calendar event).

### Drop-detection instrumentation (voice server)
New log lines available for post-mortem on the intermittent "call drops after greeting" bug:
- `[Voice] Incoming call from … — CallSid: CA…` — on every inbound
- `[Voice] TwiML sent for CA…` — after response
- `[Voice] Stream connected for CA… (Xms after TwiML)` — when WebSocket connects
- `[DROP] CallSid CA… — TwiML sent but WebSocket never connected within 15s` — the signal we need
- `[MediaStream] Twilio disconnected — code: 1000, reason: …` — WebSocket close code

**Use:** next time a drop happens, search Railway logs for `[DROP]` and use the CallSid to correlate. If `[DROP]` appears but no `Stream connected`, the WebSocket never opened — likely Railway cold start or network issue between Twilio and Railway.

---

## V52 mobile build (build 94)

**Includes:**
- A: Name save fix — Settings uses `getUserNameAsync`, awaits `syncUserNameToSupabase`, shows Alert on success/failure, re-reads canonical server value. Overwrites SecureStore on successful re-fetch so stale cache from a prior Google account can't leak.
- B: Hands-free cue migration in `app/brief.tsx`, `app/calendar.tsx`, `app/contacts.tsx` — now use `speakCue()` (Deepgram aura-hera-en) to match main voice.
- C: `GLOBAL_SEARCH` action handler in `hooks/useOrchestrator.ts` — calls `global-search` Edge Function, appends top 3 to `finalSpeech` with source labels.
- D: Grouped results UI card in `app/index.tsx` — groups by source, tappable hits, shows top 3 per source with "…N more in SOURCE".
- E: `lib/supabase.ts::saveContact` now persists `phone` (contacts table has the column as of migration 20260419_contacts_phone.sql).
- Version bumped: `versionCode: 94`, settings text "MyNaavi — V52 (build 94)".

**Commit:** `2864f1a` on `main`.

**Build status at session close:** See the latest EAS build output / email notification from Expo. Upload the AAB to Google Play → Internal Testing when ready.

---

## Known bugs / architectural issues carried forward (for V53+)

| # | Item | Why deferred |
|---|---|---|
| 1 | Chat text cut-off ("Your name is Wael" spoken but only "Your name is" shown in bubble) | Logging shipped in build 93 but no reproduction yet — need data from the next occurrence. |
| 2 | Chat latency ~15s | Suspected `isBroadQuery` regex injecting huge knowledge fragments into the prompt. Server-side timing logs already in `naavi-chat`. Profile on next slow reproduction. |
| 3 | Intermittent call drops after greeting | Drop-detection instrumentation now live. Wait for next occurrence + log inspection before changing code. |
| 4 | Multi-user bug audit in voice server | Fixed reminders + emails this session. Other `/rest/v1/...` calls may have the same "no user_id filter" bug. Worth a grep. |
| 5 | **List-based trigger phrases are brittle by design** | Many rules in `get-naavi-prompt` (RULE 9, 11, 12, 18, 19) and regexes in `useOrchestrator.ts` (e.g. `isBroadQuery`) rely on exact keyword lists. One typo or word variation breaks them. RULE 19 was converted to intent-based in v6 (2026-04-19) as a starting example — the same treatment should be applied across all list-matching rules. Architectural principle: **describe intent, let Claude generalize**. |

---

## What's NOT built yet (the big next pieces)

### Email attachment OCR (the real email win for Robert)
Plan drafted this session:
- New `documents` table: `document_type, vendor, issue_date, expiration_date, amount, reference_number, file_link`
- OCR worker (Google Cloud Vision or AWS Textract) — runs on tier-1 attachments
- Documents adapter for Global Search
- Morning brief also reads documents for upcoming expirations ("Your car insurance expires in 18 days")

Cost: ~$0.01–0.03 per document. Probably 3 OCR passes per tier-1 email on average.

This is the step from "we know what's in your email body" → "we know what's in the PDF you never opened" — the biggest concrete pain point for a senior user managing institutional paperwork.

### Drive adapter (item-level search in lists)
- Current `lists` adapter only finds list names + categories.
- To find "milk" inside the grocery list, need to fetch the Drive doc content per list at search time.
- Requires per-user Google OAuth token handling — overlaps heavily with a general Drive content adapter.

### Gmail adapter for non-tier-1 emails
- Current `gmail` adapter filters to `is_tier1 = true` — intentionally narrow.
- A future secondary adapter could search the full mailbox on demand ("search all my email for X") if the tier-1 subset doesn't have it. Lower priority — promotional mail usually isn't what Robert is looking for.

---

## Critical data state (Apr 19, 2026)

| Table | Row counts (Wael, user_id `788fe85c-…`) |
|---|---|
| `gmail_messages` | 353 total, **54 tier-1** |
| `email_actions` | **15** (13 with a `due_date`) |
| `contacts` | ~15 rows; `phone` column added, populated only for NEW contacts (historical rows are phone-NULL) |
| `sent_messages` | Growing — 4+ voice-initiated rows with `source='voice'` confirmed working |

---

## Multi-user snapshot (unchanged from Session 16)

| user_id | email | phone | name |
|---|---|---|---|
| `788fe85c-b6be-4506-87e8-a8736ec8e1d1` | wael.aggan@gmail.com | +16137697957 | Wael |
| `7739bab9-bfb1-4553-b3f0-3ed223e9dee8` | test Google acct | +16138796681 | Wael |
| `381b0833-fe74-410a-8574-d0d750a03b3b` | heaggan@gmail.com | +13435750023 | Huss |

---

## Worktree / branch status

- **Main repo (`Naavi`)** — on `main` at commit `2864f1a`, clean.
- `.claude/worktrees/cranky-hoover` — **stale**, ~25 commits behind. Contains uncommitted changes that look like pre-merge duplicates of build 93 work. Safe to delete in a maintenance session.
- `.claude/worktrees/focused-agnesi` — **stale**, 26 commits behind, clean tree. Safe to delete.

CLAUDE.md updated this session to reflect "work on main by default; stale worktrees are cleanup-only".

---

## Key commits this session

| Commit | Repo / Branch | Description |
|---|---|---|
| `b8b8a2d` | voice-server/main | Log voice-initiated sends to sent_messages |
| `2f8c331` | voice-server/main | Drive link in call-recording ping |
| `5f52889` | voice-server/main | Drop-detection instrumentation |
| `26e722a` | naavi-app/main | Contacts + Lists + Calendar adapters (+ contacts phone column) |
| `c9ed43e` | naavi-app/main | Email pipeline: tier-1, extract-email-actions, morning brief rewrite, gmail adapter |
| `d9ceff3` | voice-server/main | Morning brief from email_actions + multi-user email fix |
| `a8abfbb` | voice-server/main | Multi-user fix for reminders |
| `3ec3382` | naavi-app/main | get-naavi-prompt v5: RULE 19 GLOBAL_SEARCH |
| `2f2fc32` | voice-server/main | Voice server GLOBAL_SEARCH handler |
| `2864f1a` | naavi-app/main | build 94 (V52) — mobile side of GLOBAL_SEARCH + name fix + cloud TTS + phone save |

---

## Commands cheat sheet

```bash
# Deploy any of the new Edge Functions
npx supabase functions deploy global-search --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx
npx supabase functions deploy extract-email-actions --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx
npx supabase functions deploy backfill-email-actions --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx
npx supabase functions deploy sync-gmail --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx
npx supabase functions deploy assistant-fulfillment --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx
npx supabase functions deploy get-naavi-prompt --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx

# Re-run backfill for any user
curl -s -X POST "https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/backfill-email-actions" \
  -H "Authorization: Bearer sb_publishable_Aq3x_es0Eh3WJcLJOV9l9g_gt0G0gUQ" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<uuid>"}'

# V52 build workflow (already run this session)
cd C:/Users/waela/naavi-mobile
git fetch origin && git merge origin/main
npm install
npx eas build --platform android --profile production --non-interactive
```

---

## Session style notes for next-session Claude

- Wael is non-technical. Keep answers short. One step at a time.
- No action without explicit approval ("go" / "yes" / "ok" / "agree" / specific affirmative).
- Full URLs when asking the user to navigate. No jargon without a plain-English gloss.
- Investigate before assuming. Trace the full chain before changing code.
- Work on main — no active feature worktree this session or last. Stale ones in `.claude/worktrees/` can be ignored.
- Never `cp -f` between repo clones. Always `git merge origin/main` in the build clone.
- Voice server is production critical. The tick/music during silent gaps is a hard UX requirement for Robert. Never remove audio-fill without replacing.
