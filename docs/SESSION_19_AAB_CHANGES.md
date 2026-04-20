# Session 19 — V53.3 build 99 mobile AAB change log

**Purpose:** running record of every mobile-side edit going into the AAB bundle
that closes out the Global Search phase. Updated as each step completes.

**Previous build on phone:** V53.2 build 98 DIAG (commit `6707959`).
**This build target:** V53.3 build 99.

## Step A — `lib/lists.ts` category='list'
**Status:** edited (pending commit with the rest of the bundle).
**Change:** `createList()` now passes `{ category: 'list' }` to `save-to-drive`, routing new list Docs into `MyNaavi/Lists/` once the AAB ships.
**Server-side:** already live — `save-to-drive` handles `list` category → `Lists` subfolder + skips documents row (lists adapter is single source of truth).

## Step B — remove orange DIAG readout ✅
**Status:** done.
**File:** `app/index.tsx` (removed block at lines 1435-1446).
**Change:** removed the `DBG inputText[..]: "..."` live readout that shipped in V53.2 build 98 for the digit-strip investigation. Investigation is closed (autocomplete disable was the fix).

## Step C — hands-free cue in deep-link screens ✅
**Status:** already done in prior build; no action needed.
**Files audited:** `app/brief.tsx`, `app/contacts.tsx`, `app/calendar.tsx`.
**Finding:** all three already call `speakCue(text, 'en')` for TTS; `expo-speech` is only retained for `Speech.stop()` on unmount as a cleanup safety. Session 16 handoff said this was pending, but it was migrated somewhere between builds 93 and 98. No code change needed this build.

## Step D — voice verbose readout guard ✅
**Status:** done.
**File:** `hooks/useOrchestrator.ts`.
**Change:** added `origin: 'pre-search' | 'claude-action'` to `turnGlobalSearch`. The tail-append (`In contacts: …`) now only fires when `origin === 'claude-action'`. Pre-search results are already embedded in Claude's reply via the prompt injection at lines 187-193, so Robert no longer hears them twice. Closes the V53 build 96 regression.

## Step E — name save fix ✅
**Status:** already shipped; no action needed.
**Files audited:** `app/settings.tsx` (lines 131-134 load, 295-333 save) + `lib/naavi-client.ts::getUserNameAsync` (line 142).
**Finding:** all four Session 16 fix points are in the current code: `getUserNameAsync` on load, awaited `syncUserNameToSupabase`, Alert on success + Alert on failure, re-fetch from `user_settings` after save. Shipped between builds 93 and 98.

## Step F — version bump ✅
**Status:** done.
**Files:** `app.json` (versionCode 98 → 99), `app/settings.tsx` (version string "MyNaavi — V53.2 (build 98) — DIAG" → "MyNaavi — V53.3 (build 99)").

---

## Post-build checklist

- [ ] `git commit` with a descriptive message
- [ ] `git push origin main`
- [ ] `cd C:/Users/waela/naavi-mobile && git fetch origin && git merge origin/main`
- [ ] `npm install`
- [ ] `npx eas build --platform android --profile production --non-interactive`
- [ ] Download AAB when EAS finishes
- [ ] Upload to Google Play Console → Internal Testing
- [ ] Install on phone, run regression checks
