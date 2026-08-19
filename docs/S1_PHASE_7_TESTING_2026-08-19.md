# Phase 7 — Testing — S1 — Voice PIN Authentication

**Date:** 2026-08-19
**Governance version:** v4.0
**Environment:** staging only — voice line **+1 343 504 1572**, Naavi Staging app
**Status:** Plan written. Awaiting the staging APK decision (§1), then Wael's testing.

---

## 1. ⚠️ Read this first — which build to test on

**Build 326 is faithful for every test below except test H.** The only app change since it was built is the counter reset when you unblock (two lines, commit `6bbc09b`). Everything else in 326 — the 6-digit PIN field, the blocked panel, the unblock button — is current.

Phase 7 is supposed to validate **what will merge**. On 326, test H would validate behaviour that is about to be replaced.

Two options, Wael's call:
1. **Build 327 first** (staging APK, ~20 min, no gates required under the two-phase build process) and run all of Phase 7 on it.
2. **Test on 326**, and record H as untested-on-final-build.

**Recommend option 1.** It is one staging build and it removes an asterisk from the phase that exists specifically to catch what automation cannot.

## 2. What automated testing already covers — do not re-test by hand

Gate 1 **4/4** and Gate 2 **7/7**, both confirmed against STAGING from the runner's banner:

- A PIN with no claimed account is refused rather than searched.
- A wrong last-4 retries three times, then refuses without disclosing whether an account exists.
- A short suffix never resolves to an account.
- A blocked account is refused before the PIN, with its own distinct wording.
- Failure count rises, clears on a correct PIN, and restarts after the 7-day window.
- A 4-digit PIN cannot be set; a legacy 4-digit PIN still verifies (including through the live voice path).
- Concurrent failures are each counted, and each caller receives a distinct sequential count.

Manual testing exists to cover what the harness cannot reach: real audio, real handsets, real SMS, and the two screens.

## 3. The tests

Each is a real call or a real tap. Record PASS/FAIL and anything that felt wrong even if it technically passed.

### Category: Phone / Voice — the registered path (regression)

**T1 — Call from your registered phone (`+1 343 333 2567`).**
The call must behave exactly as before S1: no last-4 prompt, no PIN prompt.
*Known and expected on staging:* Naavi will **not** say your name — that is [[B11c]], a pre-existing staging schema gap, not an S1 regression.
→ **PASS if** you are not asked to identify yourself at all.

### Category: Phone / Voice — the borrowed-phone path

**T2 — Call from the other phone. Give the correct last-4, then the correct 6-digit PIN.**
→ **PASS if** you get in, and Naavi says your name after the PIN.

**T3 — Call from the other phone. Give a last-4 that belongs to nobody (e.g. `0000`), three times.**
→ **PASS if** you get three attempts, and the refusal never suggests whether an account exists.

**T4 — Call from the other phone. Correct last-4, then a wrong PIN three times.**
→ **PASS if** the call ends after the third attempt, and **an alert SMS arrives from +1 343 504 1572**.
*This is also the test that proves the Phase 6 fix in real conditions* — the alert must arrive, which it would not if failures were being lost.

**T5 — While PIN-authenticated (from T2), ask Naavi to change your PIN.**
→ **PASS if** she refuses and points you to the app or your own phone.
**This closes a gap Phase 5 recorded as code-verified only** — it has never been exercised on a live call.

### Category: End-to-end integration — the BLOCK loop

**T6 — Reply `BLOCK` to the alert SMS from T4.**
→ **PASS if** you get a confirmation text back.
→ **FAIL if** you get *"Something went wrong and calls are NOT blocked yet"* — that message is honest, not cosmetic; it means the block did not take effect.

**T7 — Call again from the other phone, correct last-4.**
→ **PASS if** you are refused **before** being asked for a PIN, and the message specifically says calls from unregistered phones are blocked and can be turned off in the app.

### Category: Screen behavior / Permissions — the app

**T8 — Open Settings → Voice PIN.**
→ **PASS if** the blocked panel is visible and says calls from other phones are blocked.

**T9 — Tap "Allow calls from other phones."**
→ **PASS if** it asks you to confirm first, then the panel disappears.

**T10 — Call again from the other phone with the correct last-4 and PIN.**
→ **PASS if** you get in.

**T11 (build 327 only) — Immediately after T9/T10, enter a wrong PIN twice, then a third time.**
→ **PASS if** an alert SMS arrives on the third.
*This is the defect you found:* on 326 the counter would still be sitting at 3 from T4, so it would step to 4 and no alert would fire. On 327, unblocking cleared it, so the third failure alerts.

**T12 — Settings → Voice PIN → Change PIN.**
→ **PASS if** the field accepts **six** digits and saves.
→ **FAIL if** it stops you at four.

## 4. What a FAIL means

Report it and stop that thread — do not work around it. Two specifically must halt Phase 7 entirely, because both mean a security control is not working:

- **T5 fails** (a PIN-authenticated caller can change the PIN) — that is the account-takeover path Track B exists to close.
- **T7 fails** (a blocked account is let through) — blocking must outrank the PIN.

## 5. Results

*(Filled in as testing proceeds.)*

| Test | Result | Notes |
|---|---|---|
| T1 | | |
| T2 | | |
| T3 | | |
| T4 | | |
| T5 | | |
| T6 | | |
| T7 | | |
| T8 | | |
| T9 | | |
| T10 | | |
| T11 | | |
| T12 | | |

## 6. Not authorized by this phase

Phase 7 passing does not authorize the merge (Phase 8), and nothing here authorizes promotion to production. S1 remains staging-only. Per the Phase-Gate Approval Rule, each transition needs Wael's own explicit word.
