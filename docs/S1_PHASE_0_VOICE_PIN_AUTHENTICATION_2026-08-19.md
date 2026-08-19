# Phase 0 — S1 — Voice PIN Authentication Hardening

**Date:** 2026-08-19
**Governance version:** v4.0
**Status:** DRAFT — awaiting Wael's explicit Phase 0 approval. No implementation may begin until this is approved (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3).

---

## ⭐ SCOPE DECLARATION — READ FIRST

**This work item targets voice-call authentication only.** It changes how an unregistered caller proves who they are, and nothing else.

| | Status under this item |
|---|---|
| Mobile app sign-in (Google OAuth) | **Not touched** |
| Registered-caller flow (calling from your own number) | **Not touched** — recognised as today, no PIN |
| Mobile app PIN-setting screen | **Touched** — must accept 6 digits instead of 4 |
| The unregistered-caller PIN path | **The subject of this item** |
| Production data | **Not modified.** Existing 4-digit PINs must keep working until each user sets a new one — see Constraints |

---

## The problem — stated with evidence, not inference

**A caller does not have to guess *your* PIN. They have to guess *anyone's*.**

`naavi-voice-server/src/index.js` (`/voice/pin-result`) checks an entered PIN against **every account that has one set**:

```js
// Iterate all users with PIN set, verify in parallel. With small user
// counts (typical: 2-5 family members) parallelism is fine.
const candidates = await getUsersWithVoicePin();
const verifyResults = await Promise.all(candidates.map(async (u) => ({
  user: u,
  match: await verifyVoicePinForUser(u.user_id, pin),
})));
```

The comment is candid about its assumption. **That assumption is doing security work, and it expires the moment Naavi has real users.**

### Consequence: security degrades as the product succeeds

With a 4-digit PIN (10,000 combinations) checked against every account:

| Users with a PIN | Odds a single random guess matches *someone* |
|---|---|
| 5 | 1 in 2,000 |
| 100 | 1 in 100 |
| 1,000 | **1 in 10** |
| 10,000 | **~1 in 1** |

### And the attempt limit is not a limit

`PIN_MAX_ATTEMPTS = 3` (`index.js:6707`) counts attempts **within one call**. Hanging up and redialling resets it. There is no per-account, per-number or global limit anywhere. An attacker has unlimited guesses at roughly 30 seconds per three.

### Nobody would find out

There is no alerting on failed PIN attempts. A sustained attack today would be **completely invisible** — the same silent-failure shape as the staging crons in T2, which ran broken for weeks behind a "succeeded" log.

**Verified 2026-08-19** by direct code read of `/voice/pin-result`, `manage-voice-pin/index.ts`, and `extractPinFromTwilioGather`. Wael reproduced the PIN flow live on both production and staging from his own and a third-party phone.

## User Intent

Make it impossible for someone calling from an unregistered phone to reach another user's account by guessing, without removing the ability of a legitimate user to call from a borrowed phone.

## Success Criteria

1. A guessed PIN is checked against **exactly one** account, not all of them — so the odds of a successful guess **do not change as Naavi's user count grows**.
2. A legitimate user calling from a borrowed phone can still reach their own account.
3. Repeated failures are visible to the account owner, and they can shut the path down themselves.
4. **No legitimate user is slowed down or locked out because someone else is being attacked.** Explicitly rejected during design (Wael): *"you do not penalize me because someone tried to hack your system."*

## In Scope

1. **Caller states the last 4 digits of their registered number before the PIN.** This is an *identifier*, not a secret — its job is to narrow the PIN check to one account. Last-4 rather than the full number deliberately: speaking a full number and a PIN aloud hands an eavesdropper both halves (Wael's refinement).
2. **PIN checked against that account only.** This is the actual fix; everything else is a safety net.
3. **PIN length 4 → 6 digits**, across `manage-voice-pin`, the mobile PIN-setting screen, and `extractPinFromTwilioGather` (`index.js:6713-6727`).
4. **Failure counting per account**, now meaningful because failures can be attributed.
5. **SMS alert to the registered number** on repeated failures, reusing `send-sms`.
6. **User-decided lockdown, on the bank model:** the alert offers to block access from any number except the registered one. Re-enabling requires the mobile app. The recovery channel is deliberately stronger than the attacked one — an attacker on the phone line cannot undo a block that needs Google-authenticated app access. The existing `receive-sms-reply` inbound webhook already parses `From`/`Body` and can carry the reply.

## Out of Scope

- **Mobile app authentication** — Google OAuth unchanged.
- **The registered-caller path** — calling from your own number stays as-is, no PIN.
- **Global or system-wide throttling.** Considered and **rejected by Wael**: it penalises uninvolved users for an attacker's behaviour. Recorded so it is not re-proposed.
- **Alphanumeric PINs.** Considered and rejected: over a voice channel it means either spelling into STT (the same STT that turns "Fatma" into "Fatima" — B4b) or keypad letters where 2 means A, B or C. Six digits gives comparable entropy with none of that cost.
- **Automatic lockout on failure.** Rejected in favour of the bank model — the user decides. Auto-locking hands an attacker a denial-of-service against the real owner.
- **Voice biometric.** Previously retired in favour of the PIN (`project_naavi_caller_pin_chosen_over_biometric`). Not reopened.

## Constraints

- **Voice only / no mobile auth changes / no production data migration.**
- **Existing 4-digit PINs must keep working** until their owner sets a 6-digit one. A change that silently locks every existing user out of the borrowed-phone path is not acceptable. Migration behaviour is a Phase 2 design question, not assumed here.
- **Full Phase 0-8 governance.** This is **Authentication** and **Permissions** — two Protected Core areas (governance §4) — so Phase 3 and Phase 6 external review are both mandatory.
- **Staging-first.** T2's voice staging environment exists precisely so a change like this can be exercised without production callers. There is no excuse for testing this on production.
- **No user-facing collective penalty**, per Success Criterion 4.

## Completion Criteria

1. A PIN guess demonstrably reaches only one candidate account — proven by test, not by reading the code.
2. Live staging call: correct last-4 + correct 6-digit PIN → recognised. Correct last-4 + wrong PIN → refused. Wrong last-4 → refused without revealing whether the account exists.
3. Repeated failures produce an SMS to the registered number, and the reply blocks the path.
4. A blocked account can only be re-enabled from the mobile app.
5. Existing 4-digit PIN holders are not locked out before setting a new PIN.
6. Auto-tester regression tests per CLAUDE.md Rule 15a, including a negative control proving a PIN is never matched against a non-claimed account.
7. Full Phase 0-8 cycle with Phase 3 and Phase 6 sign-off.

## Open questions for Phase 1

1. **Last-4 collisions.** Two users can share the last 4 digits. Narrowing to 2-3 accounts is still a vast improvement over all of them, but the behaviour must be decided, not stumbled into.
2. **Migration.** What happens on the first call by a user who still has a 4-digit PIN?
3. **Failure threshold** before the alert fires — and whether one alert per incident or per attempt.
4. **Does the borrowed-phone path have real usage?** Worth knowing before hardening it. If nobody uses it, removing it is stronger than any authentication scheme. Not assumed either way.
5. **Rate of legitimate PIN failure** — needed to set thresholds that don't cry wolf.

---

**Awaiting Wael's explicit Phase 0 approval.** Per governance §3's Phase-Gate Approval Rule, Phase 1 does not begin — including drafting the Phase 1 document — until that approval is given directly for this specific transition.
