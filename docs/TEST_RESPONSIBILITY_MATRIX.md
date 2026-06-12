# MyNaavi Test Responsibility Matrix

Sorted by criticality. Each row: what's tested, who/what runs it, binary pass/fail criterion, target sample size per release.

**Sample size key:**
- **5** = small (one-shot / qualitative — one tester, one drive, one phone)
- **50** = medium (per-release regression — enough to catch issues at scale)
- **100+** = large (population-level — all active users or all rules in DB)

---

## CRITICAL — release blockers

| # | Test target | Auto / Human | By | Pass / Fail criterion | Sample |
|---|---|---|---|---|---|
| 1 | Geofence ENTER fires on a real drive | Human | Tester (drive panel) | All 4 channels (call + SMS + email + push) arrive within 60 sec of arrival; no duplicates; no premature fire | 5 |
| 2 | All 4 channels arrive on normal cellular | Human + automated delivery receipts | Tester + auto-tester | SMS + WhatsApp + email + push all arrive within 60 sec of self-message | 50 |
| 3 | Voice call basic roundtrip | Human | Tester | Answers in name within 5 sec; reads correct calendar events; hangs up cleanly on "goodbye" | 50 |
| 4 | Chat → action shape correctness | Automated | Auto-tester (prompt-regression suite) | Action JSON matches expected shape for known phrasings | 100 |
| 5 | Multi-user data safety (no cross-user reads) | Automated | Auto-tester (multiuser suite) | RLS enforces; no Wael data leaks to Huss and vice versa | 50 |
| 6 | Database integrity (uniques, no orphans) | Automated | Auto-tester (data-integrity suite) | All constraints hold; duplicate inserts blocked; orphan rows cleaned | 50 |

## HIGH — regression-prone

| # | Test target | Auto / Human | By | Pass / Fail criterion | Sample |
|---|---|---|---|---|---|
| 7 | Geofence EXIT fires on a real drive | Human | Tester (drive panel) | EXIT event recorded server-side within 60 sec of leaving the radius | 5 |
| 8 | Voice recognition on real human speech | Human | Tester panel | STT transcript matches intent in ≥ 90% of utterances across accents/speed/noise | 50 |
| 9 | TTS pronunciation (names, addresses, numbers) | Human | Tester panel | Listener understands without rewinding | 50 |
| 10 | Calendar event renders on correct day in correct format | Human (visual) + Automated (Claude output) | Tester + auto-tester | Event appears on correct date as the intended format (timed vs all-day) | 50 |
| 11 | OAuth token silent-revoke detection | Auto cron (to build) | Server cron, daily | All active users return a valid token; revoked users flagged within 24h | 100+ |
| 12 | TopBarMenu navigation | E2E (Maestro, to build) | Maestro on real-device cloud | Every menu item taps cleanly navigates to its screen | 5 |

## MEDIUM — known weak edges

| # | Test target | Auto / Human | By | Pass / Fail criterion | Sample |
|---|---|---|---|---|---|
| 13 | Voice call stop-word interrupt mid-TTS | Human | Tester | TTS stops within 1 sec of "stop"; does not resume; does not treat "stop" as a question | 50 |
| 14 | PIN flow when calling from a phone not in user's list | Human (future Twilio E2E) | Tester | PIN prompt fires; correct PIN accepted; 3 wrong attempts ends the call | 50 |
| 15 | Multi-channel delivery on Wi-Fi-only / weak signal | Human | Tester | At least 1 of 4 channels arrives within 90 sec | 50 |
| 16 | Permission grant flows (mic, location, contacts, notifications) | E2E (Maestro) | Maestro on real-device cloud | Each permission persists across app restart | 5 |
| 17 | Settings UI flows (name, addresses, phones, PIN) | E2E (Maestro) | Maestro on real-device cloud | Each setting saves and persists across app restart | 5 |
| 18 | Voice action parity (DELETE_EVENT, LIST_RULES, SCHEDULE_MEDICATION) | Auto (to build) | Auto-tester (voice-parity suite) | Each action returns correct shape via the voice path | 50 |
| 19 | List features (create, add, remove, connect) | Automated | Auto-tester (list-connections, lists-reconcile) | All operations return the expected state | 50 |

## LOWER — operational / opportunistic

| # | Test target | Auto / Human | By | Pass / Fail criterion | Sample |
|---|---|---|---|---|---|
| 20 | Battery throttling over multi-day on Samsung | Human (long-form) | Standing test panel | App still responsive after 8h sleep; geofence still active | 5 |
| 21 | Notification visual rendering (foreground-service icon, persistent look) | Human (visual) | Tester | Icon visible and readable; not misleading | 5 |
| 22 | Inset corruption recurrence (Android nav bar overlap) | Human (opportunistic) | Tester | If seen: capture timestamp + screenshot; do NOT force-stop | 5 |
| 23 | International roaming behavior | Human (rare condition) | Tester traveling | Alert delivery works on EU / US / Asia roaming | 5 |
| 24 | Real-device UI matrix (Samsung, Pixel, screen sizes) | E2E (specialized) | BrowserStack / Firebase Test Lab / AWS Device Farm | UI renders consistently across reference devices | 50 |
| 25 | Address resolution accuracy on Google Places | Automated | Auto-tester (resolve-place tests) | Correct lat/lng for a fixed set of reference addresses | 50 |
| 26 | Network resilience (offline, slow 3G, captive portal) | E2E (specialized) | Device farm with network controls | App handles each condition gracefully (no crash, no hang) | 5 |

---

**Total: 26 rows.** Update this matrix whenever a new test scenario is added, or whenever a "Human" row migrates to "Automated" as automation infrastructure ships.

*Last updated: 2026-05-17.*
