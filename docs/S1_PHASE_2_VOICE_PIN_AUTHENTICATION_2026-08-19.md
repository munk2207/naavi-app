# Phase 2 — Change Plan — S1 — Voice PIN Authentication Hardening

**Date:** 2026-08-19
**Governance version:** v4.0
**Phase 1:** APPROVED. **Phase 1A:** PASS WITH CORRECTIONS, approved 2026-08-19.
**Product decisions recorded:** borrowed-phone path is **kept** (Wael); a PIN-authenticated caller **may not change the PIN** (Wael, option 1).
**Status:** REVISED 2026-08-19 following Phase 3 review — see §8 Amendment. **No code written.**

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

## 8. AMENDMENT — 2026-08-19, required by Phase 3 review

**Phase 3 verdict: CHANGES REQUIRED.** One issue, correctly identified:

> *"D2 increments `voice_pin_failed_count`, but the plan never specifies when it resets after a successful authentication. Without this, legitimate mistakes can accumulate indefinitely and eventually trigger alerts."*

The gap is real. As written, the counter meant *"failures since the account was created"* rather than *"failures that suggest something is happening now."* A user who fumbles once every few months would eventually cross any threshold and receive an alert about nothing.

### 8.1 Required change — reset on success

**D2 amended:** a **successful PIN authentication resets that account's `voice_pin_failed_count` to 0 and clears `voice_pin_failed_at`.**

Reset is on **successful PIN authentication specifically**, not on any successful call. A call from the registered phone does not reset the counter: it proves the *person* is present, but says nothing about whether the earlier PIN attempts were theirs. If someone is working through PINs against an account, the owner phoning in from their own handset should not erase that signal.

### 8.2 Same gap, second half — stale failures must decay

The reviewer's finding exposes a second case it does not name: **a user who never succeeds**. Consider three failed attempts in March, abandoned, then two in August. Reset-on-success never fires, so the count reaches five and alerts — describing a five-month-old pattern as though it were an incident.

**D2 further amended:** failures older than a rolling window of **7 days** do not count toward the threshold. `voice_pin_failed_at` — already in D1 — carries the timestamp needed; no schema change.

**The window was 24 hours in the first draft of this amendment. Wael rejected it, and was right on two counts.**

**A short window is trivially evadable.** At 24 hours an attacker paces: four attempts, wait a day, four more. The counter resets before any threshold, the alert never fires, and the grind continues indefinitely. A short window does not merely inconvenience the user — it defeats the mechanism it exists to power.

**And it does not survive real reading habits.** Wael: *"24 hours is very short, Robert can check his SMS every two days."* If the owner reads SMS every other day, a 24-hour counter has already zeroed by the time they look — the alert describes something the system no longer believes is happening.

**Why 7 days closes it.** To stay under a 5-in-7-days threshold an attacker manages roughly 5 guesses a week. Against a 6-digit PIN scoped to a single account that is 1,000,000 ÷ 5 ≈ **200,000 weeks**. Paced attack stops being worth attempting.

**And it costs legitimate users nothing**, because reset-on-success (§8.1) already clears anyone who eventually gets in. The only people who accumulate across a week are those who repeatedly fail and *never* succeed — precisely the case worth alerting on. There was no argument for 24 hours beyond caution.

### 8.2a ⚠️ Known limitation — the alert does not stop anything

Recorded plainly because it bears on how much protection Track D actually provides, and because the same observation from Wael produced the window change above.

**Notification is not prevention.** Even at a 7-day window, if the owner takes two days to read the SMS, that is two days in which an attacker continues unimpeded. The alert informs; only the owner's `BLOCK` reply — or the app — stops anything.

This is a **deliberate consequence of the bank model** Wael chose over automatic lockout (Phase 0), and that decision is not reopened here: auto-locking hands an attacker a denial-of-service against the real owner, which is worse. But *"the owner is notified"* is materially weaker protection when the owner may be 48 hours away, and Phase 3 should weigh Track D on that basis rather than on the assumption of a prompt response.

**What actually carries the security load is Track A** — scoping the PIN to one claimed account — and **Track C**, the 6-digit length. Track D is a safety net for the case where someone attacks anyway, not the primary defence. Nothing in this plan depends on the owner reacting quickly.

The counter's meaning becomes **"recent consecutive failures"**, which is what the alert is actually about. Both halves are needed: reset-on-success handles the user who eventually gets in, the window handles the user who does not.

### 8.3 Test coverage added

**E1 gains two cases:**
- A successful PIN authentication zeroes the count — a subsequent single failure does not alert.
- Failures older than the window do not count toward the threshold.

### 8.4 Unchanged by this amendment

Risk stays **HIGH**. The Change Impact Matrix (§3) gains no new layer — no schema change is required, since `voice_pin_failed_at` was already in D1. No new file enters the plan. The window value (7 days) remains a **judgement, not a calibration** — there is no usage data to calibrate against, and Phase 1 §6 Q5 records that explicitly. It is, however, a reasoned judgement rather than an arbitrary one: see the pacing arithmetic in §8.2.


---

**No code written. Awaiting Phase 3 RE-review of this amendment, then Wael's own explicit go-ahead** (governance §3, Phase-Gate Approval Rule).
