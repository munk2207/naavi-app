# Session Handoff — 2026-05-15 — V57.15.6 build 179 + Transistorsoft trial dropped

**Branch:** merged to `main` (commit `d63b6b3`)
**Builds shipped:** V57.15.6 build 179 — APK preview + AAB production (auto-submitted to Play Store as DRAFT)
**Auto-tester:** 108/108 green
**Phone state:** Wael's Samsung phone V57.15.6 build 179 APK installed + verified live; Phone 2 (mynaavi2207) still has prior version

---

## TL;DR

V57.15.6 build 179 shipped with 5 UI polish fixes, all caught during V57.15.5 build 177 live retest. Bundle merged to main, feature branch deleted, AAB sits as DRAFT in Play Console awaiting Wael's manual promotion.

**Major non-shipped work this session:** trial integration of Transistorsoft `react-native-background-geolocation` v5.1.1 (`claude/transistorsoft-trial` branch, preserved on origin). Drive-test on Samsung One UI failed on both APK (DEBUG) and AAB (RELEASE without license). Postmortem identified notification icon path + DEBUG-mode FG-service suppression as the most likely root cause. Library DROPPED for now.

---

## What shipped — V57.15.6 build 179 (commit `751fbd7`, merged via `d63b6b3`)

5 UI polish fixes coded together:

| # | Fix | Files changed |
|---|---|---|
| 1 | Section header → bold + textPrimary (was semibold + textHint, dimmer than body) | `app/settings.tsx:1304` |
| 2 | All 7 X icons → red (`Colors.error` was `Colors.textMuted`) | `app/alerts.tsx`, `app/contact.tsx`, `app/lists/[id].tsx`, `app/report.tsx`, `app/settings.tsx` (×3) |
| 3 | PIN modal KeyboardAvoidingView restructure — KAV outermost child of Modal, backdrop nested inside, anchor card with `flex-start` + `paddingTop: 60` | `app/settings.tsx` (modal JSX + `pinModalBackdrop` style) |
| 4 | Settings ScrollView wrapped in KAV — fixes Primary edit screen-shift; applies to all inputs in screen | `app/settings.tsx:668` |
| 5 | Multi-phone auto-persist — "Save phones" button removed; new `persistPhoneNumbers` helper called immediately on +/X/edit-✓ | `app/settings.tsx` (handleAddPhone, handleSaveEditPhone, handleSaveEditPrimary, handleRemovePhone, removed handleSavePhone, added persistPhoneNumbers) |

**Live test results on Wael's phone (V57.15.6 APK installed 2026-05-15):**

| Test | Result | Notes |
|---|---|---|
| 1 — section header visibility | ✅ PASS | Headers now dominant, body subordinate |
| 2 — X icons red | ✅ PASS | All sites verified |
| 3 — PIN modal keyboard | ✅ PASS | No more blind-type workaround; modal stays visible |
| 4 — Primary edit screen-shift | ✅ PASS | ✓/× reachable when keyboard up; auto-persist also confirmed (added new backup mid-test) |
| 5 — Multi-phone auto-persist round-trip | ✅ PASS | Add survives restart; remove survives restart; edit survives restart |

**One false-alarm bug caught during Test 4:** backup phone displayed as `+123 4567891` instead of `+1 (613) ...`. Root cause: user typed only 9 digits after `+1` (test typo, not a code bug). Fallback `prettyPhone` greedy regex correctly degraded for invalid-length input. When user re-typed with proper 10 digits, formatting worked. Logged as low-priority polish (`isValidE164` could enforce strict 10-digit-after-+1 for NA numbers) but NOT shipped this build.

---

## Transistorsoft trial — DROPPED (postmortem)

**Branch:** `claude/transistorsoft-trial` preserved on origin for reference. Commit `7c5605a`. Do NOT merge.

