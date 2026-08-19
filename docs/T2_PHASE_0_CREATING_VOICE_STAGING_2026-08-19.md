# Phase 0 — T2 — Creating Voice Staging

**Date:** 2026-08-19
**Governance version:** v4.0
**Status:** DRAFT — awaiting Wael's explicit Phase 0 approval. No implementation may begin until this document is approved (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3, Phase 0).

---

## AMENDMENT — 2026-08-19, same session

**What changed:** duplicate-phone-identity remediation in the **staging** project is added to In Scope (new item 10 below).

**Why:** Phase 1 proved a uniqueness gap from the migration source; the Phase 1 §7 live-staging probe then found the gap is **not theoretical** — `+13433332567` is currently registered to three distinct `user_id`s in `xugvnfudofuskxoknhve` (5 entries across `phone` and `phone_numbers`). The voice lookup terminates in `limit=1` (`naavi-voice-server/src/index.js:994`), so a test call resolves to one of the three arbitrarily.

This blocks Phase 0's own **Success Criterion 1**, which requires a test call to reach the *intended* staging identity — not merely the staging project. T2 cannot demonstrate its own completion criteria while the condition persists, so the remediation belongs inside this item rather than after it.

**Mechanism of the gap, established:** the migration backfills `phone_numbers` from `phone` (`supabase/migrations/20260513000001_user_settings_phone_numbers.sql:38-42`) *before* creating the uniqueness trigger (`:83`). Pre-existing duplicates in `phone` were copied forward without the guard ever running. The trigger has protected every write since; it never saw the data it was created to protect.

**Scope boundary of this amendment — deliberately narrow:**
- **In:** remediation of duplicate phone identities in the **staging** project only, sufficient to establish one number → one identity for T2's test identity.
- **Out:** the production project's equivalent data (untouched, per the original scope declaration). Out: any schema or trigger change to close the gap permanently — that is a separate concern affecting both projects and both duplicated resolution implementations, and is not authorized here.
- **Out:** the open voice phone-registration bug, which remains a separate work item.

**Approved by Wael, 2026-08-19**, explicitly, in response to a numbered choice presenting this against two alternatives (separate item / treat as planning input only).

---

## ⭐ SCOPE DECLARATION — READ FIRST

**This work item targets the VOICE platform ONLY. The Mobile platform is strictly not touched.**

Stated precisely, because a blanket claim would be false and would fail its own Phase 2 Change Impact Matrix:

| | Mobile status under this item |
|---|---|
| Mobile app code (`app/`, `hooks/`, `lib/`) | **Not touched.** Zero files changed. |
| Mobile builds (staging APK or production AAB) | **Not touched.** No build produced under this item. |
| Mobile-facing behavior, for any user | **Not changed.** Nothing a mobile user can observe changes. |
| Production Supabase (`hhgyppbxgmjrwdpdubcx`) | **Not touched.** No deploy, no migration, no config change. |
| Staging Supabase (`xugvnfudofuskxoknhve`) | **SHARED — this is the honest boundary.** Voice-staging will read and write the same staging project mobile-staging uses. See "Known Implications" below. |

The last row is the one real overlap, it is deliberate, and the rails that make it safe are named in the In Scope section. Any later proposal that touches a row marked "Not touched" is an automatic rejection under governance §15 (*"an out-of-scope platform or file was modified"*).

---

## ⭐ THE ARCHITECTURAL DECISION — OPTION 1 vs OPTION 2

Recorded here, at the start, because it is the primary control against scope drift. When this question resurfaces mid-project, it is already answered and approved — it is not re-litigated.

### The problem being solved

Mobile has two real environments (staging Supabase + `ca.naavi.app.staging`, production Supabase + `ca.naavi.app`). **Voice has one.** One Railway service, one branch (`main`), auto-deploying to `naavi-voice-server-production.up.railway.app` (CLAUDE.md:187, :514). Every voice fix for real registered users is therefore developed and deployed straight against production, with no environment to validate it in first.

