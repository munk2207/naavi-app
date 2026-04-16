# Session 9 — Complete Handoff Record (April 16, 2026)

**Purpose:** Single source of truth if this session hangs or ends. Designed so a new Claude can pick up with zero context loss.

---

## 0. If you are the next Claude — read in this order

1. **This file end-to-end.**
2. `CLAUDE.md` at project root (`C:\Users\waela\OneDrive\Desktop\Naavi\CLAUDE.md`) — absolute rules for the codebase.
3. Memory index: `C:\Users\waela\.claude\projects\C--Users-waela-OneDrive-Desktop-Naavi\memory\MEMORY.md`
4. Relevant memory files (minimum set):
   - `project_naavi_voice_recording.md` (session 9 voice work summary)
   - `project_naavi_active_bugs.md` (open issues, START HERE entry)
   - `project_naavi_overview.md` (core concept + architecture)
   - `project_naavi_folder_structure.md` (3-repo topology)
   - `user_profile.md` (user background)
5. **Feedback files** (user's working-style rules — obey these):
   - `feedback_no_action_without_approval.md` ← ABSOLUTE RULE
   - `feedback_command_style.md` ← Keep it SHORT
   - `feedback_no_trial_error.md` ← Trace before changing code
   - `feedback_follow_through.md` ← Do what the user asked
   - `feedback_wait_for_done.md` ← Wait for "done" signal
   - `feedback_stop_assuming.md` ← Check the code, not memory
   - `feedback_check_code_not_memory.md` ← When asked "is X built?", grep
   - `feedback_stability_over_cost.md`
   - `feedback_working_together.md`
   - `feedback_version_log.md`
6. `docs/SESSION_9_VOICE_RECORDING.md` — earlier summary of voice feature (subset of this doc; this doc supersedes).

---

## 1. Working style — reinforce in responses

- **No action without explicit user approval.** Not even "small" edits.
- **Keep responses SHORT.** One step at a time. No technical walkthroughs unless asked.
- **Never assume.** When user asks "is X built?" — grep the code. When asked "did X work?" — check logs.
- **No trial-and-error.** Trace the full chain before changing anything. Fix server before client.
- **Wait for "done" before next instruction.** Do not jump ahead.
- **Follow through on what user confirmed.** Don't fall back to old defaults.
- **Stability > cost.** Never recommend cheapest option.
- **Non-technical founder** — explain in plain language. Avoid jargon.
- **Windows/PowerShell** environment — quote paths correctly.
- **GitHub username:** `munk2207`.

---

## 2. Project topology (3 repos, 3 surfaces)

| Surface | Path | Repo | Deploy target |
|---|---|---|---|
| Mobile | `C:\Users\waela\OneDrive\Desktop\Naavi\` | `munk2207/naavi-app` (main) | Expo EAS → Google Play Internal Testing |
| Web | Same repo as mobile | same | Vercel auto-deploy on push to `main` → `naavi-app.vercel.app` and `mynaavi.com` |
| Voice | `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server\` | `munk2207/naavi-voice-server` | Railway auto-deploy on push |
| Supabase EFs | `supabase/functions/*` inside main repo | part of main repo | `npx supabase functions deploy <name>` |
| Marketing site | `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website\` | separate (check git remote) | Vercel `mynaavi.com` |

**Active worktree:** `.claude/worktrees/cranky-hoover` on branch `claude/cranky-hoover`. **BUT** changes in this session were made directly on `main` in the main checkout, NOT in the worktree. The worktree is stale relative to main.

---

## 3. Session 9 — full chronology (not only voice recording)

### 3a. Multi-user safety (earlier in session)
- **Commit `10c9318` V50 build 91** (before session start): multi-user foundation
- **Commit `4ee8641`:** Fixed user_id fallback in 5 EFs (was using gmail_messages, now user_tokens)
- **Commit `87efb6e` (voice server):** Added SET_EMAIL_ALERT + SET_ACTION_RULE handlers
- **Commit `0dd11a9` (voice server):** Passed user_id to lookup-contact; removed hardcoded phone `+16137697957` and `+13435750023` defaults
- **Commit `18d67bc`:** Post-sanity followups — multi-user fixes + orphan fn recovery

### 3b. Configuration cleanup (earlier)
- **Commit `066bc71`:** Rule system consolidated (`email_watch_rules` → `action_rules`); prompts unified
- **Commit `95bbd38`:** Added `get-naavi-prompt` shared EF (single source of truth for Claude prompt)
- **Commit `c1f746c` (voice server):** Voice server fetches shared prompt at every message

### 3c. Web app blank-page fix
- **Commit `13243ba`:** Web-safe guard for `@mykin-ai/expo-audio-stream` native module (was throwing on web load). Fix: Platform.OS === 'web' check with no-op stub in `hooks/useHandsfreeMode.ts`.
- **Commit `813c4fe`:** P1 drift fixes — push-notification payload + native-imports guard (`scripts/check-native-imports.js`).

### 3d. HubSpot waitlist → Supabase
- **Commit `fd20705`:** Added `join-waitlist` Edge Function (validates email, inserts into `waitlist_signups` table, returns `{success: true, already: true}` for duplicates).
- **Commit `0034799`:** Updated smoke test to replace HubSpot checks with new waitlist form checks.
- Marketing site (`mynaavi-website/index.html`) — replaced HubSpot iframe with custom form POSTing to `/functions/v1/join-waitlist`.

### 3e. Blog + SEO audit
- Added `blog.html` + 3 article pages (retrieval-not-storage, orchestration-not-automation, aging-in-place-gap) to `mynaavi-website/`.
- Added canonicals (apex `mynaavi.com`, not www), OG tags, Twitter Cards, Article/Blog/Organization JSON-LD.
- Wired `shared.js` to blog pages so header/footer matches rest of site (shared.js added Blog link to `.nav-right` and footer).
- `sitemap.xml` updated with 4 blog URLs, lastmod `2026-04-16`, apex domain.
- `robots.txt` created (allow all, disallow `/cdn-cgi/`, sitemap location).
- DNS: Cloudflare proxied for apex `mynaavi.com`; www has broken cert (direct to Vercel).

### 3f. Smoke test + test plan
- **Commits `f258ec9`, `972e36e`:** Added `scripts/smoke-test.js` (~440 lines, 28-29 checks). Persists results to `docs/smoke-test-results/{latest.log, <ts>.log, history.csv}`.
- **Commits `87647ca`, `e7b85b5`:** Added `docs/TEST_PLAN.md` + `TEST_PLAN.docx` generator script.

### 3g. V50 build 92
- **Commit `cc51197`:** versionCode bump 91 → 92.
- AAB built via EAS: `https://expo.dev/artifacts/eas/316VJ7ghXZCLDWdG7sfrAm.aab`
- **Not yet installed on phone** — user confirmed V50 build 91 is on phone (screenshot).

### 3h. Voice call recording (final chunk of session)
- **Commit `634813a`:** Added RULE 18 (START_CALL_RECORDING) to `get-naavi-prompt`; new `send-user-email` EF; registered in `config.toml`.
- **Commit `a2e7a52` (voice server):** Full infrastructure — Twilio REST helpers, `/recording-complete` webhook, `processCallRecording()` orchestrator, silent-mode state machine. +433 lines.
- **Commit `5432edd`:** Fixed RULE 9 vs RULE 18 conflict (both matched "record" word).
- **Commit `83094d1` (voice server):** Direct trigger detection in voice server (bypass Claude) when Claude kept misinterpreting.
- **Commit `636c18b` (voice server):** Generous regex for natural phrasing ("record it", "record now", "can you record my visit", etc.).
- **Commit `15f5268` (voice server):** `awaitingRecordingStart` flag suppresses Deepgram TTS echo; idle timer never fires during recording.
- **Commit `70f0eb8`:** `send-user-email` falls back to `auth.users.email` if `user_settings.email` is empty.
- **Commit `739a8ce` (voice server):** Log each extracted action + email result; widen `calendarTypes` to task/reminder/email.
- **Commit `e28006d`:** Committed this session's first handoff doc (`docs/SESSION_9_VOICE_RECORDING.md`).

---

## 4. Voice recording feature — deep dive

### 4.1 Architecture flow
```
User on Twilio call
  ↓ says "record my visit"
Deepgram STT → voice server processUserMessage
  ↓ matches recordingTrigger regex (bypass Claude)
awaitingRecordingStart = true (suppresses Deepgram echo)
  ↓ Naavi plays: "Okay, recording now. Put me on speaker..."
setTimeout 3.5s
  ↓ enterRecordingMode()
POST https://api.twilio.com/.../Recordings.json (dual-channel, callback=/recording-complete)
isRecording = true, recordingSid saved, activeRecordings.set(callSid, {userId, userName, callerPhone})
stopMusic(), clear idleTimer, set 60-min safety timer
  ↓ silent mode: Deepgram swallows everything except stop phrase
User speaks their visit
  ↓ says "Naavi stop" (or hangs up, or 60 min passes)
exitRecordingMode → POST Twilio stop API → "Got it. I'll send the summary shortly."
  ↓ Twilio stops recording, 10-30s later fires webhook
POST /recording-complete (CallSid, RecordingUrl, RecordingDuration, RecordingStatus=completed)
  ↓ voice server returns 200 immediately, processCallRecording runs async
Download MP3 from recordingUrl.mp3 (Basic Auth: TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN)
  ↓ base64 encode
POST /functions/v1/upload-conversation → AssemblyAI transcript_id
  ↓ poll every 5s, up to 15 min
POST /functions/v1/poll-conversation → utterances + speakers
  ↓ speakerNames defaulted: {A: userName, B: "Them", C: "Speaker C", ...}
POST /functions/v1/extract-actions (utterances, speakerNames) → Claude returns actions[]
  ↓ loop actions where type in calendarTypes set
POST /functions/v1/create-calendar-event for each (dedup by title, default tomorrow 9am if no time)
  ↓ build doc with TRANSCRIPT + ACTION ITEMS + CALENDAR EVENTS CREATED
POST /functions/v1/save-to-drive (title, content, user_id)
  ↓ driveLink = webViewLink
POST /functions/v1/send-user-email (user_id, subject, body+driveLink)
POST /functions/v1/send-sms (to=callerPhone, channel=sms, "summary ready")
POST /functions/v1/send-sms (to=callerPhone, channel=whatsapp, same msg)
POST /functions/v1/send-push-notification (user_id, title, body)
```

### 4.2 Trigger regex (in `naavi-voice-server/src/index.js` processUserMessage)
```js
const recordingTrigger = /\brecord\s+(my|the|this|our)(?!\s+(?:note|reminder|text|that|down|as|in|to|on))\b|\bstart\s+(?:the\s+)?recording\b|\brecord\s+(?:it|now)\b|\brecord\s+(?:a\s+|an\s+)?(?:visit|conversation|meeting|appointment|doctor|call|session|talk|chat|discussion|phone\s+call)\b/i;
```
**Matches:** record my visit/meeting/conversation; record the/this/our X; start recording; record it; record now; record a conversation; can you record my visit; please record.
**Blocks:** record this down; record a note; record that in my notes.

### 4.3 Stop regex
```js
const stopPhrase = /\b(na+h?v+ee?|naavi|navi)\b.{0,25}\b(stop|end|done|finish)\b|\b(stop|end|finish)\b.{0,15}\b(record|recording)\b/i;
```
Matches "Naavi stop", "Nahvee end recording", "stop recording Nahvee".

### 4.4 Key state variables (per-connection)
- `isRecording` — true while Twilio recording is active
- `recordingSid` — Twilio RecordingSid for stop API
- `recordingAutoStopTimer` — 60-min setTimeout handle
- `awaitingRecordingStart` — true between trigger and actual Twilio start (3.5s window). Suppresses Deepgram echo.

### 4.5 Module-level state
- `activeRecordings = new Map()` — keyed by CallSid → `{userId, userName, callerPhone, startedAt}`. Populated on enterRecordingMode; consumed+deleted by /recording-complete handler.

### 4.6 Calendar types included (widened in commit 739a8ce)
```js
const calendarTypes = new Set(['appointment', 'meeting', 'call', 'test', 'prescription', 'follow_up', 'task', 'reminder', 'email']);
```

---

## 5. Test evidence (what actually happened)

### 5.1 First real test (14:00:50) — FAILED
User said: "record my visit"
Naavi replied: "I need more details about the visit to record it properly. Where did you visit and when?"
**Cause:** RULE 9 (SAVE_TO_DRIVE) matched "record" word before RULE 18 fired. Claude asked for content to save.
**Fix:** Commit `5432edd` — disambiguation; plus commit `83094d1` bypassing Claude entirely.

### 5.2 Second test (14:08:50) — WORKED END-TO-END
User said: "record my visit" — detected by regex → confirmation TTS → recording started at 14:01:47
Recorded 71 seconds, then user said "Naavi stop" (or hung up)
Twilio webhook fired at 14:09:04 with `RecordingStatus=completed, duration=71s`.

Orchestrator log trace:
```
14:09:04 Processing for user 788fe85c-b6be-4506-87e8-a8736ec8e1d1 (Wael), duration 71s
14:09:06 Downloaded 567797 bytes of audio
14:09:07 AssemblyAI transcript 8ae74495-... queued
14:09:13 Poll 0: status=processing
14:09:19 Transcription complete — 9 utterances, 2 speakers
14:09:39 Extracted 4 action items
14:09:39 Drive saved: null
14:09:39 DONE — user=788fe85c-..., actions=4, events=0
```

Results actually received:
- ✅ SMS arrived: "Your conversation summary is ready..."
- ✅ WhatsApp arrived (template): "Hi there, Robert shared this message with you: Your conversation summary is ready. 4 action items, 0 calendar events created. Check your email for details. — Sent via MyNaavi."
- ❌ Email: not received (fix deployed in commit 70f0eb8; awaits fresh test)
- ❌ Drive link: null (save-to-drive returned without webViewLink; unknown reason)
- ❌ Calendar events: 0 created; action types unknown (not logged in this run; commit 739a8ce added logging)

### 5.3 Direct EF test (during debugging)
```
curl POST /functions/v1/send-user-email
body: {"user_id":"788fe85c-b6be-4506-87e8-a8736ec8e1d1","subject":"Test","body":"..."}
response: {"success":true,"to":"wael.aggan@gmail.com"}
```
Confirms `send-user-email` EF works with auth.users fallback. User said they did NOT receive this test email either — may be in spam OR Gmail is filtering.

### 5.4 User's exact pain points (quoted)
- "Can you record.. is not natural" → led to regex broadening
- "Worked but after 30 second interrupted the conversation by saying 'are you there'" → led to idle-timer guard fix
- "What is the 4 actions? why 0 calendar. the doctor subscripted a medicine for 10 days. no email" → led to action logging + widened calendarTypes + drive link log fix
- "now after modification, you see the first screen that analysed the reason of the conversation, nothing about the title or the speakers name" → mobile modal skip issue

### 5.5 Mobile app issue (separate from voice recording)
User used mobile Conversation Record button. Expected: title prompt + speaker names modal. Got: transcript appeared in chat bubble + Naavi offered "save it / schedule follow-up / set up Amoxil reminders". User selected medication option; got 6 "EVENT ADDED TO CALENDAR — Amoxil 500mg" cards; checked Google Calendar — none were created.

---

## 6. Current state per surface

### 6.1 Mobile
- Installed on phone: V50 build **91** (user confirmed via screenshot)
- Latest AAB built: V50 build **92** (`https://expo.dev/artifacts/eas/316VJ7ghXZCLDWdG7sfrAm.aab`)
- Install status: **user has not yet installed build 92**
- Settings label in app/settings.tsx:559: "MyNaavi — V50 (build 92)"

### 6.2 Web
- `naavi-app.vercel.app` (app shell) — works, unblocked after native module guard
- `mynaavi.com` (marketing site) — blog live, custom waitlist form live
- SEO: canonical=apex, OG/Twitter/JSON-LD in place, sitemap current

### 6.3 Voice server (Railway)
- Latest commit deployed: `739a8ce` (push at ~14:10, Railway auto-deploys)
- Required env var: `PUBLIC_HOST` or `RAILWAY_PUBLIC_DOMAIN` — **not independently verified** but recording worked in test 2 so it must be set.
- Known-good env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, DEEPGRAM_API_KEY, ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

### 6.4 Supabase
- Project: `hhgyppbxgmjrwdpdubcx`
- Deployed EFs (confirmed live): `get-naavi-prompt` (v4-record-disambig), `send-user-email`, all others unchanged
- Prompt version verify command:
```
curl POST https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/get-naavi-prompt
  Authorization: Bearer <ANON from .env.local>
  body: {"channel":"voice","userName":"Wael"}
expected version: 2026-04-16-v4-record-disambig
```

---

## 7. Out-of-scope issues surfaced (for next session)

### A. Mobile Conversation Record modal auto-skips
**File:** `app/index.tsx` lines 720-734
**Logic:**
```js
if (savedName && speakers.length === 1) {
  // Skip modal entirely, auto-confirm with user name
  confirmSpeakers({ [speakers[0]]: savedName }, '').catch(() => {});
  return;
}
```
User's recording had AssemblyAI detect only 1 speaker (poor diarization or single voice on phone) → modal skipped → user never got to name the conversation or confirm speakers.

**Fix option 1:** Remove auto-skip. Always show modal.
**Fix option 2:** Show title-only modal when 1 speaker.
**Decision pending user input.**

### B. Amoxil SCHEDULE_MEDICATION events not in Google Calendar
**File:** `hooks/useOrchestrator.ts` lines 233-295
**Flow:**
1. Claude returns SCHEDULE_MEDICATION action
2. Orchestrator computes dose events (5 on / 3 off, etc.)
3. Each event → `registry.calendar.createEvent({title, description, startISO, endISO, attendees})`
4. `turnEvents.push(result)` — UI shows "EVENT ADDED TO CALENDAR" cards
5. ❌ Google Calendar is empty

**Not yet traced:** `registry.calendar.createEvent` implementation. Search `lib/adapters/` for registry. Possible causes:
- Adapter hits a LOCAL calendar_events table instead of Google
- Silent failure swallowed in try/catch at line 284
- Missing Google OAuth scope for Calendar write

**In-flight when user interrupted:** was about to `grep -rn "registry.calendar" lib/adapters` to find the createEvent implementation.

### C. user_settings.email blank
Wael's row in `user_settings` has no email populated. `send-user-email` now falls back to `auth.users.email` (commit 70f0eb8). Optional future work: backfill `user_settings.email` from `auth.users.email` for all rows.

### D. Drive link returns null on voice recording pipeline
`save-to-drive` EF returned without `webViewLink`. Unknown cause. Next call's log will show more (may need extra logging in save-to-drive itself).

---

## 8. Deferred from earlier sessions (still pending — from previous memory)

- User installs V50 build 92 on phone
- Layer 2 guided testing (N1 multi-user safety: mobile as Wael, web as Huss simultaneously)
- Revoke leaked GitHub PAT at https://github.com/settings/tokens (user's action)
- Anon JWT rotation (ties to next mobile release)
- Huss re-signs-in on mobile (Google token returning 403)
- 3 deferred testing bugs:
  1. No "Send" confirmation sound on draft tap
  2. Sent WhatsApp/email not logged in "critical messages" query
  3. Recorded conversation (mobile AssemblyAI) not persisted in dedicated table

---

## 9. User-specific data (do NOT guess)

| Item | Value |
|---|---|
| Wael's user_id | `788fe85c-b6be-4506-87e8-a8736ec8e1d1` |
| Wael's email | `wael.aggan@gmail.com` |
| Wael's phone | `+16137697957` |
| Huss's phone | `+13435750023` |
| Supabase project | `hhgyppbxgmjrwdpdubcx` |
| Voice server host | Railway — domain via `RAILWAY_PUBLIC_DOMAIN` env var |
| GitHub user | `munk2207` |
| Mobile app repo | `munk2207/naavi-app` |
| Voice server repo | `munk2207/naavi-voice-server` |

---

## 10. Environment / secrets status

**Local .env.local has:**
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` (verified)
- Other keys (not inspected)

**Supabase secrets (via `npx supabase secrets list`):**
- `NAAVI_ANON_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_WHATSAPP_FROM`, `ASSEMBLYAI_API_KEY`, `ANTHROPIC_API_KEY`, VAPID keys, `FIREBASE_SERVICE_ACCOUNT_JSON`

**Railway env (voice server) — NOT independently verified but recording works so all present:**
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_HOST` or `RAILWAY_PUBLIC_DOMAIN`

---

## 11. Git / branch situation

```
main repo (naavi-app):
  branch main — ahead of origin (pushed)
  HEAD: e28006d docs: Session 9 voice recording handoff record
  (commit 70f0eb8 is last feature commit before docs)

voice server (naavi-voice-server):
  branch main — ahead of origin by... 0 commits (pushed)
  HEAD: 739a8ce Voice recording — log extracted actions + email result + widen calendar types

worktree (.claude/worktrees/cranky-hoover):
  branch claude/cranky-hoover
  STALE — at commit a494a69 (before any session 9 work)
  Changes were made on main checkout, NOT this worktree.
  Worktree status shows unrelated changes: .claude/settings.local.json, supabase/.temp/cli-latest, .claude/launch.json (untracked)
```

**If next Claude needs worktree to match main:**
```bash
cd C:\Users\waela\OneDrive\Desktop\Naavi\.claude\worktrees\cranky-hoover
git fetch origin
git reset --hard origin/main   # BUT check with user first
```

---

## 12. Commands reference

### Verify prompt version deployed
```bash
ANON=$(grep EXPO_PUBLIC_SUPABASE_ANON_KEY "C:\Users\waela\OneDrive\Desktop\Naavi\.env.local" | cut -d'"' -f2)
curl -sS -X POST "https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/get-naavi-prompt" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $ANON" \
  -d '{"channel":"voice","userName":"Wael"}' | python -c "import sys,json;d=json.loads(sys.stdin.read());print('version:',d.get('version'))"
# Expected: 2026-04-16-v4-record-disambig
```

### Test email EF directly
```bash
curl -sS -X POST "https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/send-user-email" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $ANON" \
  -d '{"user_id":"788fe85c-b6be-4506-87e8-a8736ec8e1d1","subject":"Test","body":"Hello"}'
# Expected: {"success":true,"to":"wael.aggan@gmail.com"}
```

### Deploy EFs
```bash
cd C:\Users\waela\OneDrive\Desktop\Naavi
npx supabase functions deploy get-naavi-prompt
npx supabase functions deploy send-user-email
```

### Push voice server (Railway auto-deploys)
```bash
cd C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server
git push origin main
```

### Run smoke test
```bash
cd C:\Users\waela\OneDrive\Desktop\Naavi
node scripts/smoke-test.js
# Output: docs/smoke-test-results/latest.log + history.csv
```

### Rollback voice recording feature (nuclear option)
```bash
# Revert Supabase side
cd C:\Users\waela\OneDrive\Desktop\Naavi
git revert 70f0eb8 5432edd 634813a
git push origin main
npx supabase functions deploy get-naavi-prompt

# Revert voice server side
cd C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server
git revert 739a8ce 15f5268 636c18b 83094d1 a2e7a52
git push origin main
```

---

## 13. Current TODO state (as of handoff)

1. ✅ V50 build 92 AAB built
2. ⏳ User installs build 92 on phone
3. ⏳ Layer 2 testing (paused — after recording feature stabilized)
4. 🔄 Voice recording — end-to-end verified EXCEPT email + Drive (awaits fresh test)
5. 🔄 Mobile modal — remove single-speaker auto-skip (in-flight when user asked for handoff)
6. 🔄 Amoxil — investigate why SCHEDULE_MEDICATION events don't reach Google Calendar (in-flight; next step was `grep -rn "registry.calendar" lib/adapters`)

---

## 14. Resume prompt template

Paste this into a new Claude session to continue with zero context loss:

```
I am Wael (non-technical founder of MyNaavi). Read these in order before ANY action:
1. C:\Users\waela\OneDrive\Desktop\Naavi\docs\SESSION_9_COMPLETE_HANDOFF.md (full state)
2. C:\Users\waela\OneDrive\Desktop\Naavi\CLAUDE.md (project rules)
3. Memory: C:\Users\waela\.claude\projects\C--Users-waela-OneDrive-Desktop-Naavi\memory\MEMORY.md (index)
4. All feedback_*.md files in that memory folder (my working style — obey strictly)

Current state: voice call recording feature built and 80% working. SMS + WhatsApp confirmed working in real test. Email + Drive + calendar events need verification in next test call.

Parallel work in flight:
- Fix mobile Conversation Record modal auto-skip (app/index.tsx:720-734)
- Investigate why SCHEDULE_MEDICATION events (Amoxil) don't reach Google Calendar — start with `grep -rn "registry.calendar" lib/adapters` to find createEvent implementation

My rules (from feedback files): no action without my explicit approval; keep responses short; one step at a time; never assume; trace before changing; wait for "done" before next instruction. Windows/PowerShell environment. GitHub user munk2207.

Acknowledge you've read the handoff doc by giving me a 3-line summary of current state, then wait for my instruction.
```

---

## 15. Honest gaps in this document

Things I cannot guarantee are captured:
- **Railway deploy status in real-time** — I can't reach Railway directly from this session. User sees their dashboard.
- **Exact moment-by-moment conversation history** — the previous session's auto-compaction summary is at the top of my context but not fully restated here.
- **Exact Railway log output** — user shared screenshots; I copied key lines but not all.
- **Full content of every commit** — I listed commit messages + intent. For exact diffs, use `git show <sha>`.
- **Visual design details** — shared.js nav structure, CSS classes, font choices not documented here.
- **Supabase RLS policies** — current state not re-audited this session.
- **Cron jobs** — one cron was fixed earlier this session (calendar sync JSON header bug). Current full cron list not re-enumerated.
- **Railway's exact build output** — I don't see it.
- **Whether the latest test email actually arrived in Wael's Gmail** — user said "no email" but direct EF call returned success; Gmail spam filter possible.

---

---

## 16. Institutional knowledge — stuff not in commits or code comments

This is the "why" behind decisions + hard-won lessons. More valuable than the commit list for onboarding.

### 16.1 The Deepgram echo problem
Naavi's own TTS audio bleeds back into Deepgram STT because the Twilio media stream is bidirectional — outbound TTS frames and inbound caller audio share the same channel from Deepgram's perspective. Deepgram transcribes Naavi saying "Okay recording now" as user speech, which then hits `processUserMessage`. Symptom: phantom user messages that match Naavi's own confirmation phrases.

**Fix pattern:** `awaitingRecordingStart` flag set the moment we decide to play TTS; Deepgram handler swallows all transcripts while flag is true; flag cleared after the operation completes (or after a fixed delay past TTS end).

**This will recur** for any future feature that plays TTS and expects the next user input to be clean. Same pattern applies.

### 16.2 Claude rule priority is unreliable
When you add a new Claude action RULE that shares a trigger word with an existing rule, Claude will often pick the more established one regardless of priority hints. "TAKES PRIORITY OVER" in the prompt helps but doesn't fix it 100%.

**Rule:** if an action is a binary routing decision (did user say X → do Y), **don't trust Claude.** Use server-side regex in voice server or hook code. Claude is good for content generation, unreliable for classification.

**Real example in session:** RULE 18 (START_CALL_RECORDING) had "record my visit" as trigger. RULE 9 (SAVE_TO_DRIVE) had "record" as trigger. Claude picked RULE 9 even after adding exception language. Fix was direct regex bypass in voice server.

### 16.3 The 3.5s TTS-to-recording delay
Confirmation TTS "Okay, recording now. Put me on speaker..." is ~4 seconds of speech. Twilio plays it sequentially. If `startTwilioRecording` fires too early, Naavi's own voice is captured in the recording start. If too late, the user starts talking before recording begins and loses first words.

**3.5s is empirical.** Adjust if you change the confirmation phrase length.

### 16.4 Twilio recording API quirks
- Requires an `https://` callback URL (not http or bare domain)
- Uses Basic Auth with `TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN`
- `RecordingChannels=dual` gives better diarization downstream
- `RecordingStatusCallbackEvent=completed` — you only want the final event, not in-progress
- Recording URL format: `https://api.twilio.com/.../Recordings/RE<sid>` — append `.mp3` for MP3 download
- Recording auto-ends on call hangup; you still get the callback
- Twilio keeps recording for ~30 days by default

### 16.5 AssemblyAI pipeline timings
- 70-second recording: ~15s to transcribe
- 30-minute recording: ~2-5 min
- Poll every 5s; max 15 min timeout (generous)
- `speech_models: ['universal-2']` + `language_detection: true` handles Arabic/French/English automatically
- Returns speakers as letters (A, B, C...). Voice server defaults: A→userName, B→"Them", C+→"Speaker X"

### 16.6 send-email vs send-user-email — do not merge
- `send-email` — requires user JWT in Authorization header. Used by mobile app for user-initiated sends to third parties.
- `send-user-email` — uses service role. Sends through user's own Gmail TO themselves or an override address. Used by server-side summaries.

They LOOK similar but have different auth models. Don't "consolidate" them without understanding this split.

### 16.7 Email deliverability quirk
Email sent via `send-user-email` goes FROM the user's own Gmail TO the same user. Gmail sometimes filters "sent to self" emails into specific labels (not inbox). Check:
- All Mail
- Spam
- Filters / "from:me" behavior

If user insists emails aren't arriving, test with `to` override (send to a different address you control) to confirm EF is sending.

### 16.8 Mobile Conversation Recorder auto-skip is pre-existing
File: `app/index.tsx:720-734`. When AssemblyAI returns 1 speaker, the title/speaker modal is skipped and `confirmSpeakers({[s]: userName}, '')` runs immediately. This was added in an earlier session for UX (saves a tap when recording yourself alone). Current user expectation is different — they want to always set a title.

**Do NOT "just remove the skip"** — confirm with user first whether they want: (a) always show modal, (b) title-only modal for 1-speaker case, (c) something else.

### 16.9 registry.calendar.createEvent — trace before changing
`hooks/useOrchestrator.ts:233+` calls `registry.calendar.createEvent(...)`. The registry is in `lib/adapters/` — exact file not confirmed this session. Before changing SCHEDULE_MEDICATION logic, verify:
1. Does it write to LOCAL `calendar_events` table? Or call Google Calendar API directly?
2. Does it call `create-calendar-event` Edge Function?
3. Are failures caught + silenced? (try/catch at line 284)

User reports UI shows success cards but Google Calendar is empty. Likely adapter is local-only. Could be intentional (two-tier: local for fast UI, sync job pushes to Google) OR broken.

### 16.10 Active worktree vs main checkout — I broke the rule
CLAUDE.md says edit in `.claude/worktrees/cranky-hoover`. This session I edited in the main checkout at `C:\Users\waela\OneDrive\Desktop\Naavi`. Changes committed to `main` directly. Worktree branch `claude/cranky-hoover` is STALE.

**If next Claude follows CLAUDE.md strictly:** they'll find the worktree empty of session 9 work and be confused. Reconcile by `git fetch origin && git reset --hard origin/main` in the worktree after user confirms.

### 16.11 Railway deploy timing
Push to GitHub → Railway build → Deploy. Typically 1-3 min. If user reports a test failure <2 min after your push, first check if the deploy finished. Railway dashboard shows deploy status. You can't query Railway from this session; ask user to check.

### 16.12 Supabase EF deploy is instant-ish
`npx supabase functions deploy <name>` takes ~10s. No propagation delay. Verification: curl the function immediately after.

### 16.13 Curl-to-EF auth requirements
EF requires `Authorization: Bearer <key>`. Valid keys:
- Anon key (from `.env.local`) — works for functions with `verify_jwt=false`
- Service role key — works for everything
- User JWT from Supabase auth — works for user-scoped functions

Missing header returns `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}`.

### 16.14 The prompt is hot-loaded
Voice server calls `get-naavi-prompt` EF at EVERY user message. No cache. Any prompt change is live on the next user turn. No need to restart anything.

### 16.15 Local fallback prompt in voice server is STALE
`naavi-voice-server/src/index.js` has `buildVoiceSystemPrompt()` as fallback when the EF call fails. This fallback is MANUALLY maintained and currently has RULE 8a/8b/8c numbering (old), not RULE 9/10/etc (new), and LACKS RULE 18 entirely. If the EF call ever fails in production, users get the old behavior.

**Either:** delete the fallback (fail hard), or periodically sync it from the EF (manual task).

### 16.16 Debugging playbook

| Symptom | First check | Second check |
|---|---|---|
| "Record my visit" does wrong thing | Railway deployed latest? (check voice server commit hash) | Prompt EF version: `2026-04-16-v4-record-disambig`? |
| Naavi asks "what to record" | Voice server running pre-regex-bypass code | Deploy latest voice server |
| Recording starts but audio cuts mid-first-word | 3.5s delay not enough for the TTS length | Lengthen to 4s |
| "Are you there" fires during recording | Idle timer not guarded | Check `startIdleTimer()` has `if (isRecording) return` |
| Email not arriving | Gmail spam / "from self" filters | Direct curl test of `send-user-email` EF |
| Drive link null | save-to-drive EF failed silently | Check Supabase EF logs for `save-to-drive` |
| 0 calendar events | Action types not in calendarTypes set | Log action types — widen set if needed |
| Priority items trigger on unrelated phrase | Priority regex false positive | Check `lower` contains priority keyword literally |
| WebSocket echoes | Deepgram echo pattern | Set `awaitingRecordingStart` or equivalent suppression flag |

### 16.17 User mental model (how to explain things)
User is non-technical but sharp. Effective framings:
- "Naavi" = the app, "Nahvee" = how it's pronounced out loud
- "Voice server" / "Railway server" = the Twilio phone server
- "The prompt" = the instructions Claude reads every message
- "Edge Functions" / "EFs" = Supabase serverless functions (the backend)
- "Action" = what Claude decides to do (create event, send message, etc.)
- "Multi-user" = Wael vs Huss safety (each sees only their own data)

Avoid: webhook, endpoint, JWT, OAuth, service role, adapter, orchestrator — unless explained.

---

*End of SESSION_9_COMPLETE_HANDOFF.md — April 16, 2026*

