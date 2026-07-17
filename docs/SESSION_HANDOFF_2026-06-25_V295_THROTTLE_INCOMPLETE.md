# Session Handoff — 2026-06-25 — V295 APK, Throttle Fix Incomplete

## Status
- V295 staging APK built and drive-tested. Geofences fire (phantom suppression fixed). NO production AAB.
- One open bug remaining before production AAB is allowed.

## What Was Shipped This Session
- `hooks/useGeofencing.ts`: Added `MIN_SYNC_INTERVAL_MS = 5 min` + `_lastSyncCompletedAt` throttle guard
- `hooks/useGeofencing.ts`: `syncRules()` calls with `force: true` to bypass throttle
- `app.json` / `app/settings.tsx`: versionCode 294 → 295, label V57.69.0
- `mynaavi-website/discover/start.html`: Added Step 6 (battery unrestricted), removed audio bar, renumbered to 12 steps
- `supabase/functions/resolve-place/index.ts`: Directional ambiguity (N/S/E/W) fix — **deployed to staging only, NOT production**
- `supabase/functions/tsoft-geofence-webhook/index.ts`: Deployed to both staging and production (was 404 before)

## Open Bug — WHY NEXT SESSION STARTS HERE

**The 5-min re-sync throttle is NOT working on V295 staging APK.**

From staging diagnostics (6:13–6:15 PM EST), `syncGeofences-start` + `syncGeofences-end` cycle every 1-2 seconds, same as before the fix. The `reason: "too-soon"` log never appears. `_lastSyncCompletedAt` is being set but the guard is immediately bypassed.

**Root cause not yet confirmed.** Two hypotheses to investigate:
1. Something is calling `syncGeofencesForUser(userId, { force: true })` on every cycle (e.g. a `tsoft-geofences-change` SDK callback triggering `syncRules()`)
2. The module-level `_lastSyncCompletedAt` is being reset between calls (React Native module reload)

**Where to look first:** search `hooks/useGeofencing.ts` for any `BackgroundGeolocation.onGeofencesChange` listener or any other callback that calls `syncGeofencesForUser` or `syncRules()`. If such a listener exists and calls `syncRules()` (which passes `force: true`), that is the cause.

## Drive Test Results (8:47 PM EST)
- One T1 fired: rule `9177c027` (8040 Jeanne-d'Arc N, lat 45.4851977, radius 300m)
- Native HTTP: status 200 ✅ — alert delivered
- "Fired at 8210" observation: T1 fired at 8:47:54, SMS arrived ~5-10s later. Location at delivery time not confirmed from logs.
- 8184 rule did NOT fire during this drive
- Both staging rules are now DISABLED by Wael

## Credentials Needed Next Session
- Staging service role key: [REDACTED — rotated 2026-07-17 after being found committed in plaintext; see tests/.env for current key]
- Staging project ref: `xugvnfudofuskxoknhve`
- Production service role key: [REDACTED — rotated 2026-07-17 after being found committed in plaintext; see tests/.env for current key]

## Pending After Throttle Fix
- Build new staging APK (V296) and drive-test
- Only after Wael confirms staging passes: build production AAB
- Deploy `resolve-place` directional fix to production (currently staging only)
