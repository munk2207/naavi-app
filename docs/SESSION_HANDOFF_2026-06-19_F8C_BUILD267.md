# Session Handoff — 2026-06-19 — F8c + Build 267

## What shipped this session

### F8c — Silent OAuth Scope Probe
- **Problem:** Google's granular permissions lets users accidentally uncheck scopes during sign-in. Features silently fail with no error shown.
- **Solution:** After every SIGNED_IN event, silently probe all 4 Google APIs (Calendar, Gmail, Contacts, Drive) using `session.provider_token`. If any return 401/403, show a one-tap modal: "On the next screen, tap **Select all** and then Continue." Tapping OK re-triggers OAuth automatically.
- **Files changed:**
  - `lib/supabase.ts` — `checkGrantedScopes()` function
  - `app/index.tsx` — SIGNED_IN hook + `showScopePrompt` state + modal JSX + styles
  - `tests/catalogue/session-2026-06-19.ts` — 3 F8c regression tests
- **Test result:** Happy path confirmed on 2 phones (all scopes already granted → no modal). Edge case (modal trigger) requires revoking Supabase access in Google account settings — not tested on production accounts.

### FOUR TEST GATES — CLAUDE.md
Added a formal section documenting all four mandatory test gates in the correct order:
1. Auto-tester (no build needed)
2. Voice regression (no build needed)
3. Maestro (preview APK on emulator)
4. Firebase Test Lab (same APK, cloud devices — most expensive, last)

### Maestro driver persistence fix
- **Problem:** Maestro gRPC server exits after each test run; subsequent runs fail with `UNAVAILABLE`.
- **Fix:** `scripts/run-maestro.ps1` now force-stops `dev.mobile.maestro` + `dev.mobile.maestro.test` before every run, clearing zombie state.
- **Flow 07** (`e2e/07-collapse-expand-toggle.yaml`) created and confirmed passing — catches the V57.9.7 collapse one-way bug.

### Firebase SMS notification
- Updated `NOTIFY_PHONE` from +1 613 769 7957 to **+1 613 879 6681** in both `scripts/submit-firebase-test.js` and `scripts/.env`.

### Build 267
- All 4 gates passed: auto-tester (353/353) → voice regression → Maestro → Firebase Test Lab (✅ Pixel 6 + Samsung S22)
- AAB auto-submitted to Google Play Internal Testing
- Version: V57.59.4 (build 267)

---

## Next session priority — Compound Question Prompt Tuning

**The problem:** Naavi echoes back all tasks the user just gave her before acting. The user already knows what they asked. This kills the marketing impact of compound questions.

**Why it matters:** Compound questions (5-6 tasks in one sentence) are Naavi's #1 marketing differentiator. Wael's demo videos on Samsung S23 + CapCut have performed strongly. Verbose echo-back makes Naavi look slow in video.

**What a good response looks like:**
> "Got it — drafting Sarah's email, booking Bob Monday 11am, Sunday reminder, work list on office arrival, Jasmine June 21st. One question: where should I remind you about James's kids — his home address or somewhere specific?"

**How to start:**
1. Wael runs the compound question test on V267 and pastes the full transcript
2. Review every line of unnecessary repetition
3. Edit `get-naavi-prompt` — compound response rule: confirm in ONE sentence, ONE blocking question, never echo the user's own tasks
4. Deploy, re-test, confirm tight
5. `npm run test:auto` — prompt-regression.ts must stay green

**Files:** `supabase/functions/get-naavi-prompt/index.ts` + `tests/catalogue/prompt-regression.ts`

---

## Test account
All three platforms (auto-tester, Maestro, Firebase) use `mynaavidemo@gmail.com` exclusively.

## Build state
- Main repo: `C:\Users\waela\OneDrive\Desktop\Naavi` (branch: main)
- Build clone: `C:\Users\waela\naavi-mobile` (synced, branch: main)
- Latest commit: see `git log --oneline -5`
