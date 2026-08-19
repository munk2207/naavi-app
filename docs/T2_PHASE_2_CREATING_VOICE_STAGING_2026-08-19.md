# Phase 2 — Change Plan — T2 — Creating Voice Staging

**Date:** 2026-08-19
**Governance version:** v4.0
**Phase 0:** APPROVED 2026-08-19, amended same session (duplicate-identity remediation added to In Scope).
**Phase 1:** APPROVED 2026-08-19. **Phase 1A:** PASS WITH CORRECTIONS, approved 2026-08-19.
**Status:** REVISED 2026-08-19 following Phase 3 review — see §8 Amendment. **No code written.**

**Risk classification: HIGH.** Justified in §6.

> **⚠️ Read §8 before §2 and §7.** The Phase 3 review returned *changes required*; §8 adds Track F (staging caller ID), resolves §7 item 1, and records two self-reported additions beyond the mandated change.

---

## 1. Design decision — how the allowlist is enforced

**Mechanism: a single shared guard module, inert unless a staging-only secret is present.**

```
OUTBOUND_ALLOWLIST secret absent  →  guard returns ALLOW immediately  →  production behavior byte-identical
OUTBOUND_ALLOWLIST secret present →  destination must match the list  →  otherwise blocked + logged
```

The secret is set **only** on the staging Supabase project. Production is protected *by construction*, not by correct configuration: even if the guarded code were deployed to production, the absence of the secret makes every guard call a no-op.

**Why one shared module rather than eight inline copies:** eight copies of the same destination check would be new duplication, which governance §0.4 forbids and §15 makes an automatic rejection. AI Coding Discipline Rule 19 (*refactor over layer*) permits a new abstraction where it solves a concrete problem — here it prevents eight divergent implementations of a safety check on Protected Core.

**Rejected alternative — disabling the staging cron jobs instead.** Would remove outbound risk but also remove the ability to test alert firing, which is core voice functionality and a primary reason the environment is being built. Rejected; recorded so it is not rediscovered as novel.

**Rejected alternative — enforcement only in the voice Railway service.** Disproven by Phase 1A: covers 1 of 14 outbound call sites.

---

## 2. Files that will change

### Track A — Infrastructure (no repository files)

| Item | Classification | Change |
|---|---|---|
| A1 | Configuration | New `staging` branch in `munk2207/naavi-voice-server`. `main` untouched. |
| A2 | Configuration | New Railway service deploying from `staging`. Production service untouched. |
| A3 | Configuration | New Twilio number; webhook points only at the new service. Production number's config untouched. |
| A4 | Configuration | Env vars on the new service → staging Supabase. `DEMO_TWILIO_NUMBER`/`DEMO_USER_ID` deliberately left unset. |

### Track B — Outbound containment (code)

| # | File | Classification | Change |
|---|---|---|---|
| B1 | `supabase/functions/_shared/outbound_guard.ts` | **NEW** — Shared Logic | Single exported guard: reads `OUTBOUND_ALLOWLIST`; returns allow when unset; otherwise matches destination (phone or email) against the list; logs every decision with the resolved project ref. |
| B2 | `supabase/functions/send-sms/index.ts` | Backend | Call guard before the Twilio POST at `:142`. Covers SMS **and** WhatsApp for all 8 Class A callers. |
| B3 | `supabase/functions/send-user-email/index.ts` | Backend | Call guard before send. Covers `global-search/adapters/contacts.ts:276`, `ingest-ticket`, `send-ticket-reply`, `_shared/task_actions.ts`, and the dispatchers. |
| B4 | `supabase/functions/send-push-notification/index.ts` | Backend | Call guard before send. |
| B5 | `supabase/functions/evaluate-rules/index.ts` | Backend | Guard the direct `Calls.json` POST at `:956`. |
| B6 | `supabase/functions/check-reminders/index.ts` | Backend | Guard the direct `Calls.json` POST at `:157-158`. |
| B7 | `supabase/functions/report-location-event/index.ts` | Backend | Guard the direct `Calls.json` POST at `:834`. |
| B8 | `supabase/functions/outbound-call/index.ts` | Backend | Guard its direct Twilio call. |
| B9 | `supabase/functions/trigger-morning-call/index.ts` | Backend | Guard its direct Twilio call. |
| B10 | `naavi-voice-server/src/index.js` | Backend | Guard the direct SMS at `:7224`. Voice-server-local check (cannot import a Deno `_shared` module). |

