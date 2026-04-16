# Session 9 — Voice Call Recording (Twilio) — Full Handoff Record

**Date:** April 16, 2026 (ongoing)
**Scope:** Build voice-triggered conversation recording on phone calls to Naavi, using Twilio REST recording + existing AssemblyAI pipeline.
**Status:** Core flow WORKS end-to-end. SMS + WhatsApp delivery confirmed. Email + Drive + per-action delivery need final verification.

---

## Quick-start: if this session dies

1. Read this doc top to bottom
2. Read `memory/project_naavi_voice_server_recording.md` (below — may need to be created)
3. Tell next Claude: "continue from SESSION_9_VOICE_RECORDING.md, current state is section 8"

---

## 1. What the feature does

User is on a live Twilio call with Naavi. Says "record my visit" (or variant). Naavi replies with fixed confirmation, then starts recording the call via Twilio REST API. Goes silent (no music, no TTS) so the audio is clean. Listens only for stop phrase ("Naavi stop") or hangup or 60-min cap.

When recording ends, Twilio fires `/recording-complete` webhook. Server downloads MP3, pipes through existing AssemblyAI → extract-actions → create-calendar-event → save-to-drive pipeline (mobile already used these). Delivers summary via:
- Email (full): via new `send-user-email` EF, sends through user's own Gmail
- SMS (short ping): "summary ready"
- WhatsApp (short ping): same
- Push (short ping): same

---

## 2. Architecture decisions made