The only existing exception is F2b's "staging demo line" — a second Twilio number that, inside that same production process, routes demo-account traffic to staging Supabase (`naavi-voice-server/src/voice/getDemoEnvironment.js:37-45`). It covers demo callers only, not real registered users. `docs/F2B_STAGING_INFRA_PROPOSAL_2026-07-01.md:10` already judged this arrangement: *"That's not staging in any meaningful sense — it's feature-flagged production."* That proposal was written and reviewed but explicitly **never executed** (line 4).

Upcoming sessions are planned to be 100% Voice-focused. Without a separate environment, that testing happens on the same service handling real users' calls.

### Option 1 — Voice gets its own staging deployment, pointed at the EXISTING staging Supabase project (**SELECTED**)

A second Railway service, a `staging` branch, a dedicated Twilio number, environment variables pointed at `xugvnfudofuskxoknhve`. Voice-staging shares its backend with mobile-staging. Production is fully insulated.

### Option 2 — Voice gets a completely separate backend (**REJECTED for now**)

A third Supabase project dedicated to Voice, with its own copy of the schema, the ~30 Edge Functions voice calls, and the cron jobs — isolated from production *and* from mobile-staging.

### Why Option 1 was selected

1. **It solves the stated problem in full.** The risk being addressed is *production exposure during voice testing*. Option 1 removes that completely. Option 2 additionally removes exposure to mobile-*staging* — a problem that has not occurred and is not currently in evidence.
2. **The cost profile is right.** Option 1 requires no code changes to achieve the environment split — verified: `naavi-voice-server` contains zero hardcoded project references, every Supabase call is driven by the `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` environment variables. Option 2 is a multi-session build with permanent ongoing cost: a third copy of schema, functions, and crons to keep synchronized forever.
3. **Option 2 works against a standing project principle.** CLAUDE.md's Configuration Discipline mandates one canonical place per configuration type. A third environment makes every "check `cron.job`," "check `functions list`" verification a three-way check permanently, and creates a third surface for the exact drift failure this project has already been burned by (2026-07-20: a production AAB built against a stale backend because the target environment was never verified — `feedback_verify_test_env_before_trusting_gate`).
4. **Option 1's residual risk is addressable with rails, and those rails are in scope** — see In Scope items 5–7.

### What would justify revisiting Option 2

If mobile-staging activity is later shown, with evidence, to have actually interfered with a voice test result — or if voice work is repeatedly blocked because a needed schema change cannot be made additively. Absent one of those, Option 2 stays rejected. Per governance §6, this decision is recorded as an ADR in the same work item.

---

## User Intent

Give the Voice platform its own staging environment, so that voice development and testing during the upcoming voice-focused sessions cannot reach production, real registered users, or production data — while strictly not touching the Mobile platform's code, builds, or behavior.

## Success Criteria

1. Wael can place a test call to a dedicated staging phone number, be recognized as a registered caller, and have the full voice flow work end-to-end — with every read and write landing in the **staging** Supabase project, verified directly (not inferred).
2. During that call and any code deployed to serve it, the **production** voice service, the production Twilio number's configuration, and the production Supabase project are provably unaffected — no deploy, no config change, no data written.
3. A voice code change can be deployed to staging, tested, and iterated on without any path by which it reaches production callers until explicitly promoted.
4. Outbound sends originating from voice-staging cannot reach any phone number or email address outside an approved test allowlist.

## In Scope

