# Phase 1 — Problem Definition — S1 — Voice PIN Authentication Hardening

**Date:** 2026-08-19
**Governance version:** v4.0
**Phase 0:** APPROVED 2026-08-19 (reviewer, with one mandatory clarification) + Wael's own go-ahead. Priority confirmed at **P0** after the severity correction in §2.
**Status:** DRAFT — awaiting review. **No code written** (governance §3).

**Evidence convention.** Every claim is either a direct code read with `file:line`, or a live query result. Where a root cause is not established, this document says so rather than inferring.

---

## 1. What exactly is broken

**Three distinct defects, from one design.** They are separable and should not be conflated.

| # | Defect | Class |
|---|---|---|
| **A** | A PIN is checked against **every** PIN-holding account, not the caller's | Security — degrades as user count grows |
| **B** | The candidate search is silently capped at **50 accounts, unordered** | Correctness — a silent cliff |
| **C** | Attempt limiting is **per call**, so redialling resets it | Security — no effective cap |

### Defect A — the PIN is a global credential search

`naavi-voice-server/src/index.js`, `/voice/pin-result`:

```js
// Iterate all users with PIN set, verify in parallel. With small user
// counts (typical: 2-5 family members) parallelism is fine.
const candidates = await getUsersWithVoicePin();
const verifyResults = await Promise.all(candidates.map(async (u) => ({
  user: u, match: await verifyVoicePinForUser(u.user_id, pin),
})));
const matches = verifyResults.filter(r => r.match);
```

A caller does not need to guess a specific person's PIN. They need to guess **any** candidate's. The comment states its own assumption — *"typical: 2-5 family members"* — and that assumption is performing security work.

### Defect B — `limit=50`, unordered

`getUsersWithVoicePin()`:

```js
`${SUPABASE_URL}/rest/v1/user_settings?select=user_id,name&voice_pin_hash=not.is.null&limit=50`
```

No `ORDER BY`. Postgres row order without one is **not guaranteed and not stable**.

**Consequence past 50 PIN holders:** an arbitrary, unstable subset of users silently loses the borrowed-phone feature. Their correct PIN returns "no match." There is no error, no log, no alert — the caller is simply told they're wrong. **Failure is indistinguishable from a genuinely wrong PIN**, which is the same silent-failure shape as T2's staging crons (weeks of breakage behind a "succeeded" log).

This defect is **not** currently reachable — 2 PIN holders in production. It becomes reachable at 51.

### Defect C — attempt limit resets on redial

`PIN_MAX_ATTEMPTS = 3` (`index.js:6707`) counts within one call. Hang up, redial, three more. No per-account, per-number, or global counter exists anywhere. An attacker's budget is unlimited at roughly 30 seconds per three guesses.

## 2. ⚠️ Severity — corrected from Phase 0

**Phase 0 overstated this, and the correction matters.** It claimed odds of *"~1 in 1 at 10,000 users."* That is **wrong**: `limit=50` caps the candidate set, so the odds cannot exceed **50 ÷ 10,000 = 1 in 200** regardless of how large Naavi grows.

**Live population, queried 2026-08-19:**

| | `user_settings` rows | With a PIN set | Last-4 collisions |
|---|---|---|---|
| Production | 6 | **2** | **0** |
| Staging | 4 | 1 | 0 |

**Today's real exposure: 2 in 10,000 — 1 in 5,000 per guess.** Nobody is getting in by guessing.

| Scenario | Odds per guess |
|---|---|
| Today (2 PIN holders) | 1 in 5,000 |
| 50+ PIN holders (the cap) | **1 in 200** |
| Beyond 50 | still 1 in 200, but Defect B starts locking users out |

