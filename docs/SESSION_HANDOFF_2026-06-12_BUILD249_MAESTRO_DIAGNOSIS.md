# Session Handoff — 2026-06-12 — Build 249 — Maestro Diagnosis

## State at session end

| Item | Status |
|---|---|
| AAB on Google Play | **Build 247** |
| APK installed on emulator | **Build 249** (V57.49.9) |
| Auto-tester | 251/251 ✅ |
| Firebase Test Lab | ✅ PASSED |
| Maestro | ❌ 17/17 failed — 3 fix attempts made, all failed |

---

## Failed attempts this session

### Attempt 1 — Changed clearState to true in all 17 YAMLs ❌
**What happened:** Wiped the auth session. App opened to Google sign-in screen. Maestro could not complete the OAuth flow. All 17 tests failed.
**Reverted.**

### Attempt 2 — Added pressKey: Back after launchApp in all 17 YAMLs ❌
**What happened:** When the app was already on the home screen, pressing Back exited the app entirely. "MyNaavi" not visible because the app was closed. All 17 tests failed.
**Reverted.**

### Attempt 3 — Added router.replace('/') in app/_layout.tsx + built APK 249 ❌
**What happened:** App is now on home screen when launched. But test 01 still fails "MyNaavi is not visible" because the header renders "MyNaavi" as two separate Text nodes ("My" + "Naavi") — Maestro cannot match across two nodes. Tests 02+ fail because Maestro taps the three-dot menu instead of "Message input" due to a timing issue. 17/17 failed.
**This code change remains in APK 249 — not reverted.**

---

## What is known about the current failures

- The home screen IS loading correctly — confirmed from screenshots
- "MyNaavi" in the header is split into `"My"` + `"Naavi"` in two separate Text components in `app/_layout.tsx`
- There is a timing gap between `launchApp` and when the home screen finishes rendering
- `accessibilityLabel="Message input"` is correctly set at `app/index.tsx:2360`
- The emulator has APK 249 installed with `mynaavidemo@gmail.com` signed in and all Google services connected

---

## Version state

| | Build | versionCode | Version |
|---|---|---|---|
| **AAB (Google Play)** | 247 | 247 | V57.49.7 |
| **APK on emulator** | 249 | 249 | V57.49.9 |
| **Next AAB** | 250 | 250 | V57.49.10 |
