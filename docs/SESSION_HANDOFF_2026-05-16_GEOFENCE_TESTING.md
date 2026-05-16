# Session Handoff — 2026-05-16 — Geofence testing on V57.16.0 AAB 185

**Branch:** `claude/transistorsoft-retry`
**AAB on both phones:** V57.16.0 build 185
**Trial license:** 30 days, expires 2026-06-14
**Auto-tester:** DISABLED (Wael 2026-05-16 — gate via `AUTO_TESTER_ENABLED=true` env var)

---

## TL;DR

Transistorsoft licensed integration (V57.16.0, AAB build 185) is empirically validated on Samsung One UI. Two real-world drives produced multiple T1→T4 chains and one full 4-channel delivery (Phone 1, 500 Bayview). Open issues are: (a) Phone 2 fan-out never delivered messages until the user_settings.phone null bug was fixed — needs re-test, (b) 962 Terranova home-arrival miss with Wael stationary for 12 hours — needs coordinate verification, (c) Phone 1 SDK firing 5× less than Phone 2 — needs explanation.

---

## Build / branch state

| Item | Value |
|---|---|
| Active branch | `claude/transistorsoft-retry` |
| Latest commit | `a13b03e` (auto-tester disabled + Rule 15 suspended) |
| AAB version | V57.16.0 build 185 |
| AAB artifact URL | https://expo.dev/artifacts/eas/owNyM5bHgjY4hBkiVZRxjK.aab |
| Submission | https://expo.dev/accounts/waggan/projects/naavi/submissions/4acc28ba-4706-4307-af94-df44c6371f83 |
| Play Console state | DRAFT (awaiting manual "Send to internal testing") |
| Trial license expires | 2026-06-14 |

---

## What shipped this session

1. **Transistorsoft v5.1.1 retry** on `claude/transistorsoft-retry` (branched off failed `claude/transistorsoft-trial`)
   - Removed expo-location FG service (Transistorsoft owns it alone)
   - HeadlessTask registered in new `/index.js` (handles kill-state geofence events)
   - Generated white-circle notification icon + wired via expo-notifications plugin
   - Added expo-gradle-ext-vars plugin
   - Added WAKE_LOCK permission
2. **Trial license** wired into app.json plugin config (`react-native-background-geolocation` license field)
3. **Fail-open headless rule lookup** in `hooks/useGeofencing.ts::handleGeofenceEvent` — proceeds to POST even if Supabase rule query fails in headless context
4. **`report-location-event`** now accepts `user_id` optionally; derives from rule's owner if absent
5. **Server-side geofence tuning:**
   - Default radius: 100m → **300m** (`resolve-place`)
   - Default dwell: 120s → **30s** (`report-location-event`)
   - Dedup window: per-day → **30 minutes**
   - Read `dwell_minutes` AND `dwell_seconds` from trigger_config (was silently ignoring `dwell_minutes`)
6. **Orchestrator** (`naavi-chat`) no longer hardcodes `dwell_minutes:2`; prompt v75 drops `dwell_minutes=2` from all examples
7. **Existing rules** updated in DB to `radius_meters:300` + `dwell_seconds:30`
8. **Calendar test cleanup** via list+filter — bypasses Google's q= indexing lag
9. **Auto-tester preserves `user_settings.phone`** — snapshot/restore in `tests/lib/fixtures.ts`
10. **Auto-tester DISABLED** via env gate after multiple destructive-write incidents
11. **CLAUDE.md Rule 15 (suite-green-before-AAB) marked SUSPENDED**
12. **Merged main** into `claude/transistorsoft-retry` to bring V57.15.6 multi-phone UI fixes
13. **AAB builds 184 + 185** built and auto-submitted to Play Internal Testing as DRAFT

---

## Drive test findings (May 15)

### Phone 1 (wael, 4 active rules)
- **1 T1 fire** (500 Bayview at 19:56 UTC = 3:56 PM EDT) — full 4-channel delivery to +16137697957 ✓
- **408 Lockmaster** (rule `c591b93b`, created 5:27 PM EDT): never fired
- **962 Terranova** (rule `212b20a7`, created 2:59 PM EDT): never fired
- **410, 688 Bayview**: never fired

### Phone 2 (mynaavi2207, multiple rules, all deleted by auto-tester)
- **5 T1 fires** across 4 different rules (500 Bayview ×2, 410 ×2, 408 Lockmaster)
- **ZERO messages delivered** — `user_settings.phone` was null at fan-out time (auto-tester had wiped it)
- 408 fire (rule `5a3c85b0`) showed a **3-hour T1→T2 gap** (T1 at 6:42 PM EDT, T2 at 9:45 PM EDT) — empirical proof Samsung killed the JS process for 3 hours but the native SDK kept tracking; queued event drained when app foregrounded