1. **A new Railway service** for the voice server, separate from the existing production service — independent environment variables, independent deploys, independent URL.
2. **A `staging` branch** in `munk2207/naavi-voice-server`. `main` remains the production branch, untouched.
3. **A dedicated inbound Twilio number** for staging, whose webhook points only at the new staging Railway service.
4. **Environment variable configuration** on the new service pointing at staging Supabase (`xugvnfudofuskxoknhve`).
5. **Test-identity setup in staging.** Because voice identity **is the caller's phone number** (`req.body.From` → `user_settings` lookup, `naavi-voice-server/src/index.js:6573`, `:994`) — the inverse of mobile, where the signed-in user is the identity and the phone is an attribute — the isolation lever on voice is the **calling phone number**, not a user account. Deciding which number Wael calls *from* when testing voice-staging, and confirming that number resolves to exactly one identity in the staging project, is in scope.
6. **An outbound destination allowlist** for voice-staging, so staging test traffic cannot send SMS / WhatsApp / email / voice calls to anyone outside approved test destinations. Precedent exists: the demo user already has outbound sends blocked for the same reason (`naavi-voice-server/src/index.js:123-125`). This is the one code-bearing item in this work item, and it touches Notification routing (Protected Core).
7. **An additive-only rule for staging schema changes** during voice work — new columns and new tables permitted; renaming, dropping, or changing existing ones is not, because those propagate to mobile-staging. Enforced by review, and stated as a constraint rather than claimed as a technical guarantee.
8. **Architecture Reference update** (`docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`) — this changes what the document claims about Voice's deployment topology. Required at Phase 8 as a merge precondition, not a follow-up.
9. **An ADR** (`docs/adr/`) recording the Option 1 / Option 2 decision above, per governance §6.

## Out of Scope

- **The Mobile platform, entirely** — see the Scope Declaration table above. No mobile file changes, no mobile build, no mobile behavior change.
- **The production voice Railway service and the production Twilio number's configuration** — must remain untouched throughout. This is what protects real callers during this work.
- **Production Supabase** (`hhgyppbxgmjrwdpdubcx`) — no deploy, no migration, no data change under this item.
- **The open voice phone-registration bug** (registered numbers rejected with "This phone isn't registered" — see `docs/SESSION_HANDOFF_2026-08-18_VOICE_PHONE_REGISTRATION_BUG_BUILD325_SUBMITTED.md`). This item builds the environment; it does not fix that bug. The bug is a separate work item with its own governance cycle. It is named here only because it is the first intended beneficiary — fixing it inside this item's scope is an automatic rejection.
- **Option 2** (a third, fully separate Supabase project for Voice) — explicitly rejected above.
- **The F2b staging demo line's own behavior** — its `getDemoEnvironment` mechanism is reused by reference; the demo caller flow itself is not modified.
- **Any voice feature work, refactoring, or cleanup** encountered along the way — governance §0.3 and Phase 4's No Extra Changes Rule apply.

## Constraints

- **Voice only / No mobile / No mobile build / No production deploy.**
- **Full Phase 0–8 governance required.** This touches four Protected Core areas (Voice orchestration, Authentication, Background scheduling, Notification routing — governance §4), so Phase 3 (before coding) and Phase 6 (after coding) external review are both mandatory. Provisional risk classification: **Medium-High** — a misconfigured environment variable is exactly the failure this project has already paid for once.
- **Not a cosmetic change** (governance §7 — configuration and backend both change), so no reduced-rigor path applies.
- **Production must stay live and unaffected for the entire duration** of this work.
- **Wael's own actions required** for the Railway console, Twilio console, and any purchase — these cannot be performed by Claude and will be given as numbered, step-by-step instructions, one at a time.
- **Cost:** one new Twilio number (~$1–2/month) plus a second Railway service. To be confirmed by Wael before provisioning.

## Known Implications — accepted, not hidden

1. **Voice-staging and mobile-staging share one Supabase project.** Data rows do not collide: every voice query is user-scoped (`action_rules?user_id=eq.…` `index.js:531`; `lists?user_id=eq.…` `:323`; `knowledge_fragments?…user_id=eq.…` `:1045`) and CLAUDE.md Rule 10 already makes that mandatory. But the *containers* are shared — tables, columns, Edge Functions, and cron jobs have exactly one copy. In-scope items 6 and 7 are the mitigations.
2. **The additive-only rule is discipline, not a wall.** A destructive migration on staging would reach mobile-staging. Accepted knowingly; the alternative is Option 2's permanent cost.
3. **This does not give Voice a production-parity rehearsal environment.** Staging Supabase's data is not production's data. Staging proves a change *works*; it does not prove it behaves identically against production's data shape.

## Completion Criteria

