# Session Handoff — 2026-06-12 — Build 249 — Maestro Diagnosis

## State at session end

| Item | Status |
|---|---|
| AAB on Google Play | **Build 247** |
| APK installed on emulator | **Build 249** (V57.49.9) |
| Auto-tester | 251/251 ✅ |
| Firebase Test Lab | ✅ PASSED |
| Maestro | ❌ Still failing — root causes now known |

---

## What was done this session

### Changes committed
- `app/_layout.tsx` — added `router.replace('/')` on mount so app always starts at home screen on cold launch
- `e2e/*.yaml` — `clearState: true` tried and reverted (wipes auth session)
- `e2e/*.yaml` — `pressKey: Back` tried and reverted (exits app when already on home)
- All 17 YAMLs now back to `stopApp` + `launchApp: clearState: false` — clean state

### APK 249 installed on emulator
- OAuth completed with `mynaavidemo@gmail.com`
- All Google services connected: Gmail ✓ Calendar ✓ Drive ✓ Maps ✓
- App confirmed working manually

---

## Root causes of Maestro failures — CONFIRMED FROM SCREENSHOTS

### Problem 1 — "MyNaavi" split text (test 01)
The header in `app/_layout.tsx` renders "MyNaavi" as TWO separate Text nodes:
```tsx
<Text style={headerStyles.white}>My</Text>
<Text style={headerStyles.teal}>Naavi</Text>
```
Maestro's `assertVisible: text: "MyNaavi"` looks for a single text node containing "MyNaavi" — finds nothing — test fails.

**Fix:** Change `assertVisible: text: "MyNaavi"` to `assertVisible: text: "TODAY'S BRIEF"` in `e2e/01-smoke-launch.yaml`. No APK needed.

### Problem 2 — Timing: navigation not complete before assertions run
`router.replace('/')` runs AFTER expo-router restores the last screen (Settings). There is a brief window where Settings is still showing when Maestro's first assertion runs.

**Fix:** Add `waitForAnimationToEnd` after `launchApp` in all 17 YAMLs. No APK needed.

### Problem 3 — Three-dot menu opens during test 02
When test 02 tries `tapOn: label: "Message input"` and times out finding it (because of the timing issue above), Maestro taps the three-dot menu button instead. This causes all subsequent tests to fail in cascade.

**Fix:** Solved by fixing Problem 2 (timing). Once the home screen is confirmed loaded, "Message input" will be found correctly.

---

## Next session — what to do

All fixes are YAML-only. No new APK needed.

### Step 1 — Fix test 01 YAML
In `e2e/01-smoke-launch.yaml`, replace:
```yaml
- assertVisible:
    text: "MyNaavi"
```
with:
```yaml
- assertVisible:
    text: "TODAY'S BRIEF"
```
(Remove the duplicate — "TODAY'S BRIEF" is already asserted below it, so just delete the "MyNaavi" line.)

### Step 2 — Add waitForAnimationToEnd to all 17 YAMLs
After `launchApp: clearState: false` in every file, add:
```yaml
- waitForAnimationToEnd
```
This gives `router.replace('/')` time to complete before any assertions run.

### Step 3 — Run Maestro
```
maestro --device emulator-5554 test e2e/
```

### Step 4 — After Maestro is clean
1. Firebase Test Lab on APK 249
2. Build AAB 250 (production) — auto-submit to Google Play

---

## Version state

| | Build | versionCode | Version |
|---|---|---|---|
| **AAB (Google Play)** | 247 | 247 | V57.49.7 |
| **APK on emulator** | 249 | 249 | V57.49.9 |
| **Next AAB** | 250 | 250 | V57.49.10 |
