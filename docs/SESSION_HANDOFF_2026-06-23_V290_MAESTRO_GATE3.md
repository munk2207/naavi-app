# Session Handoff — 2026-06-23 — V290 Maestro Gate 3 In Progress

## Active APK on Emulator
**V290** (versionCode 290, preview profile, production Supabase `hhgyppbxgmjrwdpdubcx`)
- Package: `ca.naavi.app`
- `EXPO_PUBLIC_TEST_LOGIN_ENABLED=true` baked in
- Auto sign-in useEffect: signs in as `mynaavidemo@gmail.com` / `MaestroTest2026!#` on startup if no session
- Background sync (`runSync`) is SKIPPED when `EXPO_PUBLIC_TEST_LOGIN_ENABLED=true`
- V290 is already installed on the emulator — DO NOT rebuild unless absolutely necessary

## Where We Are in the Release Gate Sequence
| Gate | Status |
|------|--------|
| 1 — Auto-tester (`npm run test:auto`) | ✅ Green |
| 2 — Voice regression | ✅ Green |
| 3 — Maestro UI flows | ❌ In progress — see below |
| 4 — Firebase Test Lab | Not started |
| Production AAB | Not started |

## Maestro Gate 3 — Current State

### Best run so far: `biyxa4oao` (7/18 passing)
```
[Passed] 00 – sign-in via Test Lab button
[Passed] 01 – smoke launch (home brief renders)
[Passed] 03 – typed → voice → typed (mode-switch state)
[Passed] 04 – voice record → stop → transcribe
[Passed] 05 – force-close survives auth
[Passed] 14 – Lists screen + All/Attached/Standalone tabs
[Passed] 17 – Settings multi-phone primary + backup list
```

### Last run: `bj0f12opp` (2/18 passing — regression)
Regressed because of Supabase rate-limiting: each flow calls `runFlow: 00-sign-in.yaml` at the top, which does `clearState` + auto sign-in. 18 flows × clearState = 18 consecutive `signInWithPassword` calls → Supabase rate-limits by flow 3-4 → "Ask MyNaavi" never appears → flows time out.

Additionally, the emulator crashed partway through (flows 13-17 showed 0s / "Unable to launch app").

## Root Cause of ALL Maestro Failures

**One root cause: each flow calls `clearState` (via `runFlow: 00-sign-in.yaml`) independently, triggering a fresh sign-in each time. Supabase rate-limits consecutive `signInWithPassword` calls.**

### Fix (YAML-only, no new APK):
Remove `runFlow: 00-sign-in.yaml` from the top of every flow EXCEPT flow 00. Instead:
- Flow 00 does clearState + sign-in once
- All other flows launch with `clearState: false` (reuse session from AsyncStorage)
- `signInWithPassword` is called only ONCE per full Maestro run

This means flows 01-17 should start with:
```yaml
- launchApp:
    clearState: false
- extendedWaitUntil:
    visible:
      text: "Ask MyNaavi"
    timeout: 15000
```
...instead of `- runFlow: 00-sign-in.yaml`.

## Known Remaining Assertion Issues (after rate-limit fix)

These flows have assertion problems independent of the sign-in issue:

| Flow | Assertion | Issue |
|------|-----------|-------|
| 07, 09 | `"tap to expand"` not visible | After `tapOn: "Collapse Chat"`, the collapsed bar text is "＋ N messages — tap to expand". May need longer wait or exact text match |
| 08 | `"LIST CREATED"` not visible | Naavi may ask clarifying question instead of creating; check prompt behavior for `mynaavidemo@gmail.com` |
| 10 | `"Settings"` not visible | Coordinate tap `95%,9%` opened menu but 5s timeout for "Settings" to appear may be too short; increase to 10s |
| 11 | `"SMS DRAFT READY"` not visible | 60s timeout may still be too short; or draft card text label is different |
| 12 | `"Say a number"` not visible | Walmart picker may not fire for `mynaavidemo@gmail.com` (no location context) |
| 13 | `"meeting?"` not visible | User bubble text not in accessibility tree; or response > 30s |
| 15 | `"Items"` not visible | List detail screen may use different section label |
| 16 | `"Alerts"` not visible | Menu tap issue (same as flow 10) |

## Key Files Changed This Session

### `app/index.tsx`
1. Auto sign-in useEffect (before auth resolution useEffect, ~line 930):
```tsx
useEffect(() => {
  if (process.env.EXPO_PUBLIC_TEST_LOGIN_ENABLED !== 'true') return;
  supabase.auth.getSession().then(({ data }) => {
    if (!data.session) {
      supabase.auth.signInWithPassword({
        email: 'mynaavidemo@gmail.com',
        password: 'MaestroTest2026!#',
      });
    }
  });
}, []);
```
2. Background sync skipped in test mode (~line 1182):
```tsx
if (process.env.EXPO_PUBLIC_TEST_LOGIN_ENABLED !== 'true') {
  runSync();
  const syncInterval = setInterval(runSync, 60 * 1000);
  return () => clearInterval(syncInterval);
}
```
3. Test credentials: `mynaavidemo@gmail.com` / `MaestroTest2026!#`

### `e2e/00-sign-in.yaml`
```yaml
- clearState
- launchApp
- extendedWaitUntil:
    visible:
      text: "Ask MyNaavi"
    timeout: 70000
- takeScreenshot: 00-sign-in-complete
```

### `scripts/submit-firebase-test.js`
GCS filename set to `naavi-v287.apk` (line 354) — update when running Firebase Test Lab.

### `app.json` + `app/settings.tsx`
Version: 1.0.290 / versionCode 290 / "V57.67.0 (build 290)"

## Test Account
- Email: `mynaavidemo@gmail.com`
- Password: `MaestroTest2026!#`
- Supabase project: **production** (`hhgyppbxgmjrwdpdubcx`)
- user_id: `1dd01ef2-98d0-4ad0-aebc-ed4f878d7c53`
- This account was confirmed to exist on production. The preview APK connects to production (no staging URL override in eas.json preview profile).

## Next Session Priority — Fix Maestro on V290

### Step 1: Rework all flows to sign-in once (root fix)
For flows 01-17: replace `- runFlow: 00-sign-in.yaml` with:
```yaml
- launchApp:
    clearState: false
- extendedWaitUntil:
    visible:
      text: "Ask MyNaavi"
    timeout: 15000
```
Exception: flow 00 keeps clearState — it IS the sign-in flow.

### Step 2: Fix individual assertion issues
Go through flows 07, 08, 09, 10, 11, 12, 13, 15, 16 one by one after Step 1 succeeds.

### Step 3: Run Maestro, get 18/18
```powershell
cd "C:\Users\waela\OneDrive\Desktop\Naavi"
powershell.exe -File scripts/run-maestro.ps1
```

### Step 4: Firebase Test Lab (Gate 4)
```
node scripts/submit-firebase-test.js <APK-URL>
```
V290 preview APK URL from EAS — get from expo.dev/accounts/waggan.

### Step 5: Production AAB
Only after Gates 3 and 4 are both green.

## Emulator State
- V290 is installed. Emulator crashed at end of last session.
- Before starting next session: boot emulator, confirm V290 is installed (`adb shell dumpsys package ca.naavi.app | grep versionCode`).
- DO NOT install a new APK without Wael's approval.