### Track C — Identity remediation (staging data only)

| # | Target | Classification | Change |
|---|---|---|---|
| C1 | `user_settings` in **staging only** | Database (data, not schema) | Clear `phone` and `phone_numbers` on `05e821a2…` (mynaavidemo@) and `ae1f3438…` (mynaavi2207@). `f1bc46b8…` (robert.esm.2207@) retains sole ownership of `+13433332567`, per Wael's decision 2026-08-19. Before-state captured for rollback. |

**No schema change. No trigger change.** Closing the gap permanently affects both projects and both duplicated resolution implementations — explicitly excluded by the Phase 0 amendment.

### Track D — Runtime environment proof (Phase 0 Requirement 4)

| # | File | Classification | Change |
|---|---|---|---|
| D1 | `naavi-voice-server/src/index.js` | Backend | Stamp the resolved Supabase project ref (parsed from `SUPABASE_URL`) and Twilio `CallSid` into the existing `client_diagnostics` write at `:61-78`. Replaces the literal `build_version: 'voice-server'` at `:74`. |
| D2 | `_shared/outbound_guard.ts` (part of B1) | Shared Logic | Every guard decision logs the resolved project ref, giving cron-side execution the same runtime evidence. |

**Why this satisfies Requirement 4:** the diagnostic row lands in whichever project `SUPABASE_URL` actually resolved to at runtime. Its presence in staging is *observed* proof the transaction executed there — it cannot be produced by a service that in fact reached production.

### Track E — Tests (CLAUDE.md Rule 15a)

| # | File | Classification | Change |
|---|---|---|---|
| E1 | `tests/catalogue/outbound-guard.ts` | **NEW** — Tests | Positive control: allowlisted destination passes. Negative control: non-allowlisted destination blocked. **Critical control: guard inert when secret absent** (production-safety regression). Phone-format normalization cases. |
| E2 | `tests/runner.ts` | Tests | Register the new suite. |

---

## 3. Change Impact Matrix

Every row answered explicitly; none omitted.

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **YES — at the shared-backend layer only** | **No mobile file changes. No mobile build. No behavior change for any production mobile user** (production Supabase is not deployed to; the guard never reaches it under this item). **However:** mobile-**staging** calls the same staging Edge Functions, so mobile-staging test sends become subject to the same allowlist. This is a real behavioral change to mobile-staging testing and is stated rather than hidden. Judged acceptable and arguably desirable — staging should not text non-test destinations either — but it is a change, and Phase 3 should confirm acceptance. |
| **Voice** | **YES** | New branch, new Railway service, new Twilio number, guard at `index.js:7224`, diagnostics stamp. |
| **Shared Core** | **YES** | One new module; nine existing functions modified (B2–B9 plus the shared senders). |
| **Database** | **YES — staging data only** | Track C. No schema change, no migration, no trigger change, production untouched. |
| **Cron** | **NO change to cron definitions** | No `cron.job` entry is added, removed, or rescheduled. The *functions those crons invoke* are modified (B5, B6, B9) — a distinction Phase 3 should verify is respected in implementation. |
| **API contracts** | **NO** | The guard is internal. No request or response shape changes. A blocked send returns the same success shape with a logged block reason — Phase 3 should challenge whether that is right, or whether callers must observe the block. |
| **Tests** | **YES** | E1, E2. |

