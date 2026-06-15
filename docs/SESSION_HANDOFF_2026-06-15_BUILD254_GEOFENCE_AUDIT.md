# Session Handoff — 2026-06-15 — Build 254 + Geofence Audit

## What shipped this session

### Build 254 (APK + AAB) — on Google Play Internal Testing
- **Push notification silent failure**: added `console.error` logging to `send-push-notification` for two silent paths (no subscriptions, missing FIREBASE_SERVICE_ACCOUNT_JSON)
- **SET_ACTION_RULE error surfacing**: `turnSpeechOverride` in `hooks/useOrchestrator.ts` — user now hears "something went wrong" if `manage-rules` fails instead of silent "Done"
- **v125 SELF-ALERT PRIMARY RULE**: `get-naavi-prompt` — when user says "alert me + send SMS to Bob", primary `to_phone` must be user's own (or omitted), Bob goes in `task_actions` only. Verified live at 3:50 AM — all 5 channels fired + Bob SMS ✅
- **Auto-tester**: 302/302 green before build

### Server-side (no APK needed)
- **`geofence_events` table**: migration `20260615_geofence_events.sql` — audit log for every geofence fire (user_id, rule_id, rule_label, fired_at, event, lat, lng, distance_from_center_m)
- **`report-location-event`**: INSERT into `geofence_events` after every successful fan-out — fire-and-forget

## Geofence tester audit query
```sql
SELECT 
  g.rule_label,
  g.event,
  g.fired_at AT TIME ZONE 'America/Toronto' AS fired_at_est,
  g.distance_from_center_m
FROM geofence_events g
JOIN user_settings u ON u.user_id = g.user_id
WHERE u.phone = '+16137697957'  -- change per tester
ORDER BY g.fired_at DESC;
```

## Tester script (for international geofence testers)
1. Install from Google Play invitation
2. Sign in with Google
3. Say: "Alert me when I arrive at [landmark]" — confirm alert set
4. If battery prompt appears — tap Allow
5. Drive 500m+ away, drive back, park
6. Report: location name, arrival time, phone model + Android version, did alert fire + what time

## Versions
- App: V57.54.0 build 254 (versionCode 254)
- PROMPT_VERSION: `2026-06-15-v125-self-alert-primary`
- Auto-tester: 302/302 green

## Next session focus
**B2m — Parity audit** (`docs/MOBILE_VS_VOICE_PARITY_AUDIT_2026-06-12.md`)

## Pending (carry forward)
- B7d: Show task_actions participant SMS recipients in Alerts screen card UI (next AAB)
- B7d: Remove `saveReminder()` at `hooks/useOrchestrator.ts:2699` + calendar event block at lines 2701-2714 (next AAB)
- Settings: `pushEnabled` mount check — always shows "Enable" even when subscription exists (next AAB)
- CLAUDE.md: remove "voice call only for location arrival" outdated restriction comment
