# Phase 8 — Merge — T2 — Creating Voice Staging

**Date:** 2026-08-19
**Governance version:** v4.0
**Phase 7:** APPROVED 2026-08-19 — *"Phase 7 testing is sufficient… The remaining gaps are explicitly documented and do not block T2 closure."*
**Status:** T2 **CLOSED**.

**All timestamps EST (America/Toronto).**

---

## 1. Merge preconditions (governance §3, Phase 8)

| Requirement | Status |
|---|---|
| Automated tests pass | ✅ 10/10 guard, 7/7 voice-env, 102/102 voice server, Gate 2 42/42 against staging |
| Manual validation passes | ✅ Phase 7, all applicable categories |
| External review completed | ✅ Phase 6 approved 2026-08-19 |
| Architecture Reference updated **in this work item** | ✅ §0b added, commit `2e523a6` |
| No newer Architecture Reference superseded the Phase 1A version | ✅ still `2026.07.18.4` |

All five met. **T2 closes.**

## 2. What shipped

**Voice now has a staging environment.** A call to `+13435041572` reaches a dedicated Railway service on the `staging` branch, reading and writing the staging Supabase project, with outbound sends confined to an approved allowlist.

| Track | Delivered |
|---|---|
| A — infrastructure | `staging` branch (merged level with `main`, `2124150`); Railway service `naavi-voice-staging`; Twilio `+13435041572`; environment variables |
| B — outbound containment | `_shared/outbound_guard.ts` wired into 8 Shared Core functions, covering all 14 outbound call sites |
| C — staging identity | `+13433332567` reduced from 3 claimants to 1 |
| E — tests | 10 guard cases + 7 voice-env cases, registered |
| F — caller ID | 5 hardcoded production numbers replaced with environment-resolved values |
| T2-F1 | Harness can target voice staging; Gate 2 refuses a split-brain run |

**Commits:** `df8aa9a` (guard + caller ID), `cced68c` (T2-F1 + `fixtures.ts` repair), `2124150` (voice repo, `staging` branch), `2e523a6` (Architecture Reference), plus the Phase 0–7 documents.

## 3. Not delivered — stated plainly

1. **Track D (runtime environment stamp) — partial.** `resolveProjectRef()` ships in the guard, but the voice-server-side `client_diagnostics` stamp was scoped alongside B10 and never built once B10 was dropped. The boot log substitutes and proves less: what the process started with, not what a given transaction reached. **Phase 0 Requirement 4 is therefore partially, not fully, satisfied.**
2. **B10 — deliberately not implemented.** Resolved as unnecessary: the one direct-to-Twilio path is the F2b demo recap, unreachable on staging because both demo-number variables are unset. No Architecture Exception was needed because no duplication was introduced.
3. **Geofence path untested.** Guarded in code, never fired.
4. **Containment rests on a configuration invariant, not code.** See §5.

## 4. What T2 found — the case for the work item

The environment justified itself within an hour of existing:

- **Every staging cron was failing authentication** — nothing time-based had *ever* worked on staging, invisibly, behind a "succeeded" cron log. 7 of 11 jobs repaired.
- **The production voice line outage was diagnosed because of it.** Staging threw `"Unregistered API key"` an hour before Wael reported production rejecting every caller. That gave the shape to test for, and closed a bug carried as top priority in `SESSION_HANDOFF_2026-08-18` with four hypotheses already eliminated.
- **Three voice defects surfaced on staging calls** — B11c, B11e, F23 — none of which could previously have been reproduced without calling production.
- **B10y's root fix** was completed en route, and a broken `fixtures.ts` that killed the entire auto-tester was caught and repaired.

## 5. Standing constraints this environment depends on

**⚠️ `DEMO_TWILIO_NUMBER` and `STAGING_DEMO_TWILIO_NUMBER` must remain unset on `naavi-voice-staging`.** The voice server holds one direct-to-Twilio SMS path the Shared Core guard cannot see (`naavi-voice-server/src/index.js:7224`); it is unreachable only because those variables are unset. Setting either requires implementing B10 first. Recorded in Architecture Reference §0b and holding-list **T3**.

**Additive-only schema changes on staging** while voice work is in progress — staging Supabase is shared with mobile-staging. A governance control, not technical isolation.

## 6. Follow-ups opened by this work item

| Item | Status |
|---|---|
| **T3** — separate the Demo line from the Voice platform | Open, Full Phase 1-8, ADR required either way |
| **B11c** — name missing on staging, works on production | Open, clean reproduction available |
| **B11e** — garbled speech onset | Open, recurring |
| **F23** — hardcoded city vocabulary | Open, feature not defect |
| **B10y follow-up** — 4 other unscoped teardown tables | Open |
| Track D completion | Carried forward |
| Secret rotation (session transcript) | Wael's schedule |

## 7. Errors made during this work item, recorded not erased

Kept because a governance record that shows only the clean version teaches nothing:

1. **Broke the auto-tester and pushed it** — an orphaned `*/` in `fixtures.ts` killed both gates. "Verified" with string assertions that cannot detect a syntax error.
2. **Wrong production inference** — claimed production's crons were failing like staging's, citing an empty `sent_messages` table. Both false: 840 × HTTP 200, and 756 rows. A malformed query returning an error was read as a zero result.
3. **False security alarm** — reported committed anon keys as live service-role keys needing rotation. Reading a 200 status as privilege, without checking the role claim on a variable literally named `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Acting on it would have caused an unnecessary rotation.
4. **Ran the auto-tester against production** assuming `--grep` limited its blast radius. It filters test cases; fixtures run regardless. Documented in CLAUDE.md so the next session does not repeat it.
5. **Misrecorded B11c as closed** on both surfaces, then a silent heredoc failure left the wrong version standing until corrected.

The pattern across all five: **reliable when reading evidence, unreliable when extrapolating from it.** Every fix came from tracing something concrete; every error came from pattern-matching one situation onto another and reading ambiguous output as confirmation.

---

## T2 — CLOSED 2026-08-19

Phase 0 → 8 complete, externally reviewed at Phases 3 and 6, with Wael's explicit approval at every phase transition.
