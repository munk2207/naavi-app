# Phase 7 — Testing — T2 — Creating Voice Staging

**Date:** 2026-08-19
**Governance version:** v4.0
**Phase 6:** APPROVED 2026-08-19 — *"The previous B10 blocker is satisfactorily resolved… All four required manual verifications are now complete… No further Phase 5 changes required."*
**Status:** DRAFT — awaiting Wael's go-ahead for the Phase 7 → 8 transition.

**All timestamps EST (America/Toronto).**

---

## 1. Governance requirement

Phase 7 states: *"Existing automated testing continues unchanged. Manual validation remains mandatory for features such as: Voice, Phone, Geofencing, Notifications, Screen behavior, Permissions, Background execution, End-to-end integrations. Passing automated tests alone is not sufficient."*

Each applicable category is answered below. Categories T2 does not touch are marked so explicitly rather than omitted — an omitted row is not the same as "not affected."

---

## 2. Manual validation by mandatory category

| Category | Applicable? | Result |
|---|---|---|
| **Voice** | Yes | **PASS.** Live call to `+13435041572` answered from staging data — calendar (Blood Test Aug 21, Amoxicillin twice daily), memory (Dr. Sarah follow-up), lists (`work`), alerts (both correctly reported disabled). |
| **Phone** | Yes | **PASS.** Caller recognised from `+13433332567` with **no PIN prompt**, confirming Track C's identity remediation end to end. |
| **Notifications** | Yes | **PASS.** A staging alert fired to an allowlisted destination arrived on **SMS, WhatsApp and voice call**. Separately, a send to a non-allowlisted destination was **blocked** with Twilio never called. Both directions of the guard proven live. |
| **Background execution** | Yes | **PASS, after repair.** The first attempt failed — see §3. Cron path now verified returning HTTP 200 unaided at the 06:21 tick. |
| **End-to-end integrations** | Yes | **PASS.** Twilio → Railway (staging) → Supabase (staging) → Twilio outbound, exercised in both the inbound-call and outbound-alert directions. |
| **Geofencing** | Not exercised | Location-trigger alerts route through `report-location-event`, which is guarded (Phase 5 §2) but was not fired during testing — no geofence arrival occurred. **Stated as untested, not assumed working.** |
| **Screen behavior** | No | Mobile UI untouched. No mobile file changed. |
| **Permissions** | No | No permission surface modified. |

## 3. What manual testing found that automation did not

**The single most consequential finding of this work item came from Phase 7, not from any test suite.**

The reminder created during the conversational call never arrived. Automated tests could not have caught it: the rule was written correctly, the function worked when invoked directly, and every unit test passed. Only an end-to-end wait for a real message exposed that **every staging cron was failing authentication** — returning HTTP 401 behind a `cron.job_run_details` status of "succeeded", with an empty `sent_messages` table as the only outward symptom.

Nothing time-based had been working on staging at all — no alerts, no reminders, no morning calls — for an unknown period.

This is precisely the case governance's *"passing automated tests alone is not sufficient"* clause exists for, and it is worth recording as evidence that the clause earns its keep.

Repaired (7 of 11 jobs) and re-verified within the same session; full account in Phase 5 §3.

## 4. Automated testing — unchanged and green

| Suite | Result |
|---|---|
| T2 outbound guard (`tests/catalogue/t2-outbound-guard.ts`) | 10/10 |
| T2-F1 voice env selection (`tests/catalogue/t2-voice-env.ts`) | 7/7 |
| Voice server suite (`node --test test/*.test.js`, `staging` branch) | 102/102 |
| **Gate 2 against STAGING** | **46 selected, 42 passed, 0 failed, 4 correct skips** |

The Gate 2 run is itself new capability: before T2-F1 the harness had a single hardcoded production voice URL and **could not target staging at all**. Both banner halves read STAGING, so the split-brain the guard exists to prevent did not occur.

Gate 1 (mobile) was not re-run and is not claimed — T2 changed no mobile file, and Gate 1 excludes every `platform:'voice'` test.

## 5. Regression check — production unaffected

- Production Edge Functions **not deployed** to; production runs its pre-T2 code.
- Neither guard secret exists on production, so both guards are inert there **by construction**, not by configuration.
- Production Railway service and the `+12495235394` webhook unmodified; webhook re-confirmed pointing at `naavi-voice-server-production.up.railway.app` after all work.
- `main` on the voice repo untouched; all T2 voice work is on `staging`.

**One production change did occur this session, and it was not T2's:** the production voice server's revoked `SUPABASE_SERVICE_ROLE_KEY` was replaced by Wael, fixing an unrelated pre-existing outage. Recorded in Phase 5 §3 because T2's work is what surfaced it, but it is **not** part of this work item's deliverable and was not performed by this item's authority.

## 6. Known gaps carried forward, not closed by Phase 7

1. **Geofence path untested** (§2) — guarded in code, never fired.
2. **Track D partial** — the runtime environment stamp was scoped alongside B10 and, with B10 dropped, never built. The boot log substitutes but proves less: what the process started with, not what a given transaction reached.
3. **Containment depends on a configuration invariant** — `DEMO_TWILIO_NUMBER` / `STAGING_DEMO_TWILIO_NUMBER` must stay unset on `naavi-voice-staging`. Recorded in the Architecture Reference §0b and holding-list T3.
4. **Three voice defects found during testing** are documented, not fixed: **B11c** (name missing on staging, works on production), **B11e** (garbled speech onset), **F23** (hardcoded city vocabulary). All deliberately deferred, per the standing instruction to record findings from live calls rather than chase them.

---

**Phase 7 verdict: PASS.** All applicable mandatory categories validated, with two exceptions stated rather than assumed — geofencing untested, and the gaps in §6.

**Awaiting Wael's explicit go-ahead for the Phase 7 → Phase 8 transition** (governance §3, Phase-Gate Approval Rule).
