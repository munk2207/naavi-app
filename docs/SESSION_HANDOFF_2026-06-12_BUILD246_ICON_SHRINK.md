# Session Handoff — 2026-06-12 — Build 246 Icon Shrink

## Status at session end

- **Build 246 code is pushed to GitHub** (`553d646`) but the EAS build has NOT been started yet.
- **Build 245** was submitted to EAS earlier this session (build ID `4cba1b20`) — unknown if it completed.

## What happened this session

1. Reviewed holding list bugs B6i, B7a, B7b, B7c — all tested by Wael and closed (did not reproduce).
2. Fixed B7a — removed duplicate `remoteLog` AppState listener from `app/index.tsx`.
3. Build 245 submitted to EAS with 8 fixes (B7a, soft-delete, B6a, B6h, B3z, B4f, B6c, new icon).
4. Google Cloud service account key rotated — old key deleted, new key in `tmp/naavi-service-account.json` (gitignored).
5. `tmp/` scrubbed from git history via `git filter-branch` + force push.
6. **Build 246** — icon shrunk to 75% of canvas with black padding (`scripts/shrink-icon.js`). Version bumped, pushed to GitHub.

## What needs to happen next session

### Step 1 — Check build 245 status
Go to https://expo.dev/accounts/waggan/projects/naavi/builds and check if build 245 finished and was submitted to Google Play.

### Step 2 — Launch build 246 from naavi-mobile
Run these commands **one at a time** in PowerShell from `C:\Users\waela\naavi-mobile`:

```
git fetch origin
git reset --hard origin/main
npm install
npx eas build --platform android --profile production --auto-submit --non-interactive
```

### Step 3 — Firebase Test Lab (Rule 15b)
After EAS produces an APK (preview build), submit to Firebase Test Lab:
```
node scripts/submit-firebase-test.js <apk-url>
```
Verify results at: https://console.firebase.google.com/project/naavi-490516/testlab

### Step 4 — Install build 246 from Google Play Internal Testing

## Build 246 changes (vs 245)
- App icon shrunk to 75% of canvas with black padding (brain was filling entire icon area on-device)
- `assets/icon.png` and `assets/adaptive-icon.png` updated
- `scripts/shrink-icon.js` added for future icon adjustments
- Version: 1.0.246 / versionCode 246 / V57.49.6

## Build 245 changes (for reference)
1. B7a — duplicate remoteLog AppState listener removed from `app/index.tsx`
2. Soft-delete alerts — `op=deactivate`, row stays greyed with Reactivate button
3. B6a — `reArmLocationRule` merges `action_config` note on re-arm
4. B6h — pre-Claude delete-intent intercept in `hooks/useOrchestrator.ts`
5. B3z — OAuth refresh_token rotation fix at `lib/calendar.ts:154`
6. B4f — `sanitiseForSpeech` TTS address normalization
7. B6c — keyboard flicker fix (`app.json` `"resize"` + KAV disabled)
8. New app icon — centered brain logo with dark circular background

## Tests
- 251/251 auto-tests green (last confirmed this session before build 245)
- Rule 15b (Firebase Test Lab) not yet run for build 245 or 246

## Key files changed this session
- `app/index.tsx` — B7a fix (duplicate listener removed)
- `assets/icon.png` + `assets/adaptive-icon.png` — icon updated
- `assets/icon-draft.png` — preview of shrunk icon
- `scripts/shrink-icon.js` — icon resize script
- `app.json` — version 1.0.246, versionCode 246
- `app/settings.tsx` — V57.49.6 (build 246)
- `.gitignore` — `/tmp/` added
- `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` — B6i, B7a, B7b, B7c moved to closed

## Closed this session
- B6i — tested, did not reproduce
- B7a — fixed (duplicate AppState listener) + closed
- B7b — tested, did not reproduce
- B7c — tested, did not reproduce
