# Session 16 — Complete Handoff
**Date:** Sunday, April 19, 2026
**Focus:** Build 93 (V51) + Supabase legacy JWT rotation + Global Search scaffold

---

## Quick recap for the next session

Three big things shipped today:

1. **Mobile build 93 (V51)** — new AAB live on Google Play Internal Testing, installed + verified on Wael's phone.
2. **Supabase publishable-key migration** — leaked legacy anon JWT is permanently disabled. App now uses `sb_publishable_Aq3x_es0Eh3WJcLJOV9l9g_gt0G0gUQ`.
3. **Global Search** — new plug-in adapter architecture deployed as `global-search` Edge Function, with three working adapters (knowledge, rules, sent_messages). Not yet wired into mobile or voice surface — that's next-build work.

---

## Build 93 — What changed (mobile)

| Area | Change | File |
|------|--------|------|
| Settings | Added "Your Phone Number" field with E.164 validation + multi-user-safe load | `app/settings.tsx` |
| Settings | Version text bumped to "MyNaavi — V51 (build 93)" | `app/settings.tsx` |
| Hands-free | `speakCueRef` now calls cloud TTS (Deepgram aura-hera-en) so cues match main voice | `app/index.tsx` + new `lib/tts.ts` |
| Diagnostics | Logging added for chat text cut-off bug investigation (raw Claude response, parsed speech, display vs TTS) | `lib/naavi-client.ts` + `hooks/useOrchestrator.ts` |
| Server | Timing logs added to `naavi-chat` EF (per-phase ms) | `supabase/functions/naavi-chat/index.ts` |
| Config | `versionCode: 93` in app.json | `app.json` |

**Commit:** `ba5bf2d` on `main` (Build 93 commit). `b2f5261` = package-lock refresh from build clone.

**Verified on phone:** sign-in, chat, phone field save/load, SCHEDULE_MEDICATION (10 calendar events), hands-free cue voice match, voice call recognition, REMEMBER + recall. Everything green.

---

## Supabase key rotation

**What happened:** Legacy anon JWT was embedded in three old migration SQL files (`20260402_reminders_cron.sql`, `20260407_evaluate_rules_cron.sql`, `20260415_morning_call_cron.sql`) — permanently leaked in git history.

**Resolution:**
- App now uses new Supabase **publishable key**: `sb_publishable_Aq3x_es0Eh3WJcLJOV9l9g_gt0G0gUQ`
- Key was swapped in:
  - Local `.env.local` (main repo + `C:\Users\waela\naavi-mobile` build clone)
  - **EAS cloud env var** `EXPO_PUBLIC_SUPABASE_ANON_KEY` on project `@waggan/naavi` (critical — first build of 93 was discarded because EAS still had the old key; second build is what shipped)
- On Supabase dashboard → API Keys → "Legacy anon, service_role API keys" tab → **"Disable JWT-based API keys"** button was clicked. The leaked JWT is now permanently invalid.

---

## Global Search — what's deployed

### Architecture
Plug-in adapter pattern. Each data source implements the same `SearchAdapter` interface. To add a new source: write one file, register it in `_registry.ts`, deploy. Handler code never changes.

### Files on `main` (commit `4b014fe`)

```
supabase/functions/global-search/
├── index.ts                     ← main handler (user resolution, Promise.all, rank, group)
└── adapters/
    ├── _interface.ts            ← SearchAdapter + SearchResult + PrivacyTag types
    ├── _registry.ts             ← single source of truth listing active adapters
    ├── knowledge.ts             ← OpenAI embedding + pgvector RPC
    ├── rules.ts                 ← ILIKE over action_rules
    └── sent_messages.ts         ← ILIKE with pg_trgm over new sent_messages table

supabase/migrations/
└── 20260419_sent_messages.sql   ← new table, indexes, RLS
```