**Duplicated capability handling.** Phase 1A reclassified phone→identity resolution as **Duplicated** (`naavi-voice-server/src/index.js:994` and `supabase/functions/ingest-ticket/index.ts:175`). **Neither implementation is changed by this plan.** Track C remediates the *data* both read, not the resolution code. The uniqueness gap remains open in both, by the Phase 0 amendment's explicit exclusion. Stated so the omission is a decision on record, not silence.

---

## 4. Mandatory Architecture Impact Checklist

- **Modifies Shared Core?** **YES** — one new `_shared` module, nine Shared Core functions.
- **Modifies an Entry Point?** **YES** — `naavi-voice-server/src/index.js` (B10, D1). Both changes are guard/telemetry, not business logic, so entry-point responsibility is not violated.
- **Introduces new duplication?** **NO.** Avoided via the single guard module. B10 was originally planned as a small equivalent check inside the Node voice server (which cannot import the Deno `_shared` module) and was flagged here as a second implementation needing an Architecture Exception ruling. **Resolved 2026-08-19 during Phase 5: B10 was dropped, not excepted.** Its target — the direct-to-Twilio SMS at `naavi-voice-server/src/index.js:7224` — is the F2b demo-line recap send, and is unreachable on the staging service because both demo-number variables are unset there (full evidence chain in `T2_PHASE_5_…` §7 item 1). Guarding unreachable code by duplicating the rule would violate §0.4 for no safety gain. **No Architecture Exception is required, because no duplication is introduced.** The safety is configuration-dependent — see the invariant recorded in Phase 5 §7 and holding-list item T3.
- **Eliminates existing duplication?** **NO.**
- **Modifies Protected Core?** **YES** — Notification routing, Action Rules, Reminder Engine, Background scheduling (Architecture Reference lines 119, 120, 126, 127). Mandatory Phase 3 and Phase 6 review.

---

## 5. Regression Impact

Each item answered explicitly; silence is not acceptable.

| Area | Affected? |
|---|---|
| **Voice commands** | **Not affected in production.** Staging voice gains the guard. |
| **Geofencing** | **Affected in staging only** — `report-location-event` (B7) and `fire-pending-dwells` fire geofence alerts through guarded paths. Production untouched. Geofence *detection* logic is not modified. |
| **Gmail integration** | **Not affected.** `sync-gmail` performs no outbound sends. |
| **Calendar integration** | **Not affected.** No calendar read/write path is modified. |
| **Reminders** | **Affected in staging only** — `check-reminders` (B6) is on the modified list. The reminder *engine* is unchanged; only its send step is guarded. |
| **SMS / call alerts** | **Directly affected — the highest-risk area.** All three shared senders and five direct-Twilio sites are modified. This is the regression surface that justifies the HIGH classification. |
| **Onboarding** | **Not affected.** No auth, sign-in, or first-run path is modified. |
| **Staging build** | **Affected by design** — a new staging voice deployment is the deliverable. |

### Regression Matrix — per-change consumer trace

Consumers found by search (Phase 1A §3), not recalled.

**`send-sms` — 8 consumers.** `_shared/task_actions.ts`, `check-reminders`, `evaluate-rules`, `geofence-health-check`, `global-search/adapters/contacts.ts`, `ingest-ticket`, `report-location-event`, `send-ticket-reply`. Every one must still send normally when the guard is inert.

**`send-user-email` — same 8 call-site set**, confirmed at `global-search/adapters/contacts.ts:276`, `evaluate-rules:814,:880`, `check-reminders:196`, `report-location-event:787`.

**`send-push-notification` — 4 confirmed consumers:** `evaluate-rules:888`, `check-reminders:203`, `report-location-event:794`, plus geofence paths.

**Direct-Twilio sites — 5**, each its own consumer: `evaluate-rules:956`, `check-reminders:157`, `report-location-event:834`, `outbound-call`, `trigger-morning-call`.

