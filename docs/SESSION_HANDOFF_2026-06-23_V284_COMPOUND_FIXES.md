# Session Handoff — 2026-06-23 — V284 Compound Fixes

## Active APK
**V284 staging APK** — `dad11b5f` build, installed on Wael's device.
EAS build: `https://expo.dev/accounts/waggan/projects/naavi/builds/dad11b5f-1396-415e-821d-bcf93532f995`

---

## ⭐ FIRST TASK NEXT SESSION: Build V285 Staging APK → Test → Production AAB

### Step 1 — Build V285 staging APK
```
cd C:\Users\waela\naavi-mobile
git fetch origin && git merge origin/main
npm install
npx eas build --platform android --profile staging --non-interactive
```

### Step 2 — Test on device (key items to verify)
1. **Compound "Yes" executes without asking any questions** — server-side fix deployed, needs confirmation with fresh compound test
2. **Sarah's SMS actually sends** — `body` param fix is now in APK
3. **Cards appear under correct numbered items** — keyword-based slot matching
4. **No blank numbered cards** — compoundPlan capped to breakdown lines

### Step 3 — After Wael confirms staging passes → Production AAB
```
eas build --profile production --auto-submit
```
Run Gate 1 (auto-tester) and Gate 2 (voice regression) before building production.

---

## Commits Since V284 APK Was Built (0802e4f)

All committed to `main`, not yet in any APK:

| Commit | Fix |
|--------|-----|
| `6e41a2f` | No-merge rule for compound list + cap compoundPlan to breakdown lines |
| `93252fc` | Keyword-based card/label matching + stronger no-merge rule |
| `6224de7` | **SMS `body` param fix** — was passing `message` instead of `body` to send-sms; Sarah's text never actually sent despite "Sent" card showing |
| `feab2cd` | Absolute no-question rule on compound confirm turn (7 explicit rules) |
| `3d9e24c` | Scan last 6 turns for compound list — isCompoundConfirmTurn now fires even after clarification exchanges |

---

## Server-Side Fixes (Already Live on Staging — xugvnfudofuskxoknhve)

These are deployed and active. No APK needed:
- **No-merge rule**: each distinct user request gets its own numbered line
- **Scan 6 turns lookback**: "Yes" always triggers compound confirm even after Naavi asked clarifying questions
- **Absolute no-question rules**: 7 rules forbid ANY clarifying question after user says Yes (timing, invites, channels, schedule ambiguity all covered)
- **Compound confirm defaults**: morning→08:00, evening→20:00, text→SMS

---

## What Was Shipped in V284 APK (already working, do not retest)

- `maxLength` 500 → 2000 on chat text input
- Compound result scrolls to top so item #1 is visible first
- Compound voice reads ALL completed actions (not just the last location alert)
- Drive Notes save after compound + persistent "📝 Review summary in Notes" button alongside Collapse Chat
- Compound planning no-merge rule (server)
- Compound confirm defaults (server)

---

## Outstanding Items (Not Yet Started)

### Delete Medication Schedule
**Problem**: RRULE approach creates multiple recurring series (one per on-period). Google Calendar "Delete all events" only deletes one series. User expects one command to delete all.
**Solution planned**: Add "delete my [medication] schedule" intent to Naavi — searches calendar for all events matching the medication title (💊 Name) and deletes every matching series via API.
**Status**: Not implemented. Log for V285 or V286.

### Maestro Gate 3 (suspended since V283)
**Root cause**: Staging APK on emulator was built before `EXPO_PUBLIC_TEST_LOGIN_ENABLED=true` was added to eas.json staging profile. Test Lab sign-in button is now baked in (confirmed in current V284 build).
**Before running Maestro on V285+**: Install V285 staging APK on emulator, verify `e2e/00-sign-in.yaml` passes, then re-enable gate.

### Firebase Gate 4
**Before production AAB**: Update `scripts/submit-firebase-test.js` filename to `naavi-v285.apk`, run the script, verify ALL devices pass in Firebase Test Lab console (not just SMS).

---

## Compound Feature Status Summary

The compound question feature ("One Request. N Actions.") is largely working in V284 + current server. Known remaining issues resolved by V285 build:
- SMS actually sends (body param fix)
- Cards show under correct labels (keyword matching)

Known cosmetic issue confirmed by Wael as already working:
- Blank numbered card at bottom — resolved

---

## Branch / Repo State
- **Main repo**: `C:\Users\waela\OneDrive\Desktop\Naavi` — branch `main`, clean
- **Build clone**: `C:\Users\waela\naavi-mobile` — needs `git fetch && git merge origin/main` before next build
- **Staging Supabase**: `xugvnfudofuskxoknhve` — naavi-chat deployed with all session fixes
- **Production Supabase**: `hhgyppbxgmjrwdpdubcx` — unchanged, still on pre-session state
