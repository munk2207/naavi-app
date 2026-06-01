# Session Handoff — 2026-06-01 | Build 223

## What Shipped

### Build 223 (V57.36.0) — AAB + APK
- **Code identical to build 220.** This is a pure revert.
- Alerts, Lists, Notes → back to native screens via `router.push`
- `openWebView` helper removed from `index.tsx`
- versionCode bumped to 223 (221 and 222 were already submitted to Play Store)
- Version string: V57.36.0 (build 223)
- 221/221 auto-tests green

### Why the revert
Builds 221 and 222 wired Alerts/Lists/Notes to open web pages via `Linking.openURL` (build 221) and `WebBrowser.openBrowserAsync` (build 222). Both broke geofencing:
- `Linking.openURL` opens Chrome Custom Tab → app goes to background → Samsung kills Transistorsoft foreground service → no geofence events during drive
- `WebBrowser.openBrowserAsync` was the fix attempt — awaits dismissal then re-syncs geofences — but Wael reverted before testing it

Wael's decision: revert 100% to V220 behavior. WebView migration is deferred until a safe integration path is designed that does NOT background the app or interfere with geofencing.

### Web pages (still live on mynaavi.com — not wired in app)
All 6 pages built and deployed to Vercel. Not linked from the app.
- `mynaavi.com/briefings.html` — existing, now has MyNaavi branding header (shared.js data-webview)
- `mynaavi.com/alerts.html` — pixel-for-pixel port of native alerts.tsx
- `mynaavi.com/lists.html` + `mynaavi.com/list-detail.html` — pixel-for-pixel port of native lists screens
- `mynaavi.com/notes.html` — pixel-for-pixel port of native notes.tsx
- `mynaavi.com/settings.html` — web portion of settings (Connected Services, Voice PIN, Briefings, Alert channels, Home/Work address)

### shared.js — WebView branding header
- Added `buildWebViewHeader()` — logo + MyNaavi name, left-aligned, no nav links, no footer
- Pages using `data-webview="true"` on body get this header instead of the full nav
- Currently only briefings.html uses it; other pages built but not wired

---

## Geofencing Investigation — OPEN

### What the logs show (2026-06-01 ~5:04–5:12 PM EST drive test)
- Permissions: foreground ✅ background ✅
- `syncGeofences-end` → `registered: 12` ✅
- `tsoft-activity-change` → `in_vehicle, confidence: 100` ✅
- `tsoft-motion-change` → `is_moving: true` ✅
- **Zero `geofence-T1-task-fired` events** — no ENTER event fired during the drive
- **Zero `tsoft-http` events** — native webhook never posted

### Alerts that should have fired but didn't
- **8206 Jeanne-d'Arc Blvd N** — enabled, last_fired: NEVER
- **8040 Jeanne-d'Arc Blvd N** — enabled, last_fired: NEVER

Both appear in `tsoft-geofences-change` `on_ids` (SDK has them registered) but no ENTER event fired when Wael drove to those addresses.

### Anomaly observed in logs
Every log event fires in duplicate pairs (two `isCalendarConnected-start`, two `app-state-change`, two `home-foreground-recheck` at the same millisecond). This is abnormal and not yet diagnosed. Possible causes: two AppState listeners registered, or two React Native instances.

### Status
Geofencing is OPEN / NOT RESOLVED. Wael drove to 8206 and 8040 Jeanne-d'Arc — both registered in the SDK — and no alert fired. Root cause unknown. Needs dedicated investigation session.

---

## Build 221 / 222 Status
- Build 221: submitted to Google Play Internal Testing — **contains broken WebView wiring, do not promote**
- Build 222: EAS build was stopped before submission
- Build 223: submitted to Google Play Internal Testing — **this is the correct build (V220 code)**

---

## Priority for Next Session

1. **Geofence investigation** — why did 8206 and 8040 Jeanne-d'Arc not fire despite being registered? Check `tsoft-sdk-log-snapshot` entries, check if the duplicate-event anomaly is related, check Transistorsoft native logs.

2. **WebView migration** — design a safe integration path that does NOT background the app or break geofencing. Options to investigate:
   - Native WebView component (react-native-webview) rendered inside the app — no backgrounding
   - Keep native screens, add "Open in browser" link for power users
   - Other approach TBD

3. **Duplicate event anomaly** — every DB log event fires twice. Investigate why two AppState listeners or two component instances are producing duplicate writes to `client_diagnostics`.

---

## Repos
- Mobile app: `C:\Users\waela\OneDrive\Desktop\Naavi` (branch: main)
- Website: `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website` (branch: main)
- Staff portal: `C:\Users\waela\OneDrive\Desktop\naavi-staff` (branch: main)
- Voice server: `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server` (branch: main)
- Build clone: `C:\Users\waela\naavi-mobile` (branch: main)