| Decision | Why |
|---|---|
| Direct-detection regex (not Claude) for trigger phrase | Claude kept confusing "record my visit" with SAVE_TO_DRIVE (RULE 9 had "record" as trigger). Hardcoded regex in voice server = 100% reliable. |
| 3.5s delay between TTS confirmation and actual Twilio recording | Lets confirmation TTS finish before audio capture starts (so user's first words of actual visit aren't missed by capturing Naavi's own voice). |
| `awaitingRecordingStart` flag to suppress Deepgram during TTS playback | Otherwise Deepgram transcribes Naavi's own voice and feeds it back through processUserMessage. |
| New EF `send-user-email` instead of modifying existing `send-email` | `send-email` needs user JWT. Voice server only has service role. Cleaner to isolate. |
| Email sent through user's own Gmail (not a service account) | Simpler OAuth; uses refresh_token already stored in `user_tokens`. Falls back to `auth.users.email` if `user_settings.email` is empty. |
| Webhook returns 200 immediately, orchestrator runs async | Twilio has 15s webhook timeout; AssemblyAI transcription can take minutes. |
| `calendarTypes` set includes task/reminder/email now | Claude often labels prescriptions as "task" rather than "prescription". Set widened so all extracted items get calendar rows. |

---

## 3. Files changed (with commits)

### Main repo (`C:\Users\waela\OneDrive\Desktop\Naavi`) — remote: `munk2207/naavi-app`

| Commit | File | Change |
|---|---|---|
| `634813a` | `supabase/functions/get-naavi-prompt/index.ts` | Added RULE 18 (START_CALL_RECORDING). PROMPT_VERSION → `2026-04-16-v3-record`. |
| `634813a` | `supabase/functions/send-user-email/index.ts` | **NEW FILE**. Sends email via user's Gmail using service role lookup of user_tokens. |
| `634813a` | `supabase/config.toml` | Registered `send-user-email` with `verify_jwt = false`. |
| `5432edd` | `supabase/functions/get-naavi-prompt/index.ts` | Fixed RULE 9 vs RULE 18 conflict. PROMPT_VERSION → `2026-04-16-v4-record-disambig`. |
| `70f0eb8` | `supabase/functions/send-user-email/index.ts` | Fall back to `auth.users.email` (via `adminClient.auth.admin.getUserById`). |

All pushed to `origin/main`. All Supabase EFs deployed live.

### Voice server repo (`C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server`) — remote: `munk2207/naavi-voice-server`

| Commit | File | Change |
|---|---|---|
| `a2e7a52` | `src/index.js` | Full recording infrastructure: `startTwilioRecording()`, `stopTwilioRecording()`, `/recording-complete` webhook, `processCallRecording()` orchestrator, state machine. +433 lines. |
| `83094d1` | `src/index.js` | Direct trigger detection (bypass Claude). +35 lines. |
| `636c18b` | `src/index.js` | Generous regex for natural phrasing ("record my" alone, "record it", "record now", etc.). |
| `15f5268` | `src/index.js` | `awaitingRecordingStart` flag to suppress Deepgram TTS echo. Idle timer never fires during recording. |
| `739a8ce` | `src/index.js` | Log each extracted action + email success/failure. Widen `calendarTypes` to include task/reminder/email. |

All pushed to `origin/main`. Railway auto-deploys on push.

---

## 4. Deployment commands (for reference)

```bash
# From main repo root:
cd "C:\Users\waela\OneDrive\Desktop\Naavi"
npx supabase functions deploy get-naavi-prompt
npx supabase functions deploy send-user-email

# Voice server (Railway auto-deploys on push):
cd "C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server"
git push origin main
```

**Railway env var required (must exist):**
- `PUBLIC_HOST` or `RAILWAY_PUBLIC_DOMAIN` — sets the callback URL for Twilio recording webhook
- Existing: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

---

## 5. Trigger phrases that start recording

Regex in `processUserMessage` (`src/index.js`):

```js
const recordingTrigger = /\brecord\s+(my|the|this|our)(?!\s+(?:note|reminder|text|that|down|as|in|to|on))\b|\bstart\s+(?:the\s+)?recording\b|\brecord\s+(?:it|now)\b|\brecord\s+(?:a\s+|an\s+)?(?:visit|conversation|meeting|appointment|doctor|call|session|talk|chat|discussion|phone\s+call)\b/i;
```

**Matches (natural):** "record my visit", "record the meeting", "record this", "start recording", "please record the call", "can you record my visit", "record it", "record now", "I want to record the visit", "record our meeting", "record a conversation".

**Explicitly blocks:** "record this down", "record that in my notes", "record a note" (save-intent words).

## 6. Stop phrases that end recording

```js
const stopPhrase = /\b(na+h?v+ee?|naavi|navi)\b.{0,25}\b(stop|end|done|finish)\b|\b(stop|end|finish)\b.{0,15}\b(record|recording)\b/i;
```

Or hangup. Or 60-min safety cap.

---

## 7. Test results so far

**Test 1 (14:00:50):** Failed — Claude saw "record my visit" as SAVE_TO_DRIVE. Fixed by RULE 9 exception + direct regex.

**Test 2 (14:08:50):** Flow worked end-to-end:
- Recording trigger detected via regex
- Twilio recorded 71s
- AssemblyAI returned 9 utterances, 2 speakers
- extract-actions returned 4 action items
- SMS + WhatsApp ping received ✅
- Email: **NOT RECEIVED** by user. Direct EF test confirmed working after `auth.users.email` fallback added.
- Drive link: `null` in logs — save-to-drive returned but `webViewLink` was null
- Events: 0 created (actions had types outside calendar set; since widened to include task/reminder/email)

**Direct test of send-user-email EF with Wael's user_id:**
```
POST /functions/v1/send-user-email
body: {"user_id":"788fe85c-b6be-4506-87e8-a8736ec8e1d1","subject":"Test","body":"..."}
→ {"success":true,"to":"wael.aggan@gmail.com"}
```
So EF works. Email may be in spam or voice server's call to it was failing somehow before the fallback fix.

---

## 8. Current state (as of this doc)

**Works:**
- ✅ Voice trigger detection
- ✅ TTS confirmation plays without echo
- ✅ Twilio recording starts/stops correctly
- ✅ AssemblyAI transcription + diarization
- ✅ extract-actions returns action items
- ✅ SMS + WhatsApp summary ping delivered
- ✅ Idle timer doesn't interrupt recording

**Needs next-call verification:**
- ⚠️ Email delivery (auth.users fallback deployed but not yet confirmed in a fresh recording)
- ⚠️ Drive link (was null — probably silent save-to-drive failure)
- ⚠️ Calendar events count (widened calendarTypes but need new log showing action types)
- ⚠️ Action items content (next log will show each with type/title via new logging)

**Untested (unrelated to voice):**
- Mobile conversation recorder flow — user reported modal skipped + Amoxil events didn't reach Google Calendar. See section 10.

---

## 9. Key file locations

### Voice server
- `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server\src\index.js` — everything
  - Line ~25: env vars + `activeRecordings` Map + `RECORDING_MAX_MS`
  - Line ~1073: `startTwilioRecording()` / `stopTwilioRecording()` helpers
  - Line ~1240: `/recording-complete` webhook + `processCallRecording()` orchestrator
  - Line ~1400: per-connection state (`isRecording`, `recordingSid`, `awaitingRecordingStart`)
  - Line ~1450: `enterRecordingMode()` / `exitRecordingMode()`
  - Line ~1500: Deepgram handler with silent-mode swallow + stop phrase detection
  - Line ~1930: `processUserMessage()` with direct trigger detection

### Supabase EFs
- `supabase/functions/get-naavi-prompt/index.ts` — prompt (RULE 18 at line ~180)
- `supabase/functions/send-user-email/index.ts` — email sender (auth.users fallback)
- `supabase/functions/upload-conversation/index.ts` — AssemblyAI upload (existing)
- `supabase/functions/poll-conversation/index.ts` — AssemblyAI poll (existing)
- `supabase/functions/extract-actions/index.ts` — Claude action extraction (existing)

---

## 10. Out-of-scope issues flagged by user (session 9 tail)

These are NOT part of the voice recording feature but surfaced in testing. User asked to do them in parallel.

### A. Mobile Conversation Record button skips labeling modal
**File:** `app/index.tsx` lines 720-734
**Cause:** When AssemblyAI detects only 1 speaker AND user has saved name → modal auto-skipped.
**Suggested fix:** Remove auto-skip OR show simpler title-only modal. User wants to always set a title.

### B. Amoxil SCHEDULE_MEDICATION events not in Google Calendar
**File:** `hooks/useOrchestrator.ts` line 233+
**Cause:** Unknown. UI shows "EVENT ADDED TO CALENDAR — Amoxil 500mg" cards but Google Calendar is empty.
**Suggested trace:**
1. `registry.calendar.createEvent({ ... })` — where does registry live?
2. Does it POST to `create-calendar-event` EF?
3. Does EF actually hit Google Calendar API?
4. Is there silent failure swallowed in try/catch at line 284?

### C. User_settings.email blank
Wael's row in `user_settings` has no email. `auth.users.email` fallback now handles this. Optional: backfill `user_settings.email` from auth table.

---

## 11. Deferred from earlier sessions (still pending)

- V50 build 92 AAB install on user's phone (current phone has build 91 per earlier screenshot)
- Layer 2 guided testing (N1 multi-user safety)
- Revoke leaked GitHub PAT at https://github.com/settings/tokens
- Anon JWT rotation (ties to next mobile release)
- Huss re-signs-in on mobile (his Google token returning 403)
- Three deferred testing bugs:
  1. No "Send" confirmation sound on draft tap
  2. Sent WhatsApp/email not logged for "critical messages" query
  3. Recorded conversation (mobile AssemblyAI) not persisted in dedicated table

---

## 12. User-specific data (do NOT guess)

| Item | Value |
|---|---|
| Wael's user_id | `788fe85c-b6be-4506-87e8-a8736ec8e1d1` |
| Wael's email | `wael.aggan@gmail.com` |
| Wael's phone | `+16137697957` |
| Huss's phone | `+13435750023` |
| Supabase project | `hhgyppbxgmjrwdpdubcx` |
| Voice server (Railway) | `naavi-voice-server.up.railway.app` |

---

## 13. How to resume

**If everything is stable and working:** ask user to do one more test call and confirm email + Drive work. Then move to mobile issues (section 10).

**If something broke mid-session:** check `git log --oneline -10` in both repos. The latest commits are safe rollback points.

**If user wants to roll back recording feature entirely:**
```bash
# Main repo — revert Supabase-side
cd "C:\Users\waela\OneDrive\Desktop\Naavi"
git revert 70f0eb8 5432edd 634813a

# Voice server — revert voice-side
cd "C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server"
git revert 739a8ce 15f5268 636c18b 83094d1 a2e7a52
```

**Prompt version tag** (for verifying deploy in new sessions):
```bash
curl -sS -X POST "https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/get-naavi-prompt" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ANON_KEY_FROM_.env.local>" \
  -d '{"channel":"voice","userName":"Wael"}' | python -c "import sys,json; print(json.loads(sys.stdin.read()).get('version'))"
```
Expected: `2026-04-16-v4-record-disambig` (or newer).

---

## 14. Working rules reinforced this session

- **No action without approval** — every code change got confirmation first
- **Check the code, not memory** — confirmed prompt deployment by curl, not assumption
- **No trial and error** — when Claude kept ignoring RULE 18, we traced why (RULE 9 conflict) before changing more code
- **Fix server before client** — voice server changes always deployed first so prompt + EF matched
- **One step at a time** — committed in small phases; each phase tested before next

---

*End of SESSION_9_VOICE_RECORDING.md*
