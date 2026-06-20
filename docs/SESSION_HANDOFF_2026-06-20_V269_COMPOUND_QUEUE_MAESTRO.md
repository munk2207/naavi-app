# Session Handoff — 2026-06-20
## Compound Queue (v269) + Maestro Infrastructure Fix
**Branch:** main | **Build:** v1.0.269 (versionCode 269) | **Tests:** 353/353 green

---

## What Was Shipped

### AAB v269 — AUTO-SUBMITTED TO GOOGLE PLAY INTERNAL TESTING
- EAS Build ID: `cf8ef70f-6d7a-4fac-8648-9586f8438769`
- Submission: `94d140a8-c3d7-404b-9ff1-9fd6aeeeac3d`
- Gates passed: ✅ Auto-tester 353/353 | ✅ Voice regression | ⛔ Maestro (suspended) | ⛔ Firebase (suspended)

### Bug 1 FIXED (DraftCard Send stops compound queue)
- **File:** `hooks/useOrchestrator.ts` — `confirmPending()` function (~line 4192)
- **Fix:** After DraftCard Send executes and speaks result, calls `advanceCompoundQueue(language)` if queue is non-empty
- **Test:** `tests/catalogue/session-2026-05-27.ts` — covers this

### Bug 2 NOT FIXED (re-narration after "Yes")
- **Symptom:** After user types "Yes" to the compound list, Naavi responds "On it. First — I'll draft an email... Next — ..." (full re-narration of all 6 items)
- **Prompt fix attempted:** Added Rule 24 point 6 to `get-naavi-prompt` — "CONFIRMATION TURN — respond with ONLY 'On it.'" — **did not work**. Claude says "On it." then narrates anyway.
- **Root cause being investigated:** The "Yes" appears to be reaching Claude (Claude generates the re-narration text visible in chat). This should NOT happen — if `pendingActionRef.current` is set when user types "Yes", the AFFIRMATIVE_RE path at line 927 intercepts it and never routes to Claude.
- **Investigation stopped at:** Tracing whether `pendingActionRef.current` is actually set when the compound list is initially presented (action[0] is DRAFT_MESSAGE). Code at lines 4088-4091 sets it, but something may be clearing it or the "Yes" may be arriving before it's set.
- **Correct fix (not yet implemented):** Client-side intercept — when `compoundQueueRef.current.length > 0` AND user says "Yes" AND `pendingActionRef.current` is null, bypass Claude entirely, speak "On it.", and call `advanceCompoundQueue()`. This eliminates the Claude round-trip for the initial "Yes" response.

### PROMPT_VERSION
- Current deployed: `'2026-06-20-v127-compound-no-repeat'`
- Rule 24 point 6 added (weak — insufficient to stop re-narration)

### Gate Suspension (CLAUDE.md updated)
- **Gate 3 (Maestro) — SUSPENDED** as of 2026-06-20
  - Root cause: emulator snapshot has system Google account but NOT an active in-app OAuth session for `mynaavidemo@gmail.com`
  - Flows using `clearState: true` clear the app session → app shows login screen, not home
  - `signInWithGoogle()` on emulator: after account selection, returns to app home instead of completing OAuth
  - Wael explicitly flagged: do NOT assume SHA-1 mismatch — investigate the OAuth callback path (`app/_layout.tsx` deep link handler)
- **Gate 4 (Firebase) — SUSPENDED** as of 2026-06-20
- All e2e/ Maestro files reverted to pre-session state (commit `42ad4e1`)

---

## Next Session Priority (in order)

### PRIORITY 1 — Fix compound queue re-narration bug (v269 failure)
1. Investigate why "Yes" routes to Claude when it should be caught client-side
   - Check: is `pendingActionRef.current` null when user says "Yes" to the initial compound list?
   - Check: what is `status` at that moment? If it's `'speaking'` the send() at line 910 calls `stopSpeaking()` but continues — does that affect pendingActionRef?
   - Likely fix location: `send()` in `hooks/useOrchestrator.ts` around line 925
2. Implement client-side bypass: if compoundQueueRef has items AND user says "Yes" AND pendingActionRef is null → speak "On it.", call `advanceCompoundQueue()`, return
3. Test full 6-action compound queue on real device

### PRIORITY 2 — Fix Maestro emulator OAuth (dedicated session)
The investigation Wael asked for (interrupted by compaction):
1. Read `app/_layout.tsx` — find where `auth/callback` deep link is handled
2. Read `lib/supabase.ts` `signInWithGoogle()` (lines 153-178) — uses `Linking.openURL(data.url)`, `skipBrowserRedirect: true`
3. The deep link `naavi://auth/callback` must be registered and handled. On emulator, after Google account selection, the system browser does not redirect back to the app. Investigate:
   - Is the deep link scheme registered in `app.json`?
   - Does the emulator's Android version handle custom scheme redirects from Chrome correctly?
   - Is `mynaavidemo@gmail.com` registered in Google Cloud OAuth (authorized redirect URIs include `naavi://auth/callback`)?
4. Fix the emulator sign-in flow so snapshot can capture active in-app session
5. Re-enable Gate 3, retake snapshot with logged-in `mynaavidemo@gmail.com` session

---

## Key File Locations

| File | What changed |
|------|-------------|
| `hooks/useOrchestrator.ts` | Bug 1 fix: `confirmPending()` calls `advanceCompoundQueue` |
| `supabase/functions/get-naavi-prompt/index.ts` | PROMPT_VERSION v127, Rule 24 point 6 added |
| `tests/catalogue/session-2026-05-27.ts` | Version check updated to v127 |
| `tests/catalogue/session-2026-05-28.ts` | Version check updated to v127 |
| `app.json` | versionCode 269, version "1.0.269" |
| `app/settings.tsx` | Build label "(build 269)" |
| `CLAUDE.md` | Gates 3+4 suspension documented |
| `e2e/*.yaml` | ALL reverted to pre-session state (commit `42ad4e1`) |

---

## Test Results at Close
- Auto-tester: **353/353 green**
- Voice regression: **passed**
- Maestro: **suspended**
- Firebase: **suspended**

## Commit at Close
Run `git log --oneline -5` to see current HEAD.