**Why it remains P0 despite that** (Wael's decision, informed by the correction): this is a design that is cheap to fix at 2 PIN holders and expensive at 2,000, and Defect B is a silent cliff whose first symptom is a user being told their correct PIN is wrong.

## 3. Root cause

**Proven.** The design authenticates a *credential* without first establishing an *identity*. Every other authenticated surface in Naavi resolves identity first — mobile via JWT, voice-registered via caller phone — and only then checks authorisation. The PIN path inverts this: it takes a secret and searches for whoever it belongs to.

That inversion is the whole defect. Defects B and C are consequences of trying to make an identity-less search tractable (cap the list) and safe (limit attempts per call), rather than of any individual coding error.

## 4. Alternatives considered

| Option | Disposition |
|---|---|
| **Identifier (last-4) + PIN scoped to that account** | **Selected.** Restores identity-then-credential ordering. Odds become independent of user count. |
| Full phone number as identifier | Rejected (Wael) — speaking the full number *and* the PIN aloud gives an eavesdropper both halves. Last-4 leaks far less and narrows just as effectively. |
| Alphanumeric PIN | Rejected — over voice, either spelling into the STT that turns "Fatma" into "Fatima" (B4b), or keypad letters where 2 means A/B/C. 6 digits gives comparable entropy without the usability cost. |
| Global/system-wide throttling | Rejected (Wael) — *"you do not penalize me because someone tried to hack your system."* Punishes uninvolved users. |
| Automatic lockout after N failures | Rejected — hands an attacker a denial-of-service against the real owner. Bank model instead: alert, and the **user** decides. |
| SMS one-time code to the registered number | Rejected (Wael) — the entire premise of the path is that the phone is **not available**. Proposed by Claude; the objection is correct. |
| Remove the borrowed-phone path entirely | **Still open** — see §6 Q4. Strictly stronger than any auth scheme if the feature is unused. |

## 5. ⭐ MANDATORY Phase 1 decision — last-4 collision handling

Required by the Phase 0 review. **Recommendation, for Phase 2 to design against:**

**When last-4 matches more than one account, ask for more digits — do not check the PIN against the bucket.**

**Rationale.** Checking against the bucket is the current defect in miniature: bucket size is bounded by nothing, so it grows quietly with the user base — exactly the property S1 exists to remove. Asking for two more digits (last-6) collapses essentially every realistic collision, costs one extra spoken prompt only for affected users, and keeps the invariant absolute: **a PIN is never checked against more than one account.**

**If still ambiguous after last-6:** refuse and direct the caller to their registered phone. That is a deliberate, stated outcome rather than a silent fallback.

**Current data supports this being rare:** zero collisions across both environments today.

## 6. What is NOT established — open for Phase 2

1. **Is a borrowed-phone path something Naavi should have?** ⚠️ **Reframed 2026-08-19 — the original wording was a badly-formed question.** It asked whether the path "has real usage," which cannot be answered: Naavi is pre-launch, and the only two accounts with a PIN are Wael (`788fe85c`, set today during testing) and Huss (`381b0833`, 2026-06-07). **The feature's entire population is the two founders.** There is also no telemetry for the path — 1.25M `client_diagnostics` rows contain zero PIN references, and `first_call_completed_at` cannot distinguish a PIN-authenticated call from a normal one off a registered number. Confirmed by direct query, not assumed.

   Wael's correction, recorded because it applies well beyond this item: *"this is a new system, we do not have any real statistics about anything. it is all analysis."*

   **So this is a product decision, not a measurement.** If the capability is not wanted, removing it is strictly stronger than any authentication design and S1 collapses to a much smaller item. If it is wanted, the design in Phase 0 stands. **Wael decides; Phase 2 must not begin until he has.**
2. **Migration.** What happens on the first call by a holder of an existing 4-digit PIN? Not designed.
3. **Failure threshold** before the SMS alert fires; one alert per incident or per attempt.
4. **Lockdown storage.** No schema exists for it — `20260513000002_user_settings_voice_pin.sql` adds only `voice_pin_hash` and `voice_pin_set_at`. A new column and a migration will be needed.
5. **Alert threshold** — originally framed as needing the "rate of legitimate PIN failure." Same flaw as Q1: there is no population to measure. With two founder accounts, any threshold is a **choice made from judgement**, not a calibration from data. Phase 2 should pick a deliberately conservative starting value and state it as provisional, revisited once real users exist.

## 7. Architecture Reference — ownership and classification

Reference version: `2026.07.18.4` (`docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`). To be re-confirmed unsuperseded before Phase 8.

| Affected capability | Owner | Classification |
|---|---|---|
| Voice caller authentication | `naavi-voice-server/src/index.js` (`/voice/pin`, `/voice/pin-result`, `getUsersWithVoicePin`, `verifyVoicePinForUser`) | **Voice-only** — no mobile equivalent; mobile uses Google OAuth **[FRESH]** |
| PIN storage and verification | `manage-voice-pin` Edge Function | **Shared Core** — but only voice calls it **[FRESH]** |
| PIN setting UI | Mobile settings screen | **Mobile-only** **[FRESH]** |
| Authentication, Permissions | — | **Protected Core** (governance §4) → Phase 3 and Phase 6 review both mandatory **[CITED]** |

**Cross-repository check.** Mobile has no PIN-verification path — it authenticates via Google OAuth (`lib/supabase.ts:260`) **[FRESH]**. The mobile app *sets* the PIN but never *verifies* it. So this is genuinely Voice-only, with one Shared Core dependency, and no duplicated implementation to keep in sync.

---

**Phase 1 conclusion:** the root cause is proven and is a single design inversion, not three separate bugs. Severity is materially lower today than Phase 0 stated, and that correction is recorded rather than buried. The mandatory collision decision has a recommendation with rationale. **One question in §6 could change the shape of the entire item and should be answered before Phase 2 begins.**

**Awaiting review and Wael's own explicit go-ahead before Phase 1A** (governance §3, Phase-Gate Approval Rule).