**What was tried:** swap `Location.startGeofencingAsync` (Expo's wrapper around Android `GeofencingClient`) for Transistorsoft `react-native-background-geolocation` v5.1.1. Industry-standard library used by Strava/Life360 to defeat Samsung's aggressive process killer. Free in DEBUG mode; $399 perpetual license for RELEASE.

**Drive-test 2026-05-15 evening:** two phones, identical geofence rule at 841 Balsam Dr (resolved coords verified IDENTICAL in DB: `45.484911 / -75.51873839999999`, radius 100m, direction `arrive`). Phone 1 = APK (DEBUG, license-free). Phone 2 = AAB (RELEASE, unlicensed). Both signed in, location "Allow all the time", battery "Unrestricted". Drove from 1+ km away to target. **Neither phone fired.**

Observable differences: Phone 2 (AAB) had the persistent Android FG-service notification ("MyNaavi is keeping your alerts ready"). Phone 1 (APK) did NOT.

**Investigator (Explore agent) postmortem findings:**

| Hypothesis | Likelihood | Evidence |
|---|---|---|
| Integration sequence wrong (`ready()` → `addGeofences()` → `startGeofences()`) | 5% | Sequence is correct per docs; no separate `start()` needed |
| **Notification icon path `'mipmap/ic_launcher'` invalid** | **65%** | Expo prebuild may not resolve this; Android refuses to start FG service without valid notification → SDK silently dies in DEBUG |
| Missing Android permissions | 40% | Expo config plugin only adds license metadata + gradle deps; doesn't auto-inject FOREGROUND_SERVICE etc. |
| **DEBUG vs RELEASE FG-service behavior differs in unlicensed mode** | **55%** | Phone 1 (DEBUG) had no FG notification; Phone 2 (RELEASE) had it. Suggests SDK suppresses FG service in unlicensed DEBUG. |
| Samsung One UI background-kill | 45% | Known antagonist ([dontkillmyapp.com/samsung](https://dontkillmyapp.com/samsung)); doesn't fully explain identical failure on both phones |

**Most likely root cause:** notification icon path + DEBUG-mode FG-service suppression. Hypothesis 2 + 4 combined.

**Sources:**
- [Issue #1444 — ForegroundServiceStartNotAllowedException](https://github.com/transistorsoft/react-native-background-geolocation/issues/1444)
- [Issue #1120 — Galaxy S20 no geofence events (unresolved)](https://github.com/transistorsoft/react-native-background-geolocation/issues/1120)

**If we ever revisit Transistorsoft:**
1. Fix `notification.smallIcon` — try `'@drawable/notification_icon'` or generate dedicated mipmap via Expo plugin
2. Verify post-prebuild AndroidManifest has `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`
3. Test in RELEASE (AAB) first — unlicensed RELEASE has more forgiving FG-service handling than unlicensed DEBUG
4. Samsung's process killer remains the final boss even with the SDK working

The trial branch has the full integration code if anyone wants to retry with these fixes applied.

---

## Side discovery — preview APK works on real Samsung phone (not just emulator)

Per memory `feedback_apk_emulator_signin_works.md` (updated this session): preview APK signed with Wael's local keystore cert ALSO works on his real Samsung phone for full Sign-In + Google services, because his SHA-1 is registered in Google Cloud OAuth.

**Workflow (now documented in updated CLAUDE.md "MUST USE GOOGLE PLAY" section):**
1. Wael uninstalls existing Play Store version FIRST (cert mismatch blocks update over Play install)
2. Sideloads preview APK (Drive / email / direct download)
3. Sign-In works because local cert SHA-1 is OAuth-registered

This unlocks "test heavy native-module changes (Transistorsoft, custom geofence libs, etc.) on his REAL Samsung with the FULL real Naavi app" without needing AAB cycles. Used this workflow throughout the Transistorsoft trial.

---

## Holding-list updates

| Item | Action | Reason |
|---|---|---|
| 18c — V57.15.6 build 178 (5 fixes) | CLOSE | All 5 fixes shipped in V57.15.6 build 179 |
| 4 — Geofence reliability (Transistorsoft) | UPDATE — trial done, FAILED | Library does NOT solve Samsung delivery in our setup. Future retry needs icon-path + permissions fixes per postmortem. |
| 19 — Multi-phone identity refinements | CLOSE | Auto-persist redesign shipped in build 179 |
| 32 (new) — `isValidE164` strict 10-digit-after-+1 enforcement | OPEN low-priority | Caught during Test 4 false-alarm; rare typo case |

**No new items added.** Most action moves to "Geofence — what next?" — see priorities below.

---

## Top priority for next session (Wael 2026-05-15)

1. **Promote V57.15.6 build 179 AAB to Internal Testing** — sitting as DRAFT in Play Console. Standard "Send to internal testing" promotion. ~30 sec + 5-15 min Play Store propagation.

2. **Geofence reliability — what next?** Transistorsoft attempt failed. Three paths:
   - **(a) Retry Transistorsoft with the 4 postmortem fixes** (icon path, permissions audit, RELEASE-first testing) — could work but adds another full cycle of integration + drive-test + maybe license payment
   - **(b) Try Radar** — original parallel evaluation candidate; SaaS pricing likely high (still no reply from sales). Different vendor, different mechanism.
   - **(c) Accept geofencing-on-Samsung is unsolved** — focus on iOS or other Android OEMs where Expo's native API works. Block Robert's V57.x promotion permanently OR ship without geofencing.

   **No recommendation yet — Wael's strategic call.**

3. **Server-side fast wins (always available, no AAB needed):**
   - `naavi-spend-summary` Edge Function (~1 hour, approved 2026-04-30)
   - Voice live-calendar fetch (~30 min)
   - `resolve-place` radius 100→500 + address routing fix (~30 min)

4. **Optional polish:** add `isValidE164` strict 10-digit-after-+1 enforcement (~15 min, deferred from this session as low-priority).

---

## Build artifacts

- **V57.15.6 build 179 APK:** https://expo.dev/accounts/waggan/projects/naavi/builds/26dd9752-0c2a-4475-aac8-27377b173a40 (sideloaded on Wael's Samsung, verified live)
- **V57.15.6 build 179 AAB:** https://expo.dev/artifacts/eas/bb2NtkAQ9DBhJfz7iRkjjj.aab (DRAFT in Play Console, awaiting promotion)
- **V57.16.0-trial build 178 (Transistorsoft, FAILED):** AAB still in Play Console as DRAFT. Either delete or leave (won't auto-update unless promoted). Wael's call.

---

## Last AAB on phones

- **Wael's Samsung phone:** V57.15.6 build 179 APK (commit `751fbd7`), installed 2026-05-15
- **Phone 2 (mynaavi2207):** still has the prior V57.16.0-trial AAB Transistorsoft setup from earlier today (or whatever was installed before the trial)
- **Robert's phone:** still V56.6 (build 115) from 2026-04-28. **Do NOT promote V57.x to Robert until geofence reliability is solved (Transistorsoft trial failed; revisit per priority #2).**

---

## Memory updates this session

- `feedback_apk_emulator_signin_works.md` — expanded to cover real-phone install (not just emulator); added empirical 2026-05-15 proof + the "uninstall Play Store version first" gotcha

CLAUDE.md "MUST USE GOOGLE PLAY" section also updated to reference this nuance.

---

## Hygiene reminder

Wael pasted the Supabase service_role key (`sb_secret_ExJYK...`) into chat earlier this session for a one-shot read-only query (verified the two phones' geofence rules had identical resolved coords). Standard hygiene: rotate the key from Supabase API Keys page → 3-dot menu → Regenerate. ~30 sec. Not urgent but worth doing.