### New table: `sent_messages`
Append-only audit log of every SMS / WhatsApp / email Naavi sends on behalf of a user. Columns: `id`, `user_id`, `channel`, `to_name`, `to_phone`, `to_email`, `subject`, `body`, `sent_at`, `delivery_status`, `provider_sid`, `source`, `metadata`, `created_at`. RLS: users see only their own; service role can insert via Edge Functions.

### Write path (live)
- `supabase/functions/send-sms/index.ts` — logs after successful Twilio send. Now accepts `user_id` + `source` in body so voice/cron callers can attribute.
- `supabase/functions/send-email/index.ts` — logs after successful Gmail send. Uses JWT-derived `user.id`.

### Test results
```
POST /functions/v1/global-search
Body: { query: "dentist", user_id: "<uuid>" }
→ groups: { knowledge: 2 hits, rules: 0, sent_messages: 0 }, ranked: [...]
Latency: ~1.3–1.7 s (dominated by OpenAI embedding for knowledge)
```

### Not yet wired
- **Voice server** (`naavi-voice-server/src/index.js`): still calls `send-sms` WITHOUT `user_id` in body. Voice-initiated sends don't log to sent_messages. Fix = add `user_id: userId, source: 'voice'` to all 4 send-sms fetch bodies in that file, commit + push (Railway auto-deploys). See line 2023 / 2028 / 2242 / 2249.
- **Mobile app**: no `GLOBAL_SEARCH` action in Claude's prompt yet, no handler in `useOrchestrator.ts`, no UI component to display grouped results. Requires a new AAB to ship.
- **Claude prompt**: no rule added to `get-naavi-prompt` EF telling Claude to emit `GLOBAL_SEARCH` for "find anything about X" queries.

---

## Known bugs carried forward (queued for next mobile build)

### 0. Your Name save/display on Android (pre-existing, exposed during Session 16 testing)
**Symptom:** User types a name in Settings → taps Save name → no "Saved" alert → on reload the field is empty → chat responses use cached "Robert" from SecureStore instead of the current name.
**Root causes:**
- `app/settings.tsx` Save name button has no `Alert.alert`.
- `lib/naavi-client.ts` exports `getUserName()` (sync) which hard-codes `return ''` on native. Settings calls that, not the async helper `getUserNameAsync()`.
- `saveUserName()` syncs to Supabase fire-and-forget; failures are silent.
- Cached SecureStore can shadow a fresh DB value when the DB read fails.

**Fix for next build:**
1. In `app/settings.tsx` useEffect, replace `getUserName()` with `await getUserNameAsync()` inside an async IIFE.
2. On Save name tap, `await syncUserNameToSupabase(name)`, then `Alert.alert('Saved', ...)`.
3. After a successful sync, re-fetch `user_settings.name` and `setUserName(fresh)` so display matches server truth.
4. Overwrite SecureStore on every sign-in so a stale cached value from a prior Google account can't leak into the new session.

**Band-aid applied today:** directly `UPDATE user_settings SET name='Wael' WHERE user_id='7739bab9...'` via SQL editor. Did NOT fix the symptom on device — the mobile client is still reading cached Robert. Real fix requires the build changes above.

### 1. Chat text cut off
Voice spoke "Your name is Wael" but bubble only showed "Your name is". Logging shipped in build 93 — next reproduction will capture raw Claude response + parsed speech to pinpoint.

### 2. Chat latency ~15 s
Same suspected root cause (`isBroadQuery` regex triggers huge knowledge fragment injection). Server-side timing logs now live in `naavi-chat` EF. Check Supabase logs next time latency reproduces.

### 3. Hands-free cue in deep-link screens
`app/brief.tsx`, `app/contacts.tsx`, `app/calendar.tsx` still use `expo-speech` for screen readers. Build 93 migrated only the main `speakCueRef`. Migrate the rest in a future build if voice consistency in deep-link screens matters.

---

## Multi-user state snapshot

