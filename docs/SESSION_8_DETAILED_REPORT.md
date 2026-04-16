# MyNaavi Session 8 — Detailed Report
## April 13-14, 2026

---

## 1. MOBILE APP FIXES (Builds 83-90)

### Build 83 — Voice Confirm "Yes" Fix
**Problem:** When Robert says "yes" in hands-free mode after a draft is created, it was sent to Claude as a new message instead of confirming the draft. This created an infinite loop of new drafts.

**Root cause:** Deepgram WebSocket `onmessage` runs synchronously. React state updates (`setStatus('pending_confirm')`) are async. By the time the handsfree hook checks if it's in confirm mode, Deepgram has already processed "yes" as regular speech.

**Fix:** Added a module-level JavaScript variable `pendingConfirmActive` in `useOrchestrator.ts` — outside React, so it's instant. No waiting for React state to update.

**Files changed:**
- `hooks/useOrchestrator.ts` — added `let pendingConfirmActive = false` at module level, `isPendingConfirmActive()` export. Set to `true` after TTS finishes speaking the draft. Set to `false` in confirmPending, cancelPending, editPending, clearHistory, stopAndReset.
- `hooks/useHandsfreeMode.ts` — imports `isPendingConfirmActive()`. Checks it in `processTranscript` and `handleUtteranceEnd` before deciding if speech is a confirmation or new message.

**Result:** No more infinite loop. "Yes" is intercepted correctly.

---

### Build 84 — Punctuation Fix
**Problem:** Deepgram with `smart_format` enabled transcribes "Yes" as "Yes." (with a period). The classification function checked for exact match "yes" — "Yes." didn't match because of the dot. So it fell through to "edit" mode instead of "confirm."

**Fix:** Added `.replace(/[.,!?;:]+$/g, '')` to strip trailing punctuation before classifying.

**File changed:**
- `lib/voice-confirm.ts` — one line change in `classifyConfirmation()`.

---

### Build 85 — TTS Delay + Logo
**Problem 1:** After voice confirm, "Sent." was clipped — only heard a click or partial word. The mic was stealing audio focus from the speaker before TTS finished.

**Fix:** Added 1.5 second delay (later increased to 2.5s in build 87) before `speakResponse()` in `confirmPending` and `cancelPending`. Gives Android time to switch from mic mode to speaker mode.

**Problem 2:** App header had no logo. Previous attempts had white background issue.

**Fix:** Used Python Pillow to remove white background from `assets/mynaavi-logo.png`. Added `<Image>` component to header in `_layout.tsx`, 24x24 pixels.

**Files changed:**
- `hooks/useOrchestrator.ts` — added `await new Promise(resolve => setTimeout(resolve, 1500))` before speakResponse in confirmPending and cancelPending
- `app/_layout.tsx` — added Image import, logo in headerTitle, logo style
- `assets/mynaavi-logo.png` — white background removed via Python script

---

### Build 86 — Contact Save + Settings Name + Dynamic User Name

**Problem 1: Contact save not working**
- `savePerson()` in `lib/memory.ts` was inserting to `people` table WITHOUT `user_id`. Table has RLS policy requiring user_id, so insert failed silently.
- `saveContact()` in `lib/supabase.ts` saved to `contacts` table but only inserted `name` and `email` — phone field was in the function signature but never inserted.

**Fix:**
- `savePerson()` — now gets session, extracts user_id, includes it in insert. Added error logging.
- `saveContact()` — now includes phone field in insert if provided.

**Problem 2: Settings name doesn't persist on mobile**
- `getUserName()` is synchronous — on mobile (Android) it uses SecureStore which is async. The sync version always returns empty string on mobile.
- Settings page called the sync version on load, so saved name was never displayed.

**Fix:** Changed `settings.tsx` to import and use `getUserNameAsync()` instead of `getUserName()`.

**Problem 3: "Robert" hardcoded in Claude prompt**
- The Claude system prompt in `naavi-client.ts` had "Robert" written dozens of times.
- Even after saving a name in Settings, Claude would still say "Robert."

