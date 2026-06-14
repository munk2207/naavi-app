# Session Handoff — 2026-06-14 — v115 — Next Session: APK → AAB

## What was shipped this session (commit `8ce856b`)

All fixes deployed to Supabase Edge Functions. All code committed and pushed to GitHub main.

### 1. Sarah time-alert disambiguation label fix
- **Problem:** "I had trouble saving" error after picking from disambig list — `manage-rules` unique constraint `action_rules_user_label_unique` was failing because the disambig branch never set `_ftPendingParams.label` (fell back to `'Action rule'`).
- **Fix:** `naavi-chat/index.ts` — set `_ftPendingParams.label` before the `if (_ftWithPhone.length > 1)` disambig check; refine the label after pick to replace the generic name with the resolved contact name.
- **Tested:** Wael confirmed "Sarah worked and alert created."

### 2. fmtDtLocal long format fix
- **Problem:** Deepgram read "Sun, Jun" as individual characters ("sune june") because `fmtDtLocal` used `weekday: 'short'`, `month: 'short'`.
- **Fix:** Changed to `weekday: 'long'`, `month: 'long'` → outputs "Sunday, June 14 at 7:15 PM".
- **Tested:** Wael confirmed correct.

### 3. Path B systemic fix — "Here's my best reading" root cause
- **Problem:** The wrapper fired for ALL Path B queries (date/time, simple questions) — not just genuinely uncertain ones.
- **Fix:** Wrapper now only fires when Claude's response contains genuine uncertainty phrases (`I don't have access`, `I can't verify`, etc.). Direct answers pass through clean.
- **Also added:** Date/time bypass — "What is the date today?" answered deterministically before Claude.
- **Tested:** "What is the date today?" → clean answer, no hedge.

### 4. normalizeActionSeparators lowercase fix (ARCH-1 closure)
- **Problem:** Period-separated multi-action messages ("Email Bob at 7 PM. Text Sarah at 7:05 PM") only worked when the second sentence started with a capital letter — Deepgram voice dictation produces all-lowercase so it never matched.
- **Fix:** Removed `(?=[A-Z])` lookahead from the split regex.
- **Tested:** "Email Bob at 7:15 PM say test. Text Sarah at 7:20 PM say test" → both alerts created. ARCH-1 closed.

### 5. MAKE_CALL / outbound-call (F5d)
- **New Edge Function:** `supabase/functions/outbound-call/index.ts` — Twilio REST outbound call, TTS message body via Deepgram.
- **Pre-Claude bypass:** MAKE_CALL intent detected in `naavi-chat` before LLM, confirm card shown.
- **Prompt rules:** Added to `get-naavi-prompt`.
- **Tested:** Wael confirmed "passed perfect."
- **Note:** Mobile confirm card (AAB piece) deferred. Server side fully live.

### 6. alerts.tsx — SMS phone number display
- **Fix:** SMS/WhatsApp alerts now show `to_phone` in the WHAT HAPPENS line.
- **Status:** Committed, requires AAB to ship to phone.

### 7. Holding list updates
- ARCH-1 → Closed Architecture
- F5d → Closed Features
- T3c → added as standalone Tooling OPEN item (voice regression suite)

---

## FIRST THING NEXT SESSION — AAB sequence

### Step 1 — Regression tests (Rule 15a — mandatory)
Add tests to `tests/catalogue/` for:
- Sarah disambig label fix (confirm `label` is set correctly, no unique constraint error)
- `fmtDtLocal` long format (weekday/month are full words)
- Path B fix (date/time query returns clean answer, no "Here's my best reading")
- `normalizeActionSeparators` lowercase (period-separated lowercase → both actions fire)
- MAKE_CALL / outbound-call (intent detected, confirm card shown)

### Step 2 — Run `npm run test:auto`
Must be 100% green (243+ tests). Fix any regressions before proceeding.

### Step 3 — Preview APK (for Firebase Test Lab)
From `C:\Users\waela\naavi-mobile`:
1. `git fetch origin && git merge origin/main`
2. `npm install`
3. `eas build --profile preview`

### Step 4 — Firebase Test Lab
`node scripts/submit-firebase-test.js <apk-url>`
- Devices: Pixel 6 (Android 13) + Samsung Galaxy S22 (Android 14)
- Wait for SMS to +1 613 769 7957
- **MUST verify in Firebase Console** (not just SMS): https://console.firebase.google.com/project/naavi-490516/testlab
- All devices must show ✅ green

### Step 5 — Bump version
In `C:\Users\waela\OneDrive\Desktop\Naavi`:
- `app.json` → bump `versionCode` (check Google Play for next available)
- `app/settings.tsx` → bump version text to match
- Commit + push

### Step 6 — Production AAB
From `C:\Users\waela\naavi-mobile`:
1. `git fetch origin && git merge origin/main`
2. `npx eas build --platform android --profile production --auto-submit --non-interactive`

---

## What is in the AAB (changes not yet on users' phones)

| Change | File |
|--------|------|
| SMS alerts show phone number | `app/alerts.tsx` |
| Keyboard flicker fix | `app.json` (pan→resize) — committed earlier session |
| OAuth refresh_token write-back | `lib/calendar.ts` — committed earlier session |
| TTS address normalization | TTS sanitizer — committed earlier session |
| Re-arm expired location alert (mobile side) | `hooks/useOrchestrator.ts` — committed earlier session |
| DELETE_RULE confirm-before-delete | `hooks/useOrchestrator.ts` — committed earlier session |
| Duplicate client_diagnostics log fix | `app/index.tsx` — committed earlier session |
| Alert-count permission banner removal | `app/alerts.tsx` — committed earlier session |

---

## Current test baseline
- Last known green: 243/243 (before this session's changes)
- Maestro suite: 9/16 (T2a open — emulator state isolation issue, not product bugs)

## Deployed Edge Functions (already live, no AAB needed)
- `naavi-chat` — all session fixes live
- `get-naavi-prompt` — MAKE_CALL rules live
- `outbound-call` — new, live
