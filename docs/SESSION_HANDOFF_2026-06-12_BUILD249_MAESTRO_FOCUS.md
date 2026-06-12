# Session Handoff — 2026-06-12 — Build 249 — Next Session: Maestro

## Status at session end

| Item | Status |
|---|---|
| AAB on Google Play | **Build 247** |
| APK building now | **Build 249** (EAS job in flight — check expo.dev/accounts/waggan/projects/naavi/builds) |
| Auto-tester | 251/251 ✅ |
| Firebase Test Lab | ✅ PASSED (matrix-2mnf3uu9jxwqy, 2 devices, no issues) |
| Maestro | ❌ Not clean — see below |

---

## What was shipped this session

### Tap-to-send — 3 attempts

| Build | Approach | Result |
|---|---|---|
| 247 | `multiline` removed from TextInput (Enter sends) | ✅ Works |
| 248 | Outer `View` with `onStartShouldSetResponder` | ❌ Same 3-dot loop as TouchableWithoutFeedback |
| **249** | `onPress` on existing inner `Pressable` (inside `KeyboardAwareScrollView`) | **Not yet tested — APK building** |

**Why 249 is correct:** The Pressable at `app/index.tsx:1725` already wraps all chat content inside the ScrollView. Adding `onPress` to it means child buttons claim their own touches (responder system), only empty-space taps reach the outer `onPress`. No outer wrapper needed. With `keyboardShouldPersistTaps="handled"` on the ScrollView, the Pressable's `onPress` still fires because it IS a handled interactive element.

### Maestro YAML fixes (all 9 tests updated)
- Added `stopApp` before `launchApp` in **every test** (01–09) — prevents cascading failures when app is in wrong state
- Increased all Claude-response timeouts from **15 000 ms → 30 000 ms**
- These changes are in the e2e/ folder, committed and pushed — no APK needed for them

### Voice tick gap
- `startMusic()` now plays for ALL call types including morning brief at call start
- Committed in prior session (builds 246–247)

### Parity audit
- `docs/MOBILE_VS_VOICE_PARITY_AUDIT_2026-06-12.md` created — full capability table
- CLAUDE.md Rule 19 added: parity doc must be updated with every new capability

### Holding list
- T3c merged into ARCH-1
- T4b (parity audit) — CLOSED 2026-06-12 (doc created)
- T4c (tick gap) — CLOSED 2026-06-12 (fixed)
- T2b (demo data seeded) — CLOSED 2026-06-12

---

## Version state — DO NOT MIX

| | Build | versionCode | settings.tsx |
|---|---|---|---|
| **AAB (Google Play)** | 247 | 247 | V57.49.7 |
| **APK building** | 249 | 249 | V57.49.9 |

Build 248 was a preview APK only (versionCode 248 used). Next AAB must use versionCode **250** or higher.

---

## Next session — Maestro focus

### What to do

1. **Wait for APK 249** — check EAS for the build URL, install on emulator (uninstall 248 first if needed since versionCode 249 > 248, upgrade install should work)
2. **Run Maestro full suite:**
   ```
   maestro --device emulator-5554 test e2e/
   ```
3. **Expected behavior:** Every test starts with `stopApp` + `launchApp`, so previous state doesn't matter. App always starts fresh from home screen.

### Known Maestro failures to triage

From build 248 run (the 3-dot loop was caused by the outer View responder — removed in 249):

| Test | Last known failure | Expected in 249 |
|---|---|---|
| 01 | App on Settings screen, "MyNaavi" not visible | Fixed — stopApp added |
| 02 | Claude response >15s timeout | Should fix — timeout now 30s |
| 03–09 | Cascade from 01/02 | Should fix — stopApp isolates each test |

### If tests still fail after installing 249

**Diagnosis order:**
1. Does test 01 pass? (smoke launch — just checks home screen visible) → If not, something is wrong with the app launch itself
2. Does test 02 pass? (5 sends) → If not, is it a timeout issue or an element-not-found issue?
3. For element-not-found: check accessibilityLabel values. "Message input" must match the TextInput's `accessibilityLabel` prop. "Send" must match the send button's `label` prop.

**Tap-to-send:** After Maestro passes, test manually on emulator — type something, tap empty chat area. Should send. This confirms the inner Pressable fix works.

### After Maestro is clean

1. Confirm tap-to-send works on device
2. Run Firebase Test Lab on APK 249
3. Build AAB 250 (production) — auto-submit to Google Play
4. Close T2a in holding list

---

## Files changed this session

| File | Change |
|---|---|
| `app/index.tsx` | Removed `multiline` from TextInput; removed outer View responder; added `onPress` to inner chat Pressable |
| `app/settings.tsx` | V57.49.9 (build 249) |
| `app.json` | version 1.0.249, versionCode 249 |
| `e2e/01-09 *.yaml` | `stopApp` before every test; timeouts 15s→30s |
| `docs/MOBILE_VS_VOICE_PARITY_AUDIT_2026-06-12.md` | NEW — full parity table |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | T3c removed, T4b/T4c/T2b closed |
| `CLAUDE.md` | Rule 19 added (parity doc stays live) |
| `naavi-voice-server/src/index.js` | `startMusic()` for all call types including morning brief |

---

## Holding list open items (for reference)

- **T2a** — Maestro full suite (close after next session confirms clean)
- **F2a, F2b, F5b** — Open for redesign decisions (dedicated sessions)
- **ARCH-1** — Voice regression suite + structured outputs (4–6 hour dedicated session)
- Parity gaps: voice re-arm expired alert, SPEND_SUMMARY, LOG_CONCERN/UPDATE_PROFILE; mobile UPDATE_MORNING_CALL
