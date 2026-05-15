# Session Handoff — 2026-05-14 — V57.15.5 builds 176 + 177

**Branch:** `main` (working in main repo per CLAUDE.md, despite worktree assignment)
**Commits this session:** `fae265c` (build 176), `5ce56ad` (build 177)
**Builds shipped:** AAB → Google Play Internal Testing (×2), Preview APK → emulator (×2)
**Auto-tester:** 108/108 green at both build commits
**Phones updated:** Wael's Samsung phone V57.15.5 build 177; emulator V57.15.5 build 177

---

## TL;DR

Caller-PIN feature is now MOBILE-COMPLETE end-to-end (Set / Change / Remove from Mobile Settings + voice-server flow + prompt RULE 19 + Edge Function). Multi-phone refinements (#4 pretty-print, #5 edit-in-place, #7 cap at 5) shipped. Lists testIDs replace the V57.15.4 Maestro regex workaround. Verified-address rejection messages now name the place.

**3 user-facing bugs caught during live test, queued for build 178:**
1. PIN modal — `KeyboardAvoidingView` wrap was structurally wrong; modal card still hides behind keyboard. Build 178 needs the standard pattern (KAV outermost inside Modal + flex-start anchor with paddingTop).
2. Primary edit — same keyboard family, screen-shift on tap.
3. Multi-phone explicit Save button is a UX bug — users tap **+** expecting persistence; the entry sits in local state until **Save phones** is tapped, leading to "the number disappeared after navigation" reports. Fix: auto-persist on +/X/edit, remove the Save phones button entirely.

**1 holding-list item closed:** #22 Haptic VIBRATE permission + duration — already shipped in V57.11.7; was a phantom on the list.

---

## What shipped

### Build 176 — commit `fae265c`

**Mobile (`app/settings.tsx`):**
- New "Voice PIN" section between Phone Numbers and Connected Services. State 1 (no PIN) shows "Set a 4-digit PIN" button; State 2 (PIN set) shows "✓ PIN SET ON <date>" + Change + Remove buttons.
- Modal popup with two PIN fields, mismatch + format error messages inline, Save / Cancel buttons.
- Hash never read from client; only `voice_pin_set_at` timestamp surfaces (loaded via the existing user_settings query).
- Multi-phone refinements:
  - `prettyPhone()` formats `+1` numbers as `+1 (XXX) XXX-XXXX` in display contexts (note line + backup row labels). TextInputs stay raw to avoid fighting typing.
  - Tap a backup row to edit in place — swaps to inline TextInput + checkmark/X buttons. Validates E.164 + collision before commit.
  - `MAX_PHONES = 5` cap — Add input + button hidden + replaced with "limit reached" note when at cap.

**Lists (`app/lists.tsx` + `e2e/14-lists-screen-tabs.yaml`):**
- `testID="lists-tab-{key}"` on each tab TouchableOpacity.
- Maestro yaml switched from `text: "All.*"` regex (V57.15.4 workaround) to `id: "lists-tab-all"` selectors.

**Edge Function (`supabase/functions/manage-voice-pin/index.ts`):**
- New `remove` op (mirrors SET's auth pattern: JWT for mobile, service-role for voice-server). Idempotent; clears `voice_pin_hash` + `voice_pin_set_at` to NULL. Deployed to `hhgyppbxgmjrwdpdubcx`.

### Build 177 — commit `5ce56ad`

Direct response to live-test findings on build 176:

1. **PIN modal `KeyboardAvoidingView`** — wrapped the modal card. **Did not work** (build 178 needs proper restructure).
2. **Primary phone tap-to-edit + pretty-print** — fixes Test 5 inconsistency (Primary was raw while Backup was pretty). Tap row → swaps to raw TextInput + ✓/× buttons; same handlers as Backup pattern. Falls through to direct edit mode if no primary set.
3. **`onSubmitEditing` wiring** — keypad Done now commits on:
   - inline backup edit → `handleSaveEditPhone`
   - add-backup input → `handleAddPhone`
   - new PIN field → focus confirm field
   - confirm PIN field → `handleSavePin`
   - primary edit field → `handleSaveEditPrimary`
4. **Verified-address rejection naming** (#24) — 2 string edits in `hooks/useOrchestrator.ts`:
   - L830: *"I couldn't tell which one you meant..."* → *"I couldn't tell which '${pending.placeName}' you meant..."*
   - L924: *"I couldn't find that..."* → *"I couldn't find '${pending.placeName}'..."*
   - L1419 (calendar variant) was already named — that's the pattern we matched.

---

## Live-test results (build 177 on Wael's Samsung phone)

| # | Test | Result | Notes |
|---|---|---|---|
| 1 | Voice PIN section renders | ✅ PASS | Both State 1 (no PIN) and State 2 (PIN set) render correctly |
| 2 | Remove PIN | ✅ PASS | New `remove` op verified end-to-end (alert + state flip) |
| 3 | Set fresh PIN | ✅ PASS (workaround) | Modal visual still hides behind keyboard; underlying flow works via blind-type + keypad Done — autoFocus + onSubmitEditing wiring saves the day |
| 4 | Change PIN | ✅ PASS (workaround) | Same modal, same workaround |
| 5 | Primary tap-to-edit + pretty-print | ✅ PASS visual | Pretty-print + pencil icon + tap-to-edit confirmed |
| 6 | Cap at 5 numbers | ✅ PASS | Add input hides + limit message shows at 5; reappears when removed |
| 7 | Backup edit-in-place keyboard polish | not retested | Used implicitly in T3/T4 workaround |
| 24 | Named address rejection | not live-tested | Hard to repro — needs 3 failed location-rule clarifications. Code is shipped. |

---

## Bugs caught during live test → queued for build 178

### 1. PIN modal — `KeyboardAvoidingView` restructure

**What I shipped (build 177):** wrapped `pinModalCard` inside `KeyboardAvoidingView` with `behavior='padding'` (iOS) / `'height'` (Android), nested inside the centered backdrop.

**Why it failed:** wrong structure. The backdrop already does `flex: 1, alignItems: 'center', justifyContent: 'center'` — when KAV nested inside tries to manage available height, it fights the backdrop's centering. Net effect: card stays visually fixed, keyboard covers it (sometimes worse than before — Wael's screenshot showed only the title visible).

**Build 178 fix:**
- Move `KeyboardAvoidingView` to be the OUTERMOST child of `<Modal>` (`<Modal><KeyboardAvoidingView style={{flex:1}}>...`)
- Backdrop becomes the IMMEDIATE child of KAV
- Anchor the modal card with `justifyContent: 'flex-start'` + `paddingTop: 60` instead of `'center'` — bulletproof against any keyboard quirk because card sits near the top regardless

### 2. Primary edit — screen-shift on keyboard

Same family as the PIN modal. Tap Primary to enter edit mode → keyboard pops up → ScrollView pans → ✓ button shifts position → tap misses. Build 178 either:
- KAV-wraps the section
- OR relies on `onSubmitEditing` (already shipped — keypad Done commits without needing the on-screen ✓)

### 3. Multi-phone Save button — root cause UX bug

Multiple reports of *"I added a phone, navigated away, came back, the new entry disappeared."* DB confirms: the new entry never reached the server. After diagnostic walkthrough, the cause is:
- **+** button only adds to local state.
- **Save phones** button is what persists to DB.
- Users intuit that **+** auto-persists. They tap +, see the number in the list, then navigate away without tapping Save phones. On return, the screen reloads from server which still has the pre-+ data.

**Build 178 fix:** auto-persist on **+**, **X**, and edit-✓. Remove the Save phones button entirely. Each operation triggers a small upsert; show a brief loading spinner. Eliminates the entire failure mode.

This also makes the *"Saved 3 backup numbers"* wording fix moot — no more save alert because no more save button.

### 4. Settings section header visibility (added 2026-05-15 during retest)

**What Wael noticed:** Looking at the Settings screen, the section headers (VOICE PIN, CONNECTED SERVICES, etc.) render DIMMER than their own descriptions. The hierarchy is inverted — body text outranks the title visually.

**Root cause:** `styles.sectionTitle` at [app/settings.tsx:1304](app/settings.tsx:1304) uses:
- `color: Colors.textHint` — the dimmest color in the palette, reserved for placeholders
- `fontWeight: Typography.semibold`

The body description below uses `Colors.textSecondary` which is brighter than `textHint`. So the title literally has less visual weight than what it's introducing.

**Build 178 fix:** change to:
- `color: Colors.textPrimary`
- `fontWeight: Typography.bold`

Keep the existing `fontSize: Typography.body`, `textTransform: 'uppercase'`, and `letterSpacing: 0.8` — only the color + weight change. Minimal blast radius (one styles object, applies to all 6 sections in Settings uniformly).

### 5. All X icons → red (added 2026-05-15 retest, Test 7 followup)

**What Wael noticed:** During Test 7 (backup edit-in-place), the cancel **×** in the inline edit row is the same grey as the row-delete **×**. Two distinct user intents (discard-edit vs remove-row) share one color → ambiguous.

**Wael's call:** instead of a per-role color split, make EVERY **×** in the app red for consistent destructive/cancel signaling. One simple rule, no role nuance.

**Audit — 7 sites currently using `Colors.textMuted`:**
- [app/alerts.tsx:542](app/alerts.tsx:542)
- [app/contact.tsx:171](app/contact.tsx:171)
- [app/report.tsx:189](app/report.tsx:189)
- [app/lists/[id].tsx:268](app/lists/[id].tsx:268)
- [app/settings.tsx:785](app/settings.tsx:785) (primary cancel-edit)
- [app/settings.tsx:843](app/settings.tsx:843) (backup cancel-edit)
- [app/settings.tsx:860](app/settings.tsx:860) (backup row delete)

**Fix:** change `color={Colors.textMuted}` → `color={Colors.error}` on each (`#D85A30` per [constants/Colors.ts:59](constants/Colors.ts:59)). Mechanical sweep, one prop per site. No layout impact.

### 6. (Not a bug — existing data observation)

`+1234567890` typed during testing pretty-prints as `+123 4567890` because it has only 9 digits after `+1` (not the 10-digit NA standard). The +1 branch of `prettyPhone` doesn't fire (length check 12); the fallback formatter treats `+123` as the country code. Not a bug — the formatter is correctly handling a non-NA-format input. Not on the build 178 list.

---

## DB state notes (Wael's user_id `788fe85c-…`)

Manual service-role writes during the session for diagnostic and data-restore:

1. Wrote `+1234567890` to `phone_numbers[]` to repro the disappearance bug → confirmed schema + trigger accept it.
2. Wael deleted `+1234567890`, added `+1111111111`. Save reportedly tapped, but DB only had 3 phones afterward — same pattern.
3. Service-role wrote `+1111111111` back to restore data on his screen.

**Final state at session close:**
```
phone_numbers: ["+16137697957", "+16138796682", "+16138241928", "+1111111111"]
```

`+1111111111` is a test number; he can remove it via X + Save phones (or it'll go away once build 178's auto-persist lands).

---

## Holding-list updates needed in CLAUDE.md

| Item | Action | Reason |
|---|---|---|
| 18b — V57.15.5 (Caller PIN + Lists testIDs) | Mark as PARTIALLY SHIPPED | Builds 176 + 177 done; build 178 fixes queued |
| 22 — Haptic VIBRATE permission + duration | CLOSE | Already shipped in V57.11.7 — phantom on the list |
| 24 — Verified-address rejection naming | CLOSE | Shipped in build 177 (commit `5ce56ad`) |
| 19 — Multi-phone identity refinements | Update — additional refinements queued for build 178 | Auto-persist redesign needed |

New AAB-required item to add to holding list:

| # | Item | Source | Est. |
|---|---|---|---|
| 32 (V57.15.6) | Build 178 — PIN modal KAV restructure + Primary edit screen-shift + auto-persist phone changes | This handoff | ~1 hour code + retest |

---

## Memory saved this session

- `feedback_apk_emulator_signin_works.md` — preview APK on emulator works for sign-in (Wael has SHA-1 registered in Google Cloud OAuth). Don't reject preview APK builds on Google Sign-In grounds; CLAUDE.md "MUST USE GOOGLE PLAY" rule is about real-device sideload only.

---

## Top priority for next session (Wael 2026-05-14)

1. **⭐ V57.15.6 build 178** — bundle the 3 caught bugs:
   - PIN modal KAV structural fix (KAV outermost + flex-start anchor)
   - Primary edit screen-shift (same keyboard family)
   - Multi-phone auto-persist (remove Save phones button entirely)
   - ~1 hour code + retest + AAB + APK
   - Closes V57.15.5 cycle cleanly
2. **Geofence reliability** — STILL BLOCKED on vendor replies. Transistorsoft + Radar emails sent 2026-05-12, no reply. Follow-up email DRAFTED in 2026-05-13 chat log, not yet sent. **Do NOT pay $350 Transistorsoft license without trial verification.** If still no reply by next session, send the drafted follow-up.
3. **Server-side fast wins** (alternative if no AAB): `naavi-spend-summary` Edge Function (~1 hour) + Voice live-calendar fetch (~30 min) + `resolve-place` radius 100→500 + address routing fix (~30 min).

---

## Build artifacts

- AAB build 176: https://expo.dev/artifacts/eas/5FA77VFumUy1hqgP1kWQ2j.aab (Internal Testing)
- AAB build 177: https://expo.dev/artifacts/eas/heQWe5Y6gTAs2ghCUKRMdT.aab (Internal Testing)
- APK build 176: https://expo.dev/accounts/waggan/projects/naavi/builds/7726d21d-0511-4ff2-9b0d-bceb7f9bc182
- APK build 177: https://expo.dev/accounts/waggan/projects/naavi/builds/ac3c1659-a2b4-4e46-ba9f-d59a48a50682

---

## Last AAB on phones

- **Wael's Samsung phone:** V57.15.5 build 177 (commit `5ce56ad`), installed 2026-05-14
- **Robert's phone:** V56.6 (build 115), installed 2026-04-28. **DO NOT promote V57.x to Robert until geofence reliability is solved.**