**Fix:**
- `buildSystemPrompt()` — added `userName` parameter (default: 'Robert')
- The prompt is built normally, then at the end: `if (userName !== 'Robert') return prompt.replace(/\bRobert\b/g, userName);`
- `sendToNaavi()` — calls `getUserNameAsync()` before building prompt, passes the name

**Problem 4: Deepgram mishears "end", "cancel"**
- "End" transcribed as "and" or "d."
- "Cancel" transcribed as "Cancer."

**Fix:**
- Added "end", "cancel", "change", "goodbye" to `loadKeyterms.ts` as fixed keyterms (Deepgram gives these words higher priority)
- Added "end" and "end listening" to EXIT keywords in `useHandsfreeMode.ts`

**Files changed:**
- `lib/memory.ts` — savePerson with user_id and error logging
- `lib/supabase.ts` — saveContact includes phone field
- `app/settings.tsx` — getUserNameAsync instead of getUserName
- `lib/naavi-client.ts` — buildSystemPrompt accepts userName, replaces "Robert", sendToNaavi passes name
- `lib/loadKeyterms.ts` — added end, cancel, change, goodbye as fixed keyterms
- `hooks/useHandsfreeMode.ts` — added "end", "end listening" to EXIT keywords

---

### Build 87 — Cancel Recovery + Phone Normalize + Goodbye + Idle Timeout

**Problem 1: Cancel kills hands-free session**
- After saying "cancel," the hands-free session died instead of returning to listening.
- Root cause: WebSocket `onclose` handler only reconnected if state was `listening` or `confirming`. After cancel, state was `waiting` — so when the WebSocket closed, it didn't reconnect.

**Fix:** Added `|| stateRef.current === 'waiting'` to the reconnect check in `ws.onclose` and `handleReconnect`.

**Problem 2: Phone numbers not normalized on save**
- User says "Save contact XYZ phone number 769-7957" — saved as "769-7957" which is invalid for Twilio (needs +1 and area code).

**Fix:** Added normalization in useOrchestrator.ts ADD_CONTACT handler:
- 7 digits → prepend +1613 (Ottawa area code)
- 10 digits → prepend +1
- 11 digits starting with 1 → prepend +
- Already has + → keep as is

**Problem 3: "Goodbye Robert" hardcoded**
**Fix:** Changed to "Goodbye. Talk to you soon." — no name.

**Problem 4: Idle timeout too short (60s)**
**Fix:** Increased to 120 seconds.

**Files changed:**
- `hooks/useHandsfreeMode.ts` — reconnect in waiting state, goodbye text, idle timeout 120s
- `hooks/useOrchestrator.ts` — phone normalization in ADD_CONTACT, TTS delay increased to 2.5s

---

### Build 88 — Google Contacts Write

