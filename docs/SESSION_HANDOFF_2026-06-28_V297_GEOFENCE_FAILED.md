# Session Handoff — 2026-06-28 — V297 Geofence Drive Test Failed

## Active APK
**V297 Staging** — installed 2026-06-27 at 10:50 AM EST  
Install link: https://expo.dev/accounts/waggan/projects/naavi/builds/5a991388-e160-4b4d-b7e4-e604453156b0

---

## What Was Shipped This Session

### Server-side fixes (no APK needed, already live on staging)
1. **Anchor-advance on movement-rejected fires** (`report-location-event`) — Commit `002e966`
2. **Skip movement check on re-arrival after confirmed exit** (`report-location-event`) — Commit `c7b876e`

### Mobile fixes (in V297 APK)
3. **Force=true on all rule create/delete/reactivate sites** (`useOrchestrator.ts`, `alerts.tsx`) — Commits `d0780c0`, `836b20a`
4. **AsyncStorage persistence for throttle** (`useGeofencing.ts`) — Commit `836b20a`
5. **Permission Fix button reliability** (`useGeofencePermissions.ts`) — Commit `05fb1c8`

---

## Primary Focus Next Session: Analyze V297 Drive Failure

### What Happened
Wael drove at 9:00 PM EST June 27. No alert fired.

### Confirmed Facts from Logs (staging DB, user `4906ae5d`)

**Fact 1 — V297 first launched at 10:50 AM EST June 27:**
```
10:50:01  lifecycle-boot
10:50:18  syncGeofences-start
10:50:20  already-in-flight ×5
10:53:20  already-in-flight
17:30:05  already-in-flight
17:30:10  lifecycle-appstate: background
```

**Fact 2 — `syncGeofences-start` was logged at 10:50:18 but `syncGeofences-end` was never logged after it.** Every subsequent sync attempt returned `already-in-flight` until the app went to background at 5:30 PM.

**Fact 3 — Zero events of any kind after 5:30 PM.** No `tsoft-motion-change`, no geofence fires, no server-side events during the 9:00 PM drive.

**Fact 4 — Battery optimization is UNRESTRICTED** (confirmed by screenshot from Wael's device showing Naavi Staging V1.0.297 set to Unrestricted).

**Fact 5 — The `_syncInProgress` flag has a `finally` block** that should always clear it:
```typescript
// hooks/useGeofencing.ts lines 884-889
} finally {
  _syncInProgress = false;
}
```
The flag staying stuck contradicts this `finally` block. The reason is unknown.

**Fact 6 — No `syncGeofences-permissions` or any step log after `syncGeofences-start` at 10:50 AM.** The sync started but produced no further diagnostic output.

---

## What Is Unknown (to be investigated next session)

1. Why did `_syncInProgress` stay stuck despite the `finally` block?
2. Why were there zero Transistorsoft events after 5:30 PM?
3. How far did the 10:50 AM sync get before stopping?

### First Step Next Session
Run this query to see all V297 events at 10:50 AM in full detail:
```javascript
const { data } = await db.from('client_diagnostics')
  .select('created_at, step, payload')
  .gte('created_at', '2026-06-27T14:45:00Z')  // 10:45 AM EST
  .lte('created_at', '2026-06-27T15:05:00Z')  // 11:05 AM EST
  .eq('build_version', 'v1.0.297-297')
  .order('created_at', { ascending: true });
```

---

## Location Rules State (staging DB, end of session)

**Enabled (never fired):**
- `7e8af9a1` — 680 Bayview Dr Woodlawn
- `dcd4263e` — 450 Bayview Dr Woodlawn
- `0b86a45e` — Kemptville Marine
- `272af727` — Toyota Ottawa
- `f8d25abe` — Costco
- `0ee80a8d` — Rona Woodlawn

**Disabled (fired and auto-disabled by one_shot):**
- `08a98ffa` — 500 Bayview Dr Woodlawn (fired 2026-06-27 05:56 AM)
- `f66da3b4` — Office/688 Bayview (fired 2026-06-26 17:24 EST)

---

## CLAUDE.md Reminders
- All builds require explicit Wael approval before starting
- Staging only: project-ref `xugvnfudofuskxoknhve`, package `ca.naavi.app.staging`
- Staging DB key: [REDACTED — rotated 2026-07-17 after being found committed in plaintext; see tests/.env for current key]
- Test user: `4906ae5d` (short) in staging DB