**`naavi-voice-server/src/index.js:7224` — 1 consumer** (the voice server itself).

---

## 6. Risk classification — HIGH

**Justification.** The change places a conditional gate on the send path of every alert channel the product has. The failure mode is not a visible error — it is **silent alert loss**: a guard that wrongly blocks would stop real messages to real people, and per the Architecture Reference (line 120) that class of failure is *"invisible until the user notices it never happened."*

**Mitigations built into the design:**
1. **Inert-by-default.** No secret → immediate allow. Production cannot be affected without someone setting a secret there.
2. **Production is not deployed to under this item**, so production runs today's unguarded code throughout.
3. **A dedicated negative-control test** (E1) asserts the guard is inert when the secret is absent — the single most important regression test in this plan.
4. **Rollback is per-function**: redeploy the prior version. Track C rollback restores captured before-state values.

---

## 7. Open items carried into Phase 3

1. **Hardcoded production caller ID.** `+12495235394` is hardcoded at `evaluate-rules:907` and `check-reminders:125`; `report-location-event`, `outbound-call`, and `trigger-morning-call` are **not yet checked** for the same literal. Staging would place calls presenting as production Naavi — and a callback to that number reaches production. **Not in this plan's scope.** Phase 3 should rule on whether it must be.
2. **Blocked-send return shape** (§3, API contracts row) — should a blocked send report success or surface the block to its caller?
3. **The voice-server guard duplicate** (§4) — Architecture Exception, or accepted runtime-boundary necessity?
4. **CLAUDE.md test-account line.** It designates `mynaavi2207@gmail.com` as the test account for all gates, but Wael selected `robert.esm.2207@gmail.com` as T2's staging voice identity. The doc may need updating; **not changed by this plan.**
5. **Credential separation** — Deepgram / Anthropic / Twilio shared with production or separated. Wael's decision, still open.

---

---

## 8. AMENDMENT — 2026-08-19, following Phase 3 review

**Phase 3 verdict:** *changes required before approval* — one blocker, everything else acceptable. Mapped to **Approved with Mandatory Changes** under governance §13, since the required change is narrow and listable.

> **Blocker as stated:** *"the plan leaves the hardcoded production caller ID unresolved. A Voice-staging outbound call must not present the production Naavi number or create a callback path into production."*
> **Required:** *"Phase 2 must ensure every staging outbound voice-call path uses the dedicated staging Twilio number, with production behavior unchanged."*

### 8.1 Prerequisite finding — the literal appears in **five** sites, not two

Phase 2 §7 item 1 listed three functions as *"not yet checked."* All three carry it. **[FRESH]** — `grep -rn "12495235394" supabase/functions/ naavi-voice-server/src/`:

| # | Site | Shape |
|---|---|---|
| 1 | `check-reminders/index.ts:125` | local `const twilioFrom` |
| 2 | `evaluate-rules/index.ts:907` | local `const twilioFrom` |
| 3 | `report-location-event/index.ts:812` | local `const twilioFrom` |
| 4 | `trigger-morning-call/index.ts:163` | local `const twilioNumber` |
| 5 | `outbound-call/index.ts:19` | **module-level** `const TWILIO_FROM_NUMBER` — different change shape from the other four |

**§7 item 1 is now resolved and moved into scope.** No outbound voice-call path is left unaccounted for: these five are the complete set from Phase 1A's Class B inventory (the sixth Class B entry, `send-sms`, is SMS and carries no caller-ID literal).

**Voice server: not affected.** Its only direct Twilio call is `Messages.json` (SMS) at `index.js:7224`. It places no outbound voice calls — it receives them. Track F is Supabase-side only. **[FRESH]**

### 8.2 Track F — staging caller ID (NEW)

**Mechanism — identical inert-by-default pattern to the destination guard**, which Phase 3 accepted:

```
VOICE_CALL_FROM_NUMBER secret absent  →  fall back to '+12495235394'  →  production byte-identical
VOICE_CALL_FROM_NUMBER secret present →  use it (staging Twilio number)
```