**Goal:** When Robert saves a contact through Naavi, it should also appear in his Google Contacts app (not just Naavi's database).

**What was built:**
1. Changed OAuth scope from `contacts.readonly` to `contacts` (read+write) in `lib/calendar.ts`
2. Created new Edge Function `create-contact` on Supabase — calls Google People API `people:createContact`
3. Updated `lib/adapters/google/contact.adapter.ts` to call create-contact Edge Function after saving to Supabase

**Problem discovered:** The contact adapter's `save()` method was never called — the orchestrator called `saveContact()` and `savePerson()` directly, bypassing the adapter.

**Fix (build 89):** Added direct `supabase.functions.invoke('create-contact')` call in the orchestrator's ADD_CONTACT handler.

**Files changed:**
- `lib/calendar.ts` — contacts.readonly → contacts
- `supabase/functions/create-contact/index.ts` — new Edge Function
- `lib/adapters/google/contact.adapter.ts` — calls create-contact after Supabase save
- `hooks/useOrchestrator.ts` — direct create-contact call in ADD_CONTACT

---

### Build 89 — Google Contacts Fix + TTS Delay

**Fix 1:** Added create-contact Edge Function call directly in orchestrator (adapter wasn't used).
**Fix 2:** Increased pre-TTS delay from 1.5s to 2.5s.

---

### Build 90 — Mobile OAuth Scopes Fix

**Problem:** Google Contacts write still failed with "insufficient authentication scopes" even after changing the scope in `calendar.ts`.

**Root cause:** The MOBILE sign-in path in `lib/supabase.ts` (line 45) had a completely DIFFERENT hardcoded scope string that was missing: contacts, contacts.other.readonly, drive.readonly, gmail.modify. The calendar.ts scopes were only used for the WEB OAuth flow.

**Fix:** Updated the mobile OAuth scope string in `signInWithGoogle()` to match the web flow:
```
gmail.send gmail.modify calendar.events drive.readonly drive.file contacts contacts.other.readonly tasks.readonly
```

**Additional discovery:** After changing scopes, the old refresh token stored in Supabase `user_tokens` table still had the old scopes. User had to revoke Google access at myaccount.google.com/permissions and sign in fresh.

**Result:** Google Contacts write CONFIRMED WORKING — contact appears in phone's Google Contacts app.

---

## 2. WEBSITE CHANGES

### Favicon
**Problem:** mynaavi.com had no favicon — browser tab showed no icon, Google search results showed no logo.

**What was done:**
1. Logo files already existed in `mynaavi-website/my-naavi-site/` at 40x40, 180x180, 192x192, 512x512
2. Files had white background (RGB mode, not RGBA) despite being exported from Canva as "transparent"
3. Used Python Pillow to convert white pixels to transparent: any pixel with R>240, G>240, B>240 → alpha=0
4. Copied files with standard names: favicon.png, apple-touch-icon.png, icon-192.png, icon-512.png
5. Added favicon links to `index.html` (`<link rel="icon">` and `<link rel="apple-touch-icon">`)
6. Added `injectFavicon()` function to `shared.js` so ALL pages (terms, privacy, guide) get the favicon automatically

**Files changed:**
- `mynaavi-website/my-naavi-site/favicon.png` — new (transparent)
- `mynaavi-website/my-naavi-site/apple-touch-icon.png` — new (transparent)
- `mynaavi-website/my-naavi-site/icon-192.png` — new (transparent)
- `mynaavi-website/my-naavi-site/icon-512.png` — new (transparent)
- `mynaavi-website/my-naavi-site/index.html` — added favicon links
- `mynaavi-website/my-naavi-site/shared.js` — added injectFavicon() function

**Result:** Favicon visible in browser tab on all pages. Google will pick it up for search results within days.

---

## 3. TWILIO VOICE CALL SERVER (NEW)

### What this is
A separate server that lets Robert call a phone number and talk to Naavi through a regular phone call. No app needed. Just: "Hey Google, call Naavi."

### Architecture — How it works

```
                    ROBERT'S PHONE
                         |
                    (phone call)
                         |
                      TWILIO
                  +1 249 523 5394
                         |
              (WebSocket media stream)
                         |
                   RAILWAY SERVER
            (naavi-voice-server on Railway)
                    /          \
                   /            \
         DEEPGRAM STT      DEEPGRAM TTS
         (Nova-3)          (Aura)
         audio → text      text → audio
                   \            /
                    \          /
                     CLAUDE API
                  (Anthropic Sonnet)
                  text → response text
```

### Step-by-step flow (what happens when Robert calls):

1. **Robert dials +1 249 523 5394** (or says "Hey Google, call Naavi")

2. **Twilio receives the call** and sends an HTTP POST to our Railway server at `/voice`

3. **Railway responds with TwiML** (Twilio's XML instruction language):
   ```xml
   <Response>
     <Say voice="Polly.Joanna">Hello, this is Naavi. How can I help you?</Say>
     <Connect>
       <Stream url="wss://overflowing-luck-production.up.railway.app/media-stream" />
     </Connect>
   </Response>
   ```
   This tells Twilio: speak the greeting, then open a bidirectional WebSocket to our server.

4. **Twilio opens a WebSocket** to our `/media-stream` endpoint. This is a BIDIRECTIONAL connection — audio flows both ways.

5. **Robert speaks.** Twilio captures the audio from the phone call and sends it through the WebSocket as base64-encoded mulaw audio chunks (8kHz, 1 channel).

6. **Our server receives the audio** and forwards each chunk to a Deepgram WebSocket connection. Deepgram is configured for:
   - Model: Nova-3
   - Encoding: mulaw (telephone standard)
   - Sample rate: 8000 Hz
   - Interim results: on (see partial transcripts)
   - Utterance end detection: 1500ms silence
   - Smart formatting: on (adds punctuation)

7. **Deepgram transcribes** in real-time and sends back:
   - Interim results (partial words as Robert speaks)
   - Final results (complete sentences)
   - UtteranceEnd events (Robert stopped talking)

8. **On UtteranceEnd**, the server collects all accumulated final transcripts and sends them to Claude:
   - Model: claude-sonnet-4-20250514
   - System prompt: "You are Naavi, a voice assistant on a phone call. Keep responses SHORT."
   - Conversation history maintained for multi-turn

9. **Claude responds** with text (e.g., "Today is Monday, April 14th, 2026.")

10. **Server converts text to speech** using Deepgram Aura TTS:
    - Model: aura-asteria-en
    - Encoding: mulaw (matches Twilio's format)
    - Sample rate: 8000 Hz
    - Returns raw audio bytes

11. **Server sends audio back through the Twilio WebSocket** as media events:
    ```json
    {
      "event": "media",
      "streamSid": "MZ...",
      "media": { "payload": "<base64 encoded mulaw audio>" }
    }
    ```
    Audio is sent in chunks of 8000 bytes (1 second each).

12. **Twilio plays the audio** through the phone call. Robert hears Naavi's response.

13. **Loop continues** — Robert speaks again, cycle repeats from step 5.

14. **Exit:** If Robert says "goodbye", "bye", or "end", the server generates a goodbye TTS message and closes the WebSocket (which ends the call).

### What was built and deployed

**GitHub repo:** github.com/munk2207/naavi-voice-server (private)
- `src/index.js` — single server file, ~330 lines
- `package.json` — dependencies: express, ws
- `.gitignore` — node_modules, .env

**Railway service:** overflowing-luck-production.up.railway.app
- Project: mindful-patience
- Service: overflowing-luck
- Region: us-east4
- Connected to GitHub repo (auto-deploys on push)

**Twilio configuration:**
- Phone number: +1 249 523 5394
- Voice webhook: https://overflowing-luck-production.up.railway.app/voice
- Method: HTTP POST

**Supabase Edge Function:** voice-call (Step 1 only — can be removed, replaced by Railway)

### What was proven working (tested on phone call):

| Test | Result |
|------|--------|
| Call connects | ✓ |
| Greeting plays ("Hello, this is Naavi") | ✓ |
| Twilio media stream connects to Railway | ✓ |
| Deepgram WebSocket connects | ✓ |
| Deepgram transcribes speech accurately | ✓ ("What is the day today?", "What is the time now?") |
| Claude receives transcript | ✓ |
| Claude generates response | ✓ ("Today is Monday, April 14th, 2026.") |
| Deepgram TTS generates mulaw audio | ✓ (27,121 bytes for short response) |
| Audio sent back through Twilio WebSocket | ✓ |
| Robert hears response on phone | ✓ |
| Multi-turn conversation | ✓ (asked two questions in one call) |
| UtteranceEnd detection | ✓ |
| Exit keyword detection | ✓ |

### What is NOT working: Railway environment variables

**The problem:** Railway's UI shows 4 service variables (ANTHROPIC_API_KEY, DEEPGRAM_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) but only DEEPGRAM_API_KEY is actually passed to the server at runtime. The other 3 show as MISSING in startup logs.

**What was tried:**
1. Added variables through Railway UI → MISSING
2. Deleted and re-added variables → MISSING
3. Used Raw Editor → MISSING
4. Restarted deployment → MISSING
5. Redeployed → MISSING (some redeploys failed with "context canceled")
6. Clicked "Apply 4 changes" → appeared to trigger deploy but variables still MISSING
7. Hardcoded ANTHROPIC_API_KEY in code → WORKS (proves code is correct)

**Likely cause:** Railway may have a bug with variables not propagating, or the variables are in a different environment scope. The "Apply 4 changes" button suggests Railway knows about uncommitted variable changes but isn't applying them properly.

**For next session:**
- Try deleting the entire Railway service and creating a new one from scratch
- Or try using a `railway.json` or `.env` approach
- Or try a different project (the first project "daring-transformation" was never used)

### Environment variables needed:

| Variable | Where to get it | Status |
|----------|----------------|--------|
| DEEPGRAM_API_KEY | console.deepgram.com → API Keys → "Railway Voice Server" | ✓ Working |
| ANTHROPIC_API_KEY | console.anthropic.com → API Keys → create new | ❌ Not passed to server |
| TWILIO_ACCOUNT_SID | console.twilio.com → dashboard → Account SID | ❌ Not passed to server |
| TWILIO_AUTH_TOKEN | console.twilio.com → dashboard → Auth Token (click Show) | ❌ Not passed to server |

### IMPORTANT: Delete temporary API key
The Anthropic API key `sk-ant-api03-VSpb...KyOF3gAA` was shared in chat for debugging. It MUST be deleted from console.anthropic.com in the next session and a new private key created.

---

## 4. GOOGLE CLOUD CONFIGURATION

### People API
- **Enabled:** ✓ (Google Cloud Console → APIs & Services)
- **OAuth scope added:** `https://www.googleapis.com/auth/contacts` (read + write)
- **Consent screen:** Updated with contacts scope

### OAuth Scopes (full list used by Naavi):
| Scope | Purpose |
|-------|---------|
| gmail.send | Send emails |
| gmail.modify | Read/manage emails |
| calendar.events | Create/read/delete calendar events |
| drive.readonly | Search Google Drive |
| drive.file | Save files to Google Drive |
| contacts | Read AND write Google Contacts |
| contacts.other.readonly | Read "other contacts" (people you've emailed) |
| tasks.readonly | Read Google Tasks for daily brief |

### Important: Two OAuth scope locations in code
- **Web flow:** `lib/calendar.ts` line 55-64 (used by web app)
- **Mobile flow:** `lib/supabase.ts` line 45 (used by Android app)
- **BOTH must be kept in sync** — the mobile flow was missing scopes, causing build 88-89 failures

---

## 5. ACCOUNTS AND SERVICES SUMMARY

| Service | URL / Console | Username |
|---------|--------------|----------|
| Anthropic API | console.anthropic.com | wael.aggan@gmail.com |
| Deepgram | console.deepgram.com | wael.aggan@gmail.com |
| Twilio | console.twilio.com | wael.aggan@gmail.com |
| Google Cloud | console.cloud.google.com (project: naavi-490516) | wael.aggan@gmail.com |
| Supabase | supabase.com (project: hhgyppbxgmjrwdpdubcx) | wael.aggan@gmail.com |
| Railway | railway.app (project: mindful-patience) | GitHub: munk2207 |
| Vercel | vercel.app (naavi-web) | GitHub: munk2207 |
| GitHub | github.com/munk2207 | munk2207 |
| Google Play | play.google.com/console | wael.aggan@gmail.com |
| EAS (Expo) | expo.dev/accounts/waggan | waggan |

---

## 6. REPOSITORY MAP

| Repo | Location | Purpose |
|------|----------|---------|
| Naavi mobile app | `C:\Users\waela\OneDrive\Desktop\Naavi` (worktree: `.claude\worktrees\gifted-volhard`) | Android app (Expo) |
| Naavi build dir | `C:\Users\waela\naavi-mobile` | Clean clone for EAS builds |
| Voice server | `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server` | Twilio voice call server (Railway) |
| Website | `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website\my-naavi-site` | mynaavi.com (Vercel) |
| Web app | `C:\Users\waela\OneDrive\Desktop\Naavi\web` | Old Next.js web app (Vercel) |
| Docs | `C:\Users\waela\OneDrive\Desktop\Naavi\docs` | Test plans, architecture docs |

---

## 7. DECISIONS MADE THIS SESSION

1. **Stability over cost** — always recommend the most reliable option, not the cheapest (saved to feedback memory)
2. **Railway over Fly.io** — better stability, support, and scaling
3. **Deepgram server-side (Option B) over Twilio built-in STT** — strategic, consistent with app, better accuracy with keyterms
4. **Bidirectional Twilio WebSocket** — send audio back through same connection (not call redirect which kills the stream)
5. **Deepgram Aura TTS** — generates mulaw audio compatible with Twilio (not Polly which was used for greeting only)