| user_id | email | phone | name (user_settings) |
|---------|-------|-------|----------------------|
| `788fe85c-b6be-4506-87e8-a8736ec8e1d1` | wael.aggan@gmail.com | +16137697957 | Wael |
| `7739bab9-bfb1-4553-b3f0-3ed223e9dee8` | (test Google acct used for build 93 verification) | +16138796681 | Wael (from band-aid UPDATE) |
| `381b0833-fe74-410a-8574-d0d750a03b3b` | heaggan@gmail.com | +13435750023 | Huss |

Note the second row (7739bab9) was created when Wael signed in with a different Google account during build 93 testing — that's why the phone he saved (`+16138796681`) landed on a separate user_settings row from his canonical account.

---

## Next session — priority order

1. **Voice server update** — small change in `naavi-voice-server/src/index.js`, pass `user_id: userId, source: 'voice'` in send-sms bodies at lines ~2023, 2028, 2242, 2249. Commit, push to `munk2207/naavi-voice-server`, Railway auto-deploys. No AAB change.
2. **More adapters** — contacts, lists, calendar in that order. Simple ILIKE on Supabase tables; ~20–30 lines each. Follow the `rules.ts` pattern.
3. **Claude prompt rule for GLOBAL_SEARCH** — add to `supabase/functions/get-naavi-prompt/index.ts` with trigger phrases ("find anything about", "search for", "what do I have on"). Deploy. Does NOT require a build — voice server picks it up immediately.
4. **Next mobile build (V52 / build 94)** — bundle:
   - Name save fix (#0 above)
   - `GLOBAL_SEARCH` action handler in `useOrchestrator.ts`
   - Mobile UI component for grouped search results
   - Voice: read top 2–3 results; App: full list with source icons + tap-to-open
5. **External adapters (later):** gmail, drive — need to reuse the stored Google refresh token from `user_tokens`, call Gmail / Drive API from the adapter. Higher effort than Supabase-table adapters.

---

## Commands / URLs cheat sheet

```bash
# Deploy global-search EF
npx supabase functions deploy global-search --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx

# Test global-search live
curl -s -X POST "https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/global-search" \
  -H "Authorization: Bearer sb_publishable_Aq3x_es0Eh3WJcLJOV9l9g_gt0G0gUQ" \
  -H "Content-Type: application/json" \
  -d '{"query":"dentist","user_id":"7739bab9-bfb1-4553-b3f0-3ed223e9dee8"}'

# Build + ship V52
# 1. Edit on main, commit, push
# 2. cd C:/Users/waela/naavi-mobile && git fetch origin && git merge origin/main
# 3. npm install
# 4. npx eas build --platform android --profile production --non-interactive
# 5. Upload AAB to Google Play → Internal Testing
```

- Supabase SQL editor: https://supabase.com/dashboard/project/hhgyppbxgmjrwdpdubcx/sql/new
- Supabase EF dashboard: https://supabase.com/dashboard/project/hhgyppbxgmjrwdpdubcx/functions
- EAS env: `cd C:/Users/waela/naavi-mobile && npx eas env:list production`
- Google Play Console: https://play.google.com/console
- Railway (voice server): https://railway.app/

---

## Key commits this session

| Commit | Branch | Description |
|--------|--------|-------------|
| `ba5bf2d` | main | build 93 (V51): phone field, hands-free voice match, diagnostics |
| `b2f5261` | main | build 93: npm install refresh of package-lock.json |
| `4b014fe` | main | Global Search: scaffold + knowledge/rules/sent_messages adapters |

All pushed to `munk2207/naavi-app`.

---

## Session style notes for next-session Claude

- Wael is non-technical. Keep answers short. One step at a time.
- No action without explicit approval. "go ahead" / "yes" / "do it" = proceed. "agree" on a question = proceed. Silence or ambiguity = confirm first.
- Full URLs when asking the user to navigate anywhere. No jargon.
- When the user reports a bug, investigate the actual code before assuming. No trial-and-error — trace the full chain before changing anything.
- Active worktrees exist under `.claude/worktrees/` but main repo worked cleanly this session. Check `git worktree list` only if actively using a worktree.
- Never `cp -f` between clones. Always `git merge origin/main` in the build clone.
