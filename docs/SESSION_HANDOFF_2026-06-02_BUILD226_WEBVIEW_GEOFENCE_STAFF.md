# Session Handoff — 2026-06-02 | Build 226

## What Shipped

### Build 225 (V57.36.0) — Production AAB
- Full commercial Transistorsoft license — Order #16422 (perpetual, ca.naavi.app, expires 2027-07-01)
- `debug: false` — no audio tones
- All geofence radius fallbacks corrected: 100m/150m → 300m (useOrchestrator.ts + useGeofencing.ts)
- 3 existing rules with missing radius_meters patched in DB (390 McArthur, Gabe's NOFRILLS, Loblaws Ogilvie)

### Build 226 (V57.36.0) — Production AAB + Preview APK
- **WebView migration**: Alerts, Lists, Notes three-dot menu items now open mynaavi.com pages via react-native-webview Modal — app stays in foreground, Transistorsoft never killed
- **Re-arm fix** (useOrchestrator.ts): reactivating a location rule via chat now clears last_entered_at + last_exited_at (state machine reset)
- Post-drive native SDK log capture added on every app foreground

### Server-side (no build)
- **manage-rules Edge Function**: reactivate op now clears last_entered_at + last_exited_at — Alerts screen Reactivate button works correctly
- **check-staff Edge Function**: verifies staff email against support_staff table (bypasses RLS)
- **Supabase API key**: all 6 mynaavi.com pages + staff portal updated from disabled legacy JWT key to new publishable key `sb_publishable_Aq3x_es0Eh3WJcLJOV9l9g_gt0G0gUQ`

### Web pages (mynaavi.com) — no build needed
- **alerts.html**: expired alert buttons now full color (header opacity only, not whole row)
- **notes.html**: expired notes show collapsed with "Expired" pill, tap to expand → Reactivate + Delete permanently buttons; grouped at bottom of list; `is_deleted` column added + migration applied
- **notes.html**: trashed Drive files can be removed from Naavi without affecting Drive

### Staff portal (staff.mynaavi.com)
- Login page built — email + magic link flow
- New Ticket form — staff can create tickets on behalf of users (source: phone_call/email/WhatsApp/other)
- MyNaavi branding bar added to index.html + support.html
- "Staff Portal" title centered; "Support" subheader on support page
- `check-staff` Edge Function deployed for auth

---

## Geofencing — CONFIRMED WORKING

Drive test 2026-06-01 7:09 PM EST (build 224 with `debug: true` confirmed, build 225 commercial license):
- 8040 Jeanne-d'Arc ENTER fired at 7:09:20 PM ✅
- 8206 Jeanne-d'Arc ENTER fired at 7:10:45 PM ✅
- Native HTTP posted successfully (tsoft-http status: 200) ✅

Root cause was Transistorsoft trial license restricting production behavior. Commercial license resolved it.

**Re-arm bug confirmed and fixed**: new rules fire correctly; previously reactivated rules did not fire because last_entered_at was not cleared. Both manage-rules Edge Function (Alerts screen) and useOrchestrator.ts (chat path) now clear state machine fields on reactivate.

---

## V226 Testing Status

| Feature | Status |
|---|---|
| Alerts WebView opens in-app | ✅ confirmed |
| Expired alert buttons full color | ✅ fixed |
| Notes WebView opens in-app | ✅ confirmed |
| Notes expired pattern (collapsed/expand) | ✅ confirmed |
| Lists WebView opens in-app | ✅ seen working |
| Reactivate expired alert + drive test | ❌ not yet tested |
| Drive test with commercial license (V225/V226) | ❌ not yet done |

---

## Staff Portal — OPEN

Login flow is working (OTP redirects to staff.mynaavi.com correctly, check-staff returns authorized: true) BUT the portal JS is not picking up the token from the URL hash after redirect. The token IS in the URL (confirmed), check-staff works (confirmed), but the portal falls back to showing the login form.

**Suspected cause**: URLSearchParams or regex failing to parse the access_token from the hash in the specific browser context.

**Next session fix**: add a `console.log` to surface what `window.location.hash` contains on load, then fix the parsing. One targeted debug session should close this.

**Staff portal security**: needs proper 2FA design for next session. Current magic link IS two-factor (email address + inbox access) but the UX needs polish.

---

## Next Session Priority

1. **Full Naavi functionality testing** — deep dive across all features: voice call, chat, alerts, lists, notes, briefings, calendar, drive, contacts, geofencing
2. **Staff portal login fix** — one targeted debug, then ship
3. **Staff portal security design** — 2FA approach finalized
4. **Re-arm drive test** — reactivate an expired alert, drive to it, confirm it fires
5. **V226 production drive test** — confirm commercial license geofencing works in real daily use

---

## DB Changes This Session

- `naavi_notes.is_deleted` BOOLEAN NOT NULL DEFAULT false — migration applied via SQL editor
- `support_staff` policy `staff_read_own` — created (migration file committed but not yet applied via CLI; was applied manually)

---

## Repos

- Mobile app: `C:\Users\waela\OneDrive\Desktop\Naavi` (branch: main)
- Website: `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website` (branch: main)
- Staff portal: `C:\Users\waela\OneDrive\Desktop\naavi-staff` (branch: main)
- Voice server: `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server` (branch: main)
- Build clone: `C:\Users\waela\naavi-mobile` (branch: main)
