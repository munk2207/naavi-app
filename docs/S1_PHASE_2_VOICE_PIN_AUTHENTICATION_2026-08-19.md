# Phase 2 — Change Plan — S1 — Voice PIN Authentication Hardening

**Date:** 2026-08-19
**Governance version:** v4.0
**Phase 1:** APPROVED. **Phase 1A:** PASS WITH CORRECTIONS, approved 2026-08-19.
**Product decisions recorded:** borrowed-phone path is **kept** (Wael); a PIN-authenticated caller **may not change the PIN** (Wael, option 1).
**Status:** DRAFT — awaiting Phase 3 external technical review. **No code written.**

**Risk classification: HIGH.** Justified in §6.

---

## 1. Design

**The fix is one inversion, applied in order.** Establish identity, then check the credential — the ordering every other Naavi surface already uses.

```
TODAY:   caller → [PIN] → search all accounts → whoever matches
PROPOSED: caller → [last-4] → ONE account → [PIN] → that account only
```

Everything else in this plan is either a consequence of that change (PIN length, prompts) or a safety net for when someone tries anyway (alert, lockdown).

**Two findings from Phase 1A shape the plan and were not known at Phase 0:**

1. **The escalation path.** A PIN-authenticated caller can currently change the PIN (`index.js:10403`), turning a guessed PIN into permanent takeover. Wael's decision: block it.
2. **The marker already exists but doesn't travel.** Sessions are already tagged `variant: 'pin'` vs `'primary'` (`:6921`, `:6687`), but `variant` is **not** among the `<Parameter>` values passed to the media stream (`:7018-7020`, `:7177-7179` pass only `callerPhone`, `userName`, `userId`). So the intercept cannot see it. **[FRESH]** That makes the fix small plumbing rather than new state.

## 2. Files that will change

### Track A — Identity before credential (the core fix)

| # | File | Class | Change |
|---|---|---|---|
| A1 | `naavi-voice-server/src/index.js` `/voice` (`:6598-6640`) | Backend | Unregistered caller is asked for **last 4 digits** of their registered number, not the PIN |
| A2 | same, new handler | Backend | Resolve last-4 → candidate account(s). Exactly one → proceed to PIN. More than one → ask for last-6. Still ambiguous → refuse and direct to the registered phone. Zero → refuse **without revealing whether an account exists** |
| A3 | same, `/voice/pin-result` (`:6874-6890`) | Backend | Verify against **the claimed account only**. `getUsersWithVoicePin()` and its `limit=50` are **deleted** — Defect B disappears with the search |

### Track B — Close the escalation path (Wael's decision)

| # | File | Class | Change |
|---|---|---|---|
| B1 | `index.js:7018-7020`, `:7177-7179` | Backend | Add `<Parameter name="variant" value="…" />` to both `<Stream>` blocks |
| B2 | `index.js:12947` | Backend | Read `variant` from `customParameters` alongside `callerPhone` |
| B3 | `index.js:10403-10440` | Backend | Gate the set-PIN intercept on `variant !== 'pin'`. A PIN-authenticated caller is told to use the app or call from their registered phone |
| B4 | `index.js:10441` | Backend | **Stop speaking the PIN aloud.** Confirm without reciting it |

### Track C — PIN length 4 → 6

| # | File | Class | Change |
|---|---|---|---|
| C1 | `index.js:6718`, `:6727` (`extractPinFromTwilioGather`) | Backend | Accept 6 digits; accept 4 during migration |
| C2 | `index.js:6751` (`extractPinFromSentence`) | Backend | Same |
| C3 | `index.js:6630`, `:6821`, `:6823` | Backend | Spoken prompts: "four digit" → "six digit" |
| C4 | `supabase/functions/manage-voice-pin/index.ts` | Backend | Validation accepts 6; **`set` requires 6**, `verify` accepts either during migration |
| C5 | `app/settings.tsx:1336`, `:1350` | **UI** | `maxLength={4}` → `6`; copy updated |

**Migration behaviour (Phase 0 constraint — existing users must not be locked out):** `verify` accepts a 4- or 6-digit PIN against a stored hash of either length. `set` accepts **only** 6. Existing PINs keep working until their owner changes one; new PINs are 6 from the moment this ships.

### Track D — Failure visibility and user-controlled lockdown

| # | File | Class | Change |
|---|---|---|---|
| D1 | `supabase/migrations/<new>.sql` | **Database** | `user_settings`: add `voice_pin_failed_count int default 0`, `voice_pin_failed_at timestamptz`, `voice_unregistered_blocked boolean default false` |
| D2 | `index.js` `/voice/pin-result` | Backend | On failure against a **claimed** account, increment that account's counter — now attributable, which it never was before |
| D3 | `index.js` | Backend | At threshold, send an SMS via `send-sms` to the registered number: *"Someone tried your voice PIN. Reply BLOCK to stop calls from unregistered phones."* |
| D4 | `supabase/functions/receive-sms-reply/index.ts` | Backend | Recognise `BLOCK` from a registered number → set `voice_unregistered_blocked = true` |
| D5 | `index.js` `/voice` | Backend | If the resolved account is blocked, refuse the PIN path entirely |
| D6 | `app/settings.tsx` | **UI** | Show blocked state and allow re-enable. **Only** the app can unblock — the recovery channel stays stronger than the attacked one |

### Track E — Tests (Rule 15a)

