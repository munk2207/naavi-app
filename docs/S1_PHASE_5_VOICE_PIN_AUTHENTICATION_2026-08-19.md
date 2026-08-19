# Phase 5 — Evidence — S1 — Voice PIN Authentication

**Date:** 2026-08-19
**Governance version:** v4.0
**Phase 3 plan:** `docs/S1_PHASE_3_VOICE_PIN_AUTHENTICATION_2026-08-19.md`
**Environment:** staging only (Supabase `xugvnfudofuskxoknhve`, Railway `naavi-voice-staging-production`, Twilio `+13435041572`)
**Status:** Evidence complete; the one defect found in testing is fixed and verified (§7). **Awaiting Wael's go-ahead for the Phase 5 → 6 transition.**

---

## 1. What shipped

| Track | Change | Where | State |
|---|---|---|---|
| A | Caller claims an identity (last 4 digits) before the PIN; PIN checked against that ONE account | `naavi-voice-server/src/index.js` | deployed to staging, live-verified |
| B | `variant` passed to the WebSocket; a PIN-authenticated caller cannot change the PIN; PIN no longer spoken aloud | same | deployed, live-verified |
| C | PIN 4 → 6 digits; `verify` still accepts 4 during migration | same + `manage-voice-pin` + `app/settings.tsx` | deployed, live-verified |
| D | Failure counting with reset and 7-day window; owner SMS alert; BLOCK reply; blocked-account refusal | same + migration + `receive-sms-reply` + `app/settings.tsx` | deployed, live-verified |
| E | 7 regression tests | `tests/catalogue/s1-voice-pin-scoping.ts` | Gate 1 2/2, Gate 2 7/7, staging |

Build **326** (`versionCode` 326) carries the mobile halves (C5, D6).

## 2. Phase 3 §5 verification checklist

| # | Required evidence | Result | Source |
|---|---|---|---|
| 1 | A PIN is **never** matched against a non-claimed account — negative control | ✅ | `s1.pin-result-fails-closed-without-claimed-account` — posts to `/voice/pin-result` with no `?claimed=`, asserts refusal AND the absence of a retry path |
| 2 | An existing 4-digit PIN still verifies; a 4-digit `set` is refused | ✅ set / ⚠️ verify | `s1.pin-set-requires-six-digits` proves the `set` refusal by shape (`pin_must_be_6_digits`). The 4-digit **verify** path is covered by `PIN_VERIFY_RE` but was not exercised against a live 4-digit hash — no such hash remained on staging by the time Track E ran. See §6.1 |
| 3 | Successful PIN auth **zeroes** the failure count | ✅ | `s1.failure-count-rises-then-clears-on-a-correct-pin` (0→1→2→0), **and** live: Wael's account read 4 at 5:01 PM EST and 0 after his next successful call |
| 4 | Failures older than **7 days** do not count | ✅ | `s1.failures-older-than-the-window-restart-the-count` — seeds a count of 2 dated 8 days back, asserts the next failure yields 1, not 3 |
| 5 | A PIN-authenticated caller **cannot** change the PIN | ⚠️ code-verified only | Track B gate at `index.js` (`callVariant === 'pin'` → refusal). Not exercised on a live call. See §6.2 |
| 6 | The PIN is **not spoken aloud** on success | ✅ | Live staging call, Wael, 2026-08-19 |
| 7 | A last-4 collision asks for more digits and never checks the PIN against the bucket | ⚠️ partial | `s1.identify-rejects-short-input-without-searching` proves a short suffix never resolves to a claimed account. A true two-account collision was not constructed — staging has only one PIN-holding account. See §6.3 |
| 8 | A zero match refuses **without disclosing** whether an account exists | ✅ | `s1.identify-unknown-suffix-retries-then-refuses` asserts the refusal contains none of "not registered", "no account", "doesn't exist", "unknown number" |
| 9 | The **registered-caller path is unchanged** | ✅ (with a caveat) | Live call from `+13433332567` completed normally. It produces **no spoken name** on staging — but that is [[B11c]], root-caused during this session as a **pre-existing staging schema gap**, not an S1 regression. Evidence in §4 |
| 10 | Live staging call exercising the full flow | ✅ | Wael, multiple calls, 2026-08-19 — see §3 |

## 3. Live verification (Wael, staging, 2026-08-19)