The secret is set **only** on the staging Supabase project. Production behavior is unchanged by construction, not by correct configuration — the same property Phase 3 already approved for the guard.

| # | File | Classification | Change |
|---|---|---|---|
| F1 | `_shared/outbound_guard.ts` (extends B1) | Shared Logic | Add second export `resolveCallerId()`. No new file — the module's single concern is *environment-conditional outbound safety*; destination allowlist and caller ID are two faces of it (Rule 22 focus test satisfied). |
| F2–F6 | The five sites in §8.1 | Backend | Replace the literal with `resolveCallerId()`. **These five files are already in the plan (B5–B9) for the destination guard — Track F adds a second change to the same files, not new files.** |

**No new Twilio purchase.** Track A3's staging number serves both inbound and outbound; a Twilio number is voice-capable in both directions. **Implementation note for Phase 4:** confirm voice capability at purchase time.

**Callback path — the reviewer's specific concern, resolved.** A staging outbound call now presents the staging number; calling it back reaches the staging Railway service, not production. `outbound-call/index.ts:19`'s module-level const requires converting to a call at each use site (`:63`) rather than an in-place literal swap.

### 8.3 Self-reported additions beyond the mandated change — flagged for re-review

Governance §13 restricts *Approved with Mandatory Changes* to the listed changes only. The following two items arose from evidence found **after** the reviewed draft was written and are recorded here rather than folded in silently, so Phase 3 can evaluate them explicitly. **Neither changes any file in the plan.**

**Addition 1 — the mobile-staging collision risk is not hypothetical.** `tests/.env:14-18` states robert.esm.2207@gmail.com *"is used for live manual testing/demos and its calendar_events were wiped by the suite's own unscoped teardown (`tests/lib/fixtures.ts:91-94`)"* — tracked as **B10y, still OPEN**. That account is T2's chosen staging voice identity (Wael, 2026-08-19).

*Bearing on the record:* Phase 0's Option 1 rationale argued that mobile-staging interference was *"a problem that has not occurred and is not currently in evidence."* **That statement was wrong** and is corrected here. Phase 0's stated condition for revisiting Option 2 — *"if mobile-staging activity is later shown, with evidence, to have actually interfered"* — is arguably met. **Not a unilateral reversal:** the appropriate remedy is fixing B10y's unscoped teardown, not building a third environment, since Option 2 would not have prevented a test suite from wiping data in its own project. **Flagged for Wael's determination.**

**Addition 2 — the auto-tester writes the column Track C depends on.** `tests/lib/fixtures.ts:85-98` snapshots and restores `user_settings.phone` / `phone_numbers` for `STAGING_TEST_USER_ID` (`ae1f3438…`, mynaavi2207@). After Track C makes `f1bc46b8…` sole owner of `+13433332567`, a suite write of that number to `ae1f3438…` would raise the uniqueness trigger (ERRCODE 23505) and fail the run — **the auto-tester could begin failing because of T2.**

*Mitigation — verification step, no code change:* after Track C, run `npm run test:auto` against staging once and confirm no constraint failure. Added to Phase 5's evidence requirements.

### 8.4 Unchanged by this amendment

Risk stays **HIGH**. The Change Impact Matrix (§3) gains no new layer — Track F touches files already marked affected, adds no schema change, no cron change, no API contract change. Regression Impact (§5) is unchanged except that *SMS / call alerts* now covers caller-ID resolution as well as destination filtering.

### 8.5 Still open

- §7 items 2, 3, 4, 5 remain open as written. Item 1 is closed by this amendment.
- The proposed CLAUDE.md test-account clarification is **awaiting Wael's approval and has not been made.**

---

**No code written. Awaiting Phase 3 re-review of this amendment, then Wael's own explicit go-ahead** (governance §3, Phase-Gate Approval Rule).
