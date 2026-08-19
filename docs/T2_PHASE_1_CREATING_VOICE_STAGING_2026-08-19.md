# Phase 1 — T2 — Creating Voice Staging

**Date:** 2026-08-19
**Governance version:** v4.0
**Phase 0:** `docs/T2_PHASE_0_CREATING_VOICE_STAGING_2026-08-19.md` — APPROVED 2026-08-19 (Wael's own go-ahead, separate from reviewer verdict).
**Status:** DRAFT — awaiting review. No code written during this phase (governance §3).

**Evidence convention.** Per the Verification Provenance Rule (§3, Phase 1A), every architectural claim below is tagged either **[FRESH]** — a grep/read was performed this session to produce this specific claim, with `file:line` — or **[CITED]** — resting on the Architecture Reference's existing classification without a fresh check.

**Scope reminder.** Voice platform only. Mobile code, mobile builds, and mobile-facing behavior are untouched. Voice-staging and mobile-staging share the staging Supabase project — the deliberate, documented overlap from Phase 0.

---

## 1. What exactly is the problem

This is not a defect report. It is an infrastructure gap: **the Voice platform has no environment in which a change can be exercised before it reaches real callers.**

Mobile has two environments. Voice has one Railway service on one branch (`main`), auto-deploying to a URL that names itself production (CLAUDE.md:187, :514). The only existing exception routes demo-account traffic — not registered users — to staging (`naavi-voice-server/src/voice/getDemoEnvironment.js:37-45`) **[FRESH]**.

Phase 0 selected Option 1: a second Railway service pointed at the existing staging Supabase project. Phase 1's job is to determine whether that architecture can actually deliver Phase 0's Success Criterion 4 — *"outbound sends originating from voice-staging cannot reach any phone number or email address outside an approved test allowlist"* — and what else must be true for the isolation to be real.

**Answer, stated up front: as originally conceived, it cannot.** An allowlist placed in the voice Railway service would leave live outbound paths open. The evidence follows.

## 2. Root cause of the isolation gap

**Root cause: proven.**

The voice server is not the last actor in an outbound sequence. It writes a row and exits. Minutes later, schedulers running *inside Supabase* read that row and perform the send themselves — with production-grade credentials, and with no involvement from the Railway service that created it.

```
Voice staging  →  write to staging Supabase  →  [voice server is done]
                                              ↓
                        cron (every minute, inside Supabase)
                                              ↓
                     ┌────────────────────────┴───────────────────┐
              Class A: via Edge Function              Class B: direct to Twilio
              send-sms / send-user-email /            api.twilio.com/.../Calls.json
              send-push-notification                  called from the cron function itself
                     └────────────────────────┬───────────────────┘
                                              ↓
                              real SMS / WhatsApp / email / phone call
```

A destination allowlist inside the voice Railway service sits entirely upstream of this and observes neither class.

## 3. Requirement 1 — Trace of all outbound execution paths

### Class A — outbound performed by a Shared Core Edge Function

| Origin | Call site | Target |
|---|---|---|
| `evaluate-rules::fireAction` | `evaluate-rules/index.ts:805`, `:865` | `send-sms` |
| `evaluate-rules::fireAction` | `evaluate-rules/index.ts:814`, `:880` | `send-user-email` |
| `evaluate-rules::fireAction` | `evaluate-rules/index.ts:888` | `send-push-notification` |
| `check-reminders` | `check-reminders/index.ts:178`, `:185` | `send-sms` (SMS and WhatsApp both) |
| `check-reminders` | `check-reminders/index.ts:196` | `send-user-email` |
| `check-reminders` | `check-reminders/index.ts:203` | `send-push-notification` |

All **[FRESH]**. `send-sms` itself posts directly to `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json` (`send-sms/index.ts:142`) **[FRESH]**. A grep of `send-sms/index.ts` for allowlist/blocklist terms returned no match — **there is no destination filter in the shared sender today** **[FRESH]**.

### Class B — outbound performed directly by the cron function, bypassing every Edge Function

| Origin | Call site | Target |
|---|---|---|
| `evaluate-rules` | `evaluate-rules/index.ts:956` | `api.twilio.com/.../Calls.json` |
| `check-reminders` | `check-reminders/index.ts:157-158` | `api.twilio.com/.../Calls.json` |

Both **[FRESH]**. This class matters more than Class A: even an allowlist added inside `send-sms` would not cover it, because these functions never call `send-sms`.

### Additional finding — hardcoded production caller ID

Both cron functions hardcode the **production** voice number as the outbound `From`:

- `const twilioFrom = '+12495235394';` — `evaluate-rules/index.ts:907` **[FRESH]**
- `const twilioFrom = '+12495235394';` — `check-reminders/index.ts:125` **[FRESH]**

CLAUDE.md identifies `+1 249 523 5394` as the production Twilio voice number. This value is not environment-derived. A staging deployment of these functions would therefore place calls that present as production Naavi. This was not anticipated in Phase 0 and is material to the Phase 2 plan.

### Where enforcement must sit — conclusion

Enforcement at the voice Railway service is **necessary but not sufficient**. To satisfy Success Criterion 4, the allowlist must be enforced at the point of send, inside the staging Supabase project: in the shared senders (`send-sms`, `send-user-email`, `send-push-notification`) for Class A, and in the two direct-Twilio blocks for Class B. Phase 2 must decide the mechanism; Phase 1 establishes only that the enforcement point is Shared Core, not the voice server.

**Consequence for scope:** this reaches Shared Core Edge Functions, which mobile-staging also calls. Phase 2 must state explicitly how a staging-only guard is applied without altering production behavior — the most likely shape being an environment-conditional guard that is inert unless a staging-only secret is present. Not designed here.

## 4. Requirement 2 — Voice identity model and phone-number uniqueness

### The identity model — confirmed

Voice identity **is** the caller's phone number; the user record is what that number resolves to. This is the inverse of mobile, where the signed-in session is the identity and the phone is an attribute.

- Voice: `const callerPhone = req.body.From || '';` (`naavi-voice-server/src/index.js:6573`) → `user_settings?select=user_id&or=(phone.eq.${enc},phone_numbers.cs.{${enc}})&limit=1` (`:994`) **[FRESH]**
- Mobile: `const authToken = session?.access_token ?? SUPABASE_ANON_KEY;` (`lib/supabase.ts:260`) **[FRESH]**

### Uniqueness — **partially enforced, with a proven gap**

A cross-user uniqueness trigger exists (`supabase/migrations/20260513000001_user_settings_phone_numbers.sql:82-85`) **[FRESH]**. Read in full, it does not cover the column the voice lookup also queries:

1. **It fires only on `phone_numbers`.** `BEFORE INSERT OR UPDATE OF phone_numbers` (line 84). An UPDATE touching only the legacy `phone` column does not fire it.
2. **It compares only `phone_numbers` against `phone_numbers`.** The subquery selects `unnest(phone_numbers)` from other rows (lines 62-70). The legacy `phone` column is never examined, on either side of the comparison.
3. **It exits early when `phone_numbers` is NULL.** Lines 58-60 return immediately. A row with NULL `phone_numbers` is entirely unconstrained.

But the voice lookup matches on **both** columns via `or=(phone.eq.X, phone_numbers.cs.{X})` and terminates with `limit=1`.

**Therefore:** two rows can carry the same number — one in `phone`, one in `phone_numbers`, or both in `phone` — without the trigger raising. The voice lookup would match both and select one arbitrarily, with no error surfaced. The migration's own header claims *"voice server can rely on 'one phone = one user' as an invariant"* (line 51-52); that claim holds for `phone_numbers` and does not hold for `phone`.

**Relevance to T2:** Phase 0's Success Criterion 1 requires reaching the *intended* staging identity, not merely staging. Until this gap is closed or proven empty in the staging project, a test call cannot prove which identity it resolved to.

**Not proven — requires live database access:** whether any duplicate actually exists in the staging project today, and whether this migration has been applied to staging at all. Migration files establish intent, not deployed state. Flagged in §7.

## 5. Requirement 3 — Cron and Edge Function inventory

Thirteen migrations define cron jobs **[FRESH]**. Four run **every minute** and can act on records a voice call creates:

| Job | Schedule | Acts on | Can send outbound |
|---|---|---|---|
| `evaluate-rules-every-minute` | `* * * * *` | `action_rules` | Yes — Class A and Class B |
| `check-reminders-every-minute` | `* * * * *` | `reminders` | Yes — Class A and Class B |
| `trigger-morning-call-every-minute` | `* * * * *` | morning-call settings | Yes — outbound voice call |
| `fire-pending-dwells-every-minute` | `* * * * *` | geofence dwells | Yes — fires user-facing alerts |

All **[FRESH]**, from the schedule lines in `20260407000001_evaluate_rules_cron.sql`, `20260402000000_reminders_cron.sql`, `20260415000000_morning_call_cron.sql`, `20260511000001_fire_pending_dwells_cron.sql`.

**Is user scoping alone sufficient isolation?** No — and the distinction matters. User scoping (CLAUDE.md Rule 10) prevents voice-staging rows from being *confused with* mobile-staging rows. It does nothing to prevent a correctly-scoped voice-staging row from causing a **real outbound send to a real phone**. The two are different protections; Phase 0 conflated them, and only the first is delivered by user scoping.

**Not proven — requires live database access:** which of these jobs are actually scheduled in the staging project. Flagged in §7.

## 6. Requirement 4 — Positive runtime identification of the staging environment

The goal is evidence proving *"this transaction executed in staging,"* not *"the environment variable was set to staging."*

**A usable mechanism already exists.** The voice server writes diagnostic rows over REST to a `client_diagnostics` table, using `process.env.SUPABASE_URL` as the base (`naavi-voice-server/src/index.js:61-78`) **[FRESH]**. The significant property: the row lands in whichever project `SUPABASE_URL` actually resolved to at runtime. A diagnostic row present in the **staging** project's `client_diagnostics`, carrying a call-specific identifier, is observed proof that the transaction executed against staging — it cannot be produced by a misconfigured service that in fact reached production.

This is a candidate, not a design. Phase 2 must decide:
- what call-scoped identifier is carried (Twilio `CallSid` is the natural candidate — not yet verified as available at that call site),
- whether the same proof is needed for the cron-side execution (Class A/B sends) as well as the call itself, since those are separate transactions in separate processes,
- whether `build_version` should carry the resolved project ref rather than the current literal `'voice-server'` (`:74`).

**Not designed in this phase.** Phase 1 establishes only that a runtime-observable mechanism exists and does not need to be invented from scratch.

## 7. What is NOT proven — must be resolved before Phase 2 closes

Per the No Assumptions Rule, these are stated as unproven rather than inferred:

1. **Live staging database state is entirely unverified.** Every schema and cron finding above derives from migration *files*. Whether those migrations are applied in `xugvnfudofuskxoknhve`, and what rows exist there now, has not been checked. Requires live query access.
2. **Whether duplicate phone identities currently exist in staging.** Unknown.
3. **Which phone number Wael will call from** for staging tests, and what identity that number resolves to in staging. Wael's decision — open from Phase 0.
4. **Whether a usable test identity exists in staging** or must be created.
5. **Whether Deepgram / Anthropic / Twilio credentials** are shared with production or separated. Wael's decision.
6. **Whether Twilio `CallSid` is available** at the `client_diagnostics` write site.

## 8. Alternatives considered

- **Option 2 — a third, fully separate Supabase project for Voice.** Rejected at Phase 0 with recorded rationale and a stated condition for revisiting. Phase 1's findings do not meet that condition: the outbound exposure traced here is present under Option 2 as well, since the cron jobs and senders would be duplicated into that project too. Separation changes *which* project sends; it does not by itself stop a real send. **The allowlist is required either way** — this finding materially strengthens the Option 1 decision rather than weakening it.
- **Allowlist at the voice Railway service only.** Rejected by the evidence in §3 — it observes neither outbound class.
- **Disabling the staging cron jobs entirely** instead of allowlisting. Not evaluated here; it would trade outbound safety against the ability to test alert firing at all, which is core voice functionality. A Phase 2 design question, noted so it is not rediscovered as novel.

## 9. Architecture Reference — ownership and classification

Reference version used: `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, dated 2026-07-18. Per Phase 1A's Version Verification requirement, this must be re-confirmed as current before Phase 8 merge.

| Affected capability | Owner | Classification |
|---|---|---|
| Notification sending (SMS/email) | `send-sms`, `send-email` | **Shared Core** — *"genuinely shared senders — every alert-firing function funnels through these"* (Reference line 62) **[CITED]** |
| Action Rules | incl. `evaluate-rules` | **Protected Core**, Full Phase 1-8 (Reference line 119) **[CITED]** |
| Reminder Engine | `check-reminders` | **Protected Core**, Full Phase 1-8 (Reference line 120) **[CITED]** |
| Background scheduling | `cron.job` entries | **Protected Core**, Full Phase 1-8 (Reference line 126) **[CITED]** |
| Notification routing | `send-sms`, `send-email`, fan-out in `evaluate-rules` | **Protected Core**, Full Phase 1-8 (Reference line 127) **[CITED]** |
| Voice deployment topology | Railway service + branch | **Not currently described** by the Reference. This is the gap T2 closes; the Reference must be updated at Phase 8. **[FRESH]** |

**Consequence:** the allowlist work lands in Shared Core and Protected Core — not in Voice-only code, as Phase 0 assumed when it described the allowlist as *"the one code-bearing item."* That assumption is now known to be incomplete. Phase 2's Change Impact Matrix must mark **Shared Core = affected** and **Mobile = affected at the shared-backend layer**, and must state how production behavior is held unchanged.

## 10. Phase 1 conclusion

- The isolation gap is **proven**, with the enforcement point established as Shared Core rather than the voice server.
- The phone-uniqueness gap is **proven at the schema level** and unverified at the live-data level.
- The Option 1 decision **stands**, and is strengthened rather than weakened by these findings.
- Phase 0's scope stands; one Phase 0 assumption (allowlist as a voice-only change) is corrected here rather than amended there, per the Invalidated Planning Assumption pattern.

**Recommended next step:** Phase 1A — Architecture Completeness Review, then Phase 2. Items 1, 2, and 4 in §7 need live staging access and should be resolved before Phase 2 planning begins, since the plan depends on their answers.

---

**Awaiting review and Wael's own explicit go-ahead before Phase 1A begins** (governance §3, Phase-Gate Approval Rule).
