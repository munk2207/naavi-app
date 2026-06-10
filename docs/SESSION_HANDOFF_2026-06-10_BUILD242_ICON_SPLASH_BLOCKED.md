# Session Handoff — 2026-06-10 — Build 242 BLOCKED: Icon + Splash

## Status: BLOCKED — APK build failing, not shipped

---

## What was completed this session

### B6h — DELETE_RULE silent failure — ✅ SHIPPED (code only, no APK yet)
- Claude was saying "Done — alert deleted" without actually deleting
- Fix: pre-Claude intercept in `hooks/useOrchestrator.ts`
  - Added `DELETE_ALERT_RE` regex to catch delete intent before Claude
  - Added `pendingConfirmDeleteRef` for confirm-then-delete flow
  - Added `POSITIVE_RE` for recognizing user confirmation
- Tests: `tests/catalogue/session-2026-06-10.ts` — 4 tests, all green
- 238/238 auto-tests green ✅

### Icon fix — ✅ COMMITTED (needs APK to verify)
- Adaptive icon: teal brain, black background, proper padding from circle edge
- Assets: `assets/icon.png`, `assets/adaptive-icon.png` updated
- `app.json` has `android.adaptiveIcon` block with `backgroundColor: "#0D0D0D"`

---

## The blocker — EAS build failing

Every build this session failed. **7 builds attempted, 0 succeeded.**

### What the error says
`Gradle build failed — createReleaseUpdatesResources — The resource /home/expo/workdir/build/index was not found`

### What was tried and ruled out
| Change | Result |
|--------|--------|
| expo-splash-screen plugin in plugins array | Removed — still failed |
| `"splash"` block in app.json | Removed — still failed |
| expo-splash-screen in package.json | Removed — bundle phase then failed |
| SplashScreen import/calls in _layout.tsx | Removed — still failed (Gradle) |

### Current state of app.json
- Has `"icon": "./assets/icon.png"` ← added this session
- Has `android.adaptiveIcon` ← added this session  
- NO `"splash"` block ← removed this session
- NO expo-splash-screen in package.json ← removed this session
- NO SplashScreen import in `app/_layout.tsx` ← removed this session

### Last working build
- Commit: `416f768` in `naavi-mobile`
- Build 241 — preview APK — worked fine
- At that commit: no `"icon"`, no `adaptiveIcon`, no splash anything

### What we do NOT know yet
The confirmed root cause of why adding `"icon"` + `adaptiveIcon` to app.json triggers the Gradle failure. The log fetching was not completed before session ended.

---

## Priority for next session

### PRIORITY 1 — Confirm root cause BEFORE any build

Deploy research agent with this exact question:

> "Build 241 (commit 416f768 in naavi-mobile) worked. Current builds fail at Gradle `createReleaseUpdatesResources`. The ONLY difference in app.json between build 241 and now is: `"icon": "./assets/icon.png"` and `android.adaptiveIcon` were added. expo-splash-screen package and splash block were added then removed. SplashScreen import in _layout.tsx was added then removed.
> 
> Fetch the actual Gradle log from EAS build `419fff9a-4562-49d5-b3ee-8ceccb114d7e` using `npx eas build:view --json` to get the signed log URL, then download and grep for FAILED/Error/Exception lines. Find the exact root cause. Do NOT suggest fixes until root cause is confirmed with log evidence."

### PRIORITY 2 — Ship icon + splash in ONE build

The goal is one APK that has:
1. **App icon**: teal brain, black background, space from circle edge ← code is done
2. **Custom splash screen**: black background, teal brain, "MyNaavi" text ← NOT done

For splash, the research agent must answer:
> "expo-splash-screen is the correct package for Expo custom splash screens. But adding it as a direct dependency this session broke the Gradle build. Why? And what is the correct way to configure a custom splash screen in this Expo SDK 55 + expo-updates setup without breaking createReleaseUpdatesResources?"

### PRIORITY 3 — After APK passes: Firebase Test Lab + Production AAB

Full gate: `npm run test:auto` green → Firebase Test Lab PASSED → production AAB.

---

## Current git state (main repo)

Last commit: `d6c523c` — "remove expo-splash-screen import and calls from _layout.tsx"

Changes since build 241:
- `hooks/useOrchestrator.ts` — B6h delete fix
- `tests/catalogue/session-2026-06-10.ts` — 4 new tests
- `tests/runner.ts` — new tests registered
- `app.json` — icon + adaptiveIcon added; splash block removed
- `package.json` / `yarn.lock` — expo-splash-screen added then removed
- `app/_layout.tsx` — SplashScreen lines added then removed
- `assets/icon.png`, `assets/adaptive-icon.png`, `assets/splash.png` — updated

---

## Rule for next session

**No build until research agent confirms root cause with log evidence.**  
No hunches. No "let's try removing X." Find the cause first.
