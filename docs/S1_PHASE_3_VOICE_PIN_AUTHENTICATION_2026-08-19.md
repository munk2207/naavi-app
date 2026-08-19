# Phase 3 — Technical Review (Before Coding) — S1 — Voice PIN Authentication

**Date:** 2026-08-19
**Governance version:** v4.0
**Reviewer:** ChatGPT (External Technical Reviewer, governance §1)
**Plan reviewed:** `docs/S1_PHASE_2_VOICE_PIN_AUTHENTICATION_2026-08-19.md`
**Status:** Review complete. **Awaiting Wael's explicit go-ahead for the Phase 3 → 4 transition.**

---

## 1. Review record

Phase 3 ran over two rounds.

**Round 1 — CHANGES REQUIRED.** One issue, correctly identified:

> *"Failure counting has no reset behavior defined. D2 increments `voice_pin_failed_count`, but the plan never specifies when it resets after a successful authentication. Without this, legitimate mistakes can accumulate indefinitely and eventually trigger alerts."*

**Round 2 — APPROVED.**

> *"The required reset-on-success is correctly added, and the 7-day decay handles stale accumulated failures. Test coverage now explicitly covers both cases."*

**Two changes were made between rounds**, both recorded in Phase 2 §8:

1. **Reset-on-success** (the required change), deliberately scoped to successful *PIN* authentication only — a call from the registered phone does not clear the counter, because it proves the person is present without saying anything about who made the earlier attempts.
2. **7-day decay window**, which Wael required after rejecting the 24-hour value I first proposed. His objection was decisive on two counts: a short window is trivially evaded by pacing, and it does not survive real reading habits — *"Robert can check his SMS every two days."*

## 2. Decision

**APPROVED.** Gates 1–5 (governance §13) pass: the plan stays inside Phase 0's approved scope, complies with governance, preserves architecture integrity, is technically sound, and carries sufficient evidence.

## 3. ⭐ Implementation Boundaries Confirmed

**These files, and no others, are authorized for Phase 4.**

| File | Authorized change |
|---|---|
| `naavi-voice-server/src/index.js` | **A1-A3**: last-4 prompt before PIN; resolve to one account; verify against that account only; delete `getUsersWithVoicePin()`. **B1-B4**: pass `variant` as a `<Stream>` `<Parameter>`, read it, gate the set-PIN intercept on `variant !== 'pin'`, stop speaking the PIN aloud. **C1-C3**: 6-digit extraction and prompts. **D2-D3, D5**: failure counting with reset and 7-day window, alert dispatch, blocked-account refusal |
| `supabase/functions/manage-voice-pin/index.ts` | **C4**: `set` requires 6 digits; `verify` accepts 4 or 6 during migration |
| `supabase/functions/receive-sms-reply/index.ts` | **D4**: recognise `BLOCK` from a registered number |
| `app/settings.tsx` | **C5**: PIN input `maxLength` 4 → 6 and copy. **D6**: blocked-state display and re-enable |
| `supabase/migrations/<new>.sql` | **D1**: three additive columns on `user_settings` |
| `tests/catalogue/s1-voice-pin-scoping.ts` | **E1**: new suite |
| `tests/catalogue/voice-pin.ts` | **E2**: extend for 6-digit and migration |
| `tests/runner.ts` | **E3**: register |

**Explicitly NOT authorized:**

- **No additional files** beyond those listed.
- **No opportunistic refactoring.** `naavi-voice-server/src/index.js` is a very large file and Phase 4 will be reading widely in it; improvements noticed along the way are reported in the Phase 5 evidence package, never implemented silently (governance Phase 4, No Extra Changes Rule).
- **No architectural changes** beyond what Phase 2 describes.
- **No change to mobile authentication.** Google OAuth is untouched.
- **No change to the registered-caller path.** Calling from your own number must behave exactly as it does today.
- **`token === serviceKey` is NOT authorized for change** — see §4.

## 4. Deferred Architectural Decisions

Recorded separately so a future session recognises these as *considered and set aside*, not as fresh ideas.

**4.1 — `manage-voice-pin`'s literal service-key comparison.** `token === serviceKey` is the same pattern that failed during this morning's key rotation, when every voice-server call to Supabase returned 401. **Deferred, not fixed.** It sits in S1's blast radius but is not part of this defect, and changing an auth comparison inside a work item already changing authentication multiplies the risk of the exact failure S1 exists to prevent. **Reconsider when:** the key-rotation follow-up is opened, or a second incident traces to this pattern.

**4.2 — Automatic lockout after a high failure threshold.** Rejected at Phase 0 in favour of the bank model; raised again implicitly by the alert-latency limitation (Phase 2 §8.2a). **Still deferred.** Auto-locking hands an attacker a denial-of-service against the real owner, which is worse than the exposure it removes. **Reconsider when:** real usage exists and the owner-response latency can be measured rather than guessed.

**4.3 — Removing the borrowed-phone path entirely.** Considered at Phase 1 as strictly stronger than any authentication scheme. **Closed by product decision** (Wael, 2026-08-19): the path is wanted. Not deferred — decided.

**4.4 — Rate limiting by calling number.** Raised during design, rejected: attackers rotate numbers, and it would require tracking a set that grows without bound. Per-account counting (D2) achieves the goal because the account is now claimed before the PIN is checked. **Reconsider when:** an attack is observed that per-account counting demonstrably fails to catch.

## 5. Verification checklist for Phase 5

The evidence package must show:

1. A PIN is **never** matched against a non-claimed account — negative control, not a code reading.
2. An existing **4-digit** PIN still verifies; a 4-digit `set` is refused.
3. Successful PIN auth **zeroes** the failure count.
4. Failures older than **7 days** do not count toward the threshold.
5. A PIN-authenticated caller **cannot** change the PIN.
6. The PIN is **not spoken aloud** on success.
7. A last-4 collision asks for more digits and **never** checks the PIN against the bucket.
8. A zero match refuses **without disclosing** whether an account exists.
9. The **registered-caller path is unchanged** — regression evidence, not assertion.
10. Live staging call exercising the full flow. **Staging only** — T2's environment exists for exactly this.

## 6. Open items carried into Phase 4

1. **Alert threshold** — no data exists to calibrate against. Phase 4 picks a conservative value and states it as provisional (Phase 1 §6 Q5).
2. **Zero-match wording** — must not leak account existence by implication. Phase 5 should quote the exact spoken text.
3. **`BLOCK` scope** — currently disables the unregistered path only, not the PIN itself. Confirmed as intended.
4. **Onboarding collision** — `/voice` is shared with the first-call path; A1 must not intercept a first-time *registered* caller. Called out in Phase 2 §6 as a specific regression risk.

---

**Awaiting Wael's explicit go-ahead for Phase 4** (governance §3, Phase-Gate Approval Rule). Phase 4 is the first phase in which code changes.