| # | File | Class | Change |
|---|---|---|---|
| E1 | `tests/catalogue/s1-voice-pin-scoping.ts` | **NEW** — Tests | Negative control: a PIN is **never** matched against a non-claimed account. Plus collision → asks for more digits; zero match → no account-existence disclosure; 4-digit verify still works, 4-digit `set` refused |
| E2 | `tests/catalogue/voice-pin.ts` | Tests | Extend for 6-digit and the migration window |
| E3 | `tests/runner.ts` | Tests | Register |

## 3. Change Impact Matrix

Every row answered; an omitted row is not the same as "not affected."

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **YES** | `app/settings.tsx` — PIN input length (C5) and blocked-state UI (D6). No auth change; Google OAuth untouched |
| **Voice** | **YES** | The bulk of the change — Tracks A, B, C1-C3, D2-D5 |
| **Shared Core** | **YES** | `manage-voice-pin` (C4), `receive-sms-reply` (D4), `send-sms` (called, unmodified) |
| **Database** | **YES** | One migration, three additive columns (D1). No existing column altered, nothing dropped |
| **Cron** | **NO** | No `cron.job` entry added, removed, or rescheduled |
| **API contracts** | **YES** | `manage-voice-pin`'s accepted `pin` length changes. Both callers (mobile, voice) are in this plan; no third consumer exists **[FRESH, Phase 1A §2]** |
| **Tests** | **YES** | E1-E3 |

**Duplicated capability handling.** Phase 1A reclassified **PIN-setting** as Duplicated — `app/settings.tsx:605,:642` and `index.js:10431`. **Both change**: mobile gets the 6-digit input (C5), voice gets the intercept gated off for PIN sessions (B3). Neither is left at the old rules. This is the failure shape of B9g/B9n and B10w, and it is explicitly avoided here.

## 4. Mandatory Architecture Impact Checklist

- **Modifies Shared Core?** **YES** — `manage-voice-pin`, `receive-sms-reply`.
- **Modifies an Entry Point?** **YES** — the voice server. The changes are identity resolution and flow control, which is an entry point's proper job, so entry-point responsibility is not violated.
- **Introduces new duplication?** **NO.** Track A *removes* a parallel path (the all-accounts search). No logic is copied between surfaces.
- **Eliminates existing duplication?** **PARTLY** — `getUsersWithVoicePin()` is deleted outright.
- **Modifies Protected Core?** **YES** — Authentication and Permissions. Phase 3 and Phase 6 review both mandatory.

## 5. Regression Impact

| Area | Affected? |
|---|---|
| **Voice commands** | **Yes, for unregistered callers only** — one extra prompt before the PIN. Registered callers see no change |
| **Onboarding** | **Yes** — first-call flow shares `/voice`; must be re-verified that A1 doesn't intercept a first-time registered caller |
| **SMS / call alerts** | **Yes** — `send-sms` gains a caller (D3), unmodified itself |
| **Notifications** | Not affected |
| **Geofencing** | Not affected |
| **Gmail integration** | Not affected |
| **Calendar integration** | Not affected |
| **Reminders** | Not affected |
| **Staging build** | Affected by design — this is exercised on staging first |

### Regression Matrix — per-change consumer trace

Consumers found by search, not recall (Phase 1A §2).

**`manage-voice-pin` — 3 consumers, all in this plan:** `app/settings.tsx:605,:642` (set/remove), `index.js:6785` (verify), `index.js:10431` (set). Plus `tests/catalogue/voice-pin.ts`. **No fourth consumer exists.**

**`receive-sms-reply` — existing consumer is the ticket-reply flow.** D4 adds a branch; the ticket path must be proven unaffected by a `BLOCK` body never matching it.

**`send-sms` — many consumers**, all unmodified. D3 adds one caller.

**`user_settings` — additive columns only.** No existing consumer reads the three new fields, so none can break.

## 6. Risk classification — HIGH

**Justification.** This is **Authentication**. The failure mode is not a visible error — it is either locking a legitimate user out of their own account, or leaving a hole open while believing it closed. Both are silent.

Specific risks:
1. **Migration** — a mistake in the 4-or-6 verify window locks out every existing PIN holder. Mitigated by E1's explicit 4-digit-still-verifies test.
2. **Onboarding collision** — `/voice` is shared with the first-call path; A1 must not intercept a registered caller.
3. **`receive-sms-reply` regression** — a shared inbound webhook gaining a branch.
4. **The `token === serviceKey` literal comparison** in `manage-voice-pin` **[FRESH]** is the same pattern that broke during the key rotation this morning. Not changed by this plan, but noted: it is in the blast radius and Phase 3 may want a view.

**Rollback:** per-function redeploy; the migration is additive so the columns can simply be ignored; `voice_unregistered_blocked` defaults to `false`, so an un-run Track D changes nothing.

## 7. Open items carried into Phase 3

1. **Alert threshold** — how many failures before the SMS. No data exists to calibrate against (Phase 1 §6 Q5); Phase 3 should confirm a conservative starting value, stated as provisional.
2. **Zero-match wording** — refusing without disclosing whether an account exists is stated as a requirement; the exact phrasing needs review so it doesn't leak by implication.
3. **Should `BLOCK` also disable the PIN entirely**, or only the unregistered path? Currently scoped to the latter.
4. **`token === serviceKey`** — in the blast radius, unchanged by this plan. Phase 3 to rule on whether it belongs here or in its own item.

---

**No code written. Awaiting Phase 3 external technical review, then Wael's own explicit go-ahead** (governance §3, Phase-Gate Approval Rule).