1. A staging voice call from an approved test number completes end-to-end, with direct evidence (not inference) that every read and write went to `xugvnfudofuskxoknhve`.
2. Direct evidence that the production Railway service, production Twilio number config, and production Supabase were unchanged throughout.
3. The outbound allowlist is verified by test: an attempted send to a non-allowlisted destination is blocked, and a send to an allowlisted destination succeeds.
4. A regression test exists per CLAUDE.md Rule 15a for the allowlist behavior, or the coverage gap is documented and explicitly signed off by Wael.
5. Architecture Reference updated in this same work item (Phase 8 precondition).
6. ADR written recording the Option 1 / Option 2 decision.
7. Holding list (`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`) gains a T2 entry, closed with the evidence trail. (T1a is currently the only T-series item; T2 is free.)
8. Full Phase 0–8 cycle completed, including Phase 3 and Phase 6 external review sign-off.

## Open questions for Phase 1 — not assumed here

1. **Does staging enforce uniqueness on `user_settings.phone` / `phone_numbers`?** Voice's lookup ends in `limit=1` (`index.js:994`), so if one number ever appeared on two rows, one would silently win. If the phone number is the identity on voice, that is the logical key and per CLAUDE.md's data-integrity rules it warrants a UNIQUE constraint. **Not verified — must not be assumed.** Adjacent to the open registration bug.
2. **Which phone number does Wael call from** when testing voice-staging, and does that number already resolve to an identity in the staging project?
3. **Does a usable test identity already exist in staging**, or must one be created?
4. **Do the crons on staging** (`evaluate-rules`, `check-reminders`) require any gating for voice-staging traffic, or is their existing per-user scoping sufficient?
5. **Are the Deepgram / Anthropic / Twilio credentials** shared with production or separated for cost tracking? (Wael's decision.)

---

## Phase 0 Disposition

**Decision: APPROVED.** External Technical Reviewer verdict delivered 2026-08-19 as "Approved with Comments"; since no Phase 0 rewrite was required and the reviewer's four items are Phase 1 *scope requirements* rather than Phase 0 corrections, this maps to **Approved** under governance §13's three permitted decisions. **Wael's own explicit go-ahead given 2026-08-19**, separately from the reviewer's verdict, per the Phase-Gate Approval Rule (§3).

**No Phase 0 amendment required.** The approved scope, Scope Declaration, and Option 1 / Option 2 decision above stand unchanged.

### Reviewer commentary carried forward

- **Scope Declaration preserved as-is.** The reviewer specifically endorsed the distinction it draws — *Mobile itself is untouched, but Mobile-staging and Voice-staging share infrastructure* — as materially more precise than a blanket "Mobile is unaffected" claim.
- **Additive-only schema constraint accepted**, on the explicit understanding already stated in this document: it is a governance control, not technical isolation.
- **Outbound isolation is not solely a Voice-server problem.** The reviewer's central finding: an action originating from Voice-staging continues executing after the voice server is out of the loop — Voice staging → Supabase write → Edge Function / cron / background processor → SMS / WhatsApp / email / call. If any downstream component can independently perform an outbound action, an allowlist enforced only inside the Voice Railway service does not deliver the isolation Success Criterion 4 claims.

### Mandatory Phase 1 requirements

Open question 4 below is **elevated from an informational question to a mandatory architecture trace.** Phase 1 must prove all four of the following before any implementation is designed:

1. **Trace all outbound execution paths**, including delayed and background execution, and determine exactly where the staging allowlist must be enforced for Success Criterion 4 to actually hold.
2. **Establish the actual Voice identity model in staging**, and verify whether phone-number uniqueness is enforced — not assumed.
3. **Inventory every staging cron job and Edge Function that can act on Voice-created records**, and determine whether user scoping alone provides sufficient isolation.
4. **Establish how the staging service can be positively identified at runtime**, so Phase 5 evidence can prove *"this transaction executed in staging"* rather than *"the environment variable was configured for staging."*

Requirement 4 exists so the Phase 5/6 evidence package rests on observed runtime fact rather than configuration inference — the precise failure mode recorded in `feedback_verify_test_env_before_trusting_gate` (2026-07-20).

**Phase 1 authorized to begin.** No code is written during Phase 1 (governance §3).