### Cross-phone observation
- Phone 2 fired 5× more events than Phone 1
- If both phones were physically together (Wael confirmed yes), Phone 1's SDK is genuinely less reliable
- Phone 1 has Samsung **"Battery Protection" ENABLED**; Phone 2 has it DISABLED — potential variable

---

## ⭐ Next-session priorities — GEOFENCE FOCUS

### Priority 1 — Verify Phone 2 fan-out works now
- `user_settings.phone` set to `+16138796681` and auto-tester wipe is disabled
- Phone 2 currently has **0 active rules** (all auto-disabled after May 15 drive)
- **Action:** create rules on Phone 2 via voice/chat → drive-test → verify SMS/WhatsApp/Voice/Email actually deliver to +16138796681

### Priority 2 — 962 Terranova home-arrival miss
- Wael was stationary AT 962 from May 15 7:00 PM EDT to May 16 7:00 AM EDT (12 hours)
- Neither Phone 1 nor Phone 2 fired ENTER for 962 during that window
- Resolved coords: 45.4878725, -75.5230041 (radius 300m)
- Two possibilities, not yet disambiguated:
  - (a) Both phones' SDKs killed during arrival window (Samsung issue)
  - (b) Resolved coords NOT within 300m of Wael's actual house (geocode bug in `resolve-place`)
- **Action:** open https://www.google.com/maps?q=45.4878725,-75.5230041 → compare with actual house location → if >300m off, fix `resolve-place` geocoding

### Priority 3 — Phone 1 SDK reliability
- 5:1 fire-rate differential vs Phone 2 in same drive
- Likely Phone 1 process killed more aggressively by Samsung
- **Hypothesis to test:** turn OFF Samsung "Battery Protection" on Phone 1 → retest
- If still asymmetric → check device-specific battery profiles, RAM pressure, other background apps

### Priority 4 — Audit other auto-tester destructive paths
- Auto-tester disabled until audit completes
- Known destructive (all fixed but disabled out of caution):
  - Google Calendar events
  - `action_rules` table (deletes ALL test user rules)
  - `user_settings.phone` (clearTestUserPhones)
- **Audit needed:** other `OWNED_TABLES` in `tests/lib/fixtures.ts`: `contacts`, `lists`, `knowledge_fragments`, `sent_messages`, `pending_disambig`, `documents`, `email_actions`, `reminders`, `people`
- Specifically: does any test write destructively to **production data fields** the test user uses live?

### Priority 5 — Re-enable auto-tester after audit
- Set `AUTO_TESTER_ENABLED=true` in env after audit closes
- Re-instate CLAUDE.md Rule 15

---

## Open hard questions (need Wael decision)

1. **Pay $399 for Transistorsoft perpetual license?** — depends on whether priorities 1-3 resolve cleanly within 30-day trial. Trial expires 2026-06-14.
2. **Merge `claude/transistorsoft-retry` to main?** — currently this branch is divergent from main. Once Phone 2 fan-out is verified + 962 is resolved, this should merge.
3. **Promote AAB 185 from DRAFT to Internal Testing in Play Console?** — manual step in https://play.google.com/console → MyNaavi → Internal testing → "Send to internal testing"

---

## Current rule state (as of session close)

### Phone 1 active rules (Wael, user_id `788fe85c`)
| Rule | Place | Coords | Created EDT |
|---|---|---|---|
| 57d27d43 | 410 Bayview Dr | 45.502, -76.080 | 11:35 AM May 15 |
| 1a85fa5a | 688 Bayview Dr | 45.511, -76.097 | 1:24 PM May 15 |
| 212b20a7 | 962 Terranova Dr | 45.488, -75.523 | 2:59 PM May 15 |
| c591b93b | 408 Lockmaster Crescent | 45.226, -75.699 | 5:27 PM May 15 |

All radius 300m, dwell_seconds:30.

### Phone 2 active rules (mynaavi2207, user_id `7739bab9`)
**NONE.** All auto-disabled after firing during the May 15 drive.

---

## Disabled / paused

- **Auto-tester** — runner exits immediately. Re-enable: `AUTO_TESTER_ENABLED=true npm run test:auto`
- **CLAUDE.md Rule 15** — suite-green-before-AAB suspended while auto-tester is paused

---

## Key memory files for next session

- `feedback_investigate_before_paying.md` — lesson from $399 license false-alarm (2026-05-15)
- `project_naavi_geofence_reliability_open.md` — full geofence history; still open
- `project_naavi_geofence_dwell_shipped.md` — server-side dwell pipeline

(Probably new memory worth writing: "auto-tester must not write destructively to fields the test user uses live" — lesson from today.)

---

## Reference URLs

- Branch: https://github.com/munk2207/naavi-app/tree/claude/transistorsoft-retry
- AAB 185 artifact: https://expo.dev/artifacts/eas/owNyM5bHgjY4hBkiVZRxjK.aab
- Trial license signup: https://transistorsoft.com/shop/trials/new
- Play Console: https://play.google.com/console