The complete Track D loop, end to end on real hardware:

1. Called from an unregistered phone, gave last-4 `2567`, entered a wrong 6-digit PIN.
2. **Received the alert SMS** — from `+13435041572`, staging's own number (see §5).
3. **Replied BLOCK.** Received the confirmation SMS.
4. **The app showed the blocked state** (D6) — the panel rendered.
5. **Tapped "Allow calls from other phones."** The block cleared.
6. **Called again from the unregistered phone — access restored**, and Naavi spoke his name after PIN authentication.

Every link in the chain — voice → database → SMS → inbound webhook → database → mobile UI → database → voice — was exercised against live infrastructure. No step was simulated.

Earlier calls the same day separately confirmed Track A (three attempts on a wrong last-4 rather than an immediate hangup, changed at Wael's instruction), Track B (PIN not read back aloud), and Track C (6-digit entry).

## 4. Findings surfaced by this work, outside its scope

Recorded here because S1's testing produced them; **none is fixed by S1** and each is logged separately.

**4.1 — [[B11c]] root-caused.** The registered-caller path runs `user_settings?select=name,first_call_completed_at&user_id=eq.<id>`. On staging that column **does not exist**, so PostgREST fails the entire query with HTTP 400 (`42703`), `userName` stays empty, and the greeting drops the name. Production has the column; staging does not.

**4.2 — Untracked production schema.** No migration in the repository creates `first_call_completed_at`. It was added to production by hand, which is why staging never received it and could not have. The scale of this is unknown — this is the first instance found. Larger than B11c and logged separately.

**4.3 — No barge-in during the PIN prompts.** `<Play>` sits outside `<Gather>` deliberately (`index.js:6634`, dated 2026-05-13) because nesting produced silent prompts on landlines. The documented cost is that a caller cannot speak or key during a prompt. **S1 did not introduce this, but S1 made the caller pay it twice per call** by adding the identification prompt ahead of the PIN.

**4.4 — Barge-in fails in normal conversation.** Distinct from 4.3 and far more serious: this is the voice equivalent of the mobile **Stop button** (`app/index.tsx:3898`), which is a permanent on-screen control. On a call there is no screen, so speaking over Naavi *is* the Stop button — and without it there is no way to cut off a long or unwanted answer except hanging up. Traced but not root-caused: S1's diff is ruled out, audio forwarding to Deepgram is ungated, and no early return swallows transcripts on the conversation path. The decisive next datum is whether `[Barge-in] User speaking — stopping playback` appears in the Railway log during a failing call. **Ranked by Wael as a broken primary control, not a bug report.**

## 5. Environment isolation defect found and fixed during S1

S1 was the first feature ever to send an SMS that invites a reply, and that exposed a hole T2 had not covered.

**The defect:** staging's `TWILIO_FROM_NUMBER` held **production's** number. Staging sent the alert; it arrived showing `+12495235394`; Wael's BLOCK reply therefore landed on **production's** `receive-sms-reply`, which has neither the code nor the column. His reply did nothing. Verified afterwards that no production ticket existed, so nothing was altered.

**Proof it was a misconfiguration, not a guess:** Supabase exposes only a fingerprint of a secret, never its value. Staging's old `TWILIO_FROM_NUMBER` fingerprint (`1becf892…`) was **identical to production's**, which is direct evidence the two held the same value. After the fix, staging's fingerprint matches staging's own `VOICE_CALL_FROM_NUMBER` (`6d08513b…`), and production's is unchanged.

**The fix, both config, no code:**
1. `+13435041572`'s Twilio SMS webhook → `https://xugvnfudofuskxoknhve.supabase.co/functions/v1/receive-sms-reply` (was Twilio's default placeholder).
2. Staging's `TWILIO_FROM_NUMBER` → `+13435041572`.

This is recorded here because **both live outside git** and would otherwise be invisible to the next person, who might re-point that webhook without knowing why it was set.

**Found by Wael's real call, not by my test.** My test proved the counter increments; his call proved the boundary leaked. Only a real handset could show it.

## 6. Coverage gaps, stated rather than implied

**6.1 — 4-digit verify not exercised live.** `PIN_VERIFY_RE` accepts 4 or 6 digits, but no 4-digit hash remained on staging to test against. The migration window is the reason this matters: any user with an old PIN must keep working. Covered by code read only.

**6.2 — The set-PIN refusal was not exercised on a live call.** Code-verified.

**6.3 — No true last-4 collision was constructed.** Staging holds one PIN-bearing account, so the bucket path could not be reached with real data.

**6.4 — C5 and D6 have no automated coverage** (Rule 15a exception path, acknowledged in the commit). They are client-side screens the auto-tester cannot reach; their server halves *are* covered. Both were validated manually — see §3 steps 4-5.

**6.5 — `tsc` is not a usable gate in this repository.** A bad `Colors.text` reference in `app/settings.tsx` produced no error, because pre-existing **syntax** errors in `web/app/page.tsx` stop the compiler before semantic analysis. Caught by inspection; flagged as separate work. The APK is unaffected — Metro bundles the app and never reads that file.

## 7. Defect found in testing — RESOLVED 2026-08-19

**Found by Wael's testing, not by mine.** He entered a wrong PIN and received no alert. The counter had gone **3 → 4**, and the alert fires only when the count *equals* the threshold of 3, exactly once, so it was skipped.

The threshold logic is correct in isolation. What is wrong is that **nothing clears the counter except a successful PIN on a call, or seven days elapsing.** So this sequence disarms the alarm:

> attacked → alerted → user replies BLOCK → user unblocks in the app and changes their PIN → counter is still 3 → the next real attack alerts them **never**.

The user doing exactly the right thing is what disables the alert. The counter is measuring *total* failures when it should measure **unaddressed** ones.

**Proposed fix (Wael's decision, not yet given):** clear the counter whenever the owner acts on it — on a PIN change (`manage-voice-pin` `op: set`) and on unblocking in the app (D6). Both are unambiguous "handled" signals, and each attack episode then gets its own alert.

**Considered and not recommended:** re-alerting at every further multiple of the threshold. It partly reinstates what was rejected at Phase 0 — training the owner to ignore the alert — and it is unnecessary, because once the 7-day window lapses a continuing attack re-alerts on its own.

**Decision (Wael, 2026-08-19): fix it before Phase 6.** Implemented in commit `6bbc09b`:

- `manage-voice-pin` (`op: set`) clears the count after a successful PIN change. Written as a **separate best-effort update**, not folded into the PIN write, so an environment without the S1 migration can still set a PIN — folding it in would break PIN-setting there, which is exactly how one missing column already breaks the caller-name query (§4.1).
- `app/settings.tsx` clears the count alongside the block when the user unblocks.

**Verified against staging directly, not only through the test:** count set to 3 → PIN changed → count read back as 0. Regression test `s1.changing-the-pin-clears-the-failure-count` seeds the account at exactly the threshold — the state that disarmed the alert in the live incident — and asserts the reset. Gate 1 3/3 green.

**⚠️ Build 326 predates the mobile half of this fix.** The APK Wael has installed contains D6 but not the counter reset on unblock, because it was built before this defect was found. The server half (PIN change) *is* live, so the disarm scenario is covered — a user who changes their PIN gets the reset regardless of app version. The unblock-only path will not reset until a new build. Not urgent; it should ride the next staging APK rather than trigger one.

## 8. Process failures during Phase 4, recorded

Three, all of the same shape — a check that could not observe what it claimed to.

1. **The Track E tests passed 7/7 while testing nothing.** The provisioning helper posted `{action:'set'}` where `manage-voice-pin` expects `{op:'set'}`, so every test took its skip branch. Caught by noticing a test containing 7.5 s of deliberate waits had finished in 269 ms — not by reading the code. After the fix the same test runs 10.5 s.
2. **`tsc` reported a clean file containing a real error** (§6.5).
3. **Wrong install instruction.** Wael was told the staging APK installs alongside production as `ca.naavi.app.staging`. It does not: `app.config.js` shares production's package deliberately (Google Sign-In is tied to it) and only renames the app to "Naavi Staging", so it **replaces** production. Taken from CLAUDE.md's staging table without reading the config. CLAUDE.md is wrong on this point and should be corrected.

The pattern worth carrying forward: in all three the signal that exposed the error was a number or a name that did not fit — never the gate that was supposed to catch it.

---

**Phase 5 complete. Awaiting Wael's decision on §7, then his go-ahead for Phase 6 (external technical review).**
