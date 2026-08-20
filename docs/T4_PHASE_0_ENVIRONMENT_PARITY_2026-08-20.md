# Phase 0 — Intent Approval — T4 — Staging / Production Functional Parity

**Date:** 2026-08-20
**Governance version:** v4.0
**Governance level:** Full Phase 0–8 — touches Shared Core, the database, and both environments.
**Status:** Draft, with the first measurement already done (§3). **Awaiting Wael's approval.**

---

## 1. User Intent

**Wael, in his own words:**

> *"My target is to achieve production and staging as 100% replica (FUNCTION)."*

Everything production can **do**, staging can do. His model, stated plainly and correctly:

> *"Both platforms should be 100% equal (from functionality not DB), then for any new function, we add and test on the staging with clear monitoring of what the delta is until we are satisfied, then we apply this delta to production to reach 100% equal, and the cycle continues."*

**That model is not old-fashioned; it is the correct one, and it is what this work restores.** The parenthesis is the sharp part — equality of *capability*, not of data. Staging should have different rows, different volumes, test users. What must match is what the system can do.

## 2. Why this is opened now

**Wael discovered it by calling both lines within a minute of each other.** Production greeted him normally; staging announced *"this is our first call"* and played a thirty-second, uninterruptible onboarding monologue — on every call.

Cause: `user_settings.first_call_completed_at` **exists in production and not in staging**. The code writes that column to make onboarding play once. Without it, the write fails, the read fails, and it replays forever.

**His expectation had been that staging was a copy of production.** It never was. Staging is a *reconstruction from the migration files* — it contains what those files describe and nothing else. Wherever production holds something no migration describes, staging never had it.

**This is not a T2 defect.** The staging Supabase project predates T2 by months; T2's approved decision was to *share* it. The drift has existed as long as staging has. T2 simply built the first thing that could see it — voice reads a column mobile never touches.

## 3. ⭐ First measurement — already complete for four categories

Read-only, performed 2026-08-19/20. **This is the substance: an unbounded worry is now a list.**

### 3.1 Tables — 4 missing from staging

`waitlist_signups` · `pending_disambig` · `conversations` · `people`

⚠️ **Two of these have been printed as warnings in every auto-tester run for months** (`[fixtures] teardown(people) skipped: Could not find the table 'public.people'`). The system was reporting the drift continuously. It was read as harmless noise about test fixtures.

### 3.2 Columns — 10 missing from staging

| Table | Missing |
|---|---|
| `user_settings` | `morning_call_status`, `morning_call_attempts`, `morning_call_last_attempt`, `voice_keyterms`, `first_call_completed_at` |
| `reminders` | `source` |
| `documents` | `extracted_text`, `ocr_sidecar_drive_file_id` |
| `calendar_events` | `created_at` |
| `user_tokens` | `created_at` |

### 3.3 Secrets — 12 missing from staging

`FIREBASE_SERVICE_ACCOUNT_JSON` · `GOOGLE_CLOUD_STT_KEY` · `GOOGLE_VISION_API_KEY` · `NAAVI_ANON_KEY` · `POSTMARK_INBOUND_ADDRESS` · `POSTMARK_SERVER_TOKEN` · `TWILIO_WHATSAPP_TEMPLATE_REMINDER_SID` · `TWILIO_WHATSAPP_TEMPLATE_TASK_SID` · `VAPID_PRIVATE_KEY` · `VAPID_PUBLIC_KEY` · `VAPID_SUBJECT` · `distance Matrix API` *(name contains a space — likely debris, see §6)*

### 3.4 Edge Functions — none missing

Production 75, staging 82. **Staging is ahead, not behind.** Of the 7 staging-only functions, **5 are referenced by no code at all** (`delete-contact`, `patch-calendar-event`, `seed-demo-email-james`, `sync-active-email-alerts`, `whoami-google-diag`) — dead deployments, not capability production lacks.

### 3.5 ⭐ What the gaps actually mean — the answer to Wael's question

The gaps are not scattered. They cluster, and each cluster is a **feature that cannot work on staging**:

| Feature | Why it cannot work on staging |
|---|---|
| **Morning call** | three state columns missing |
| **Push notifications** | all three VAPID secrets and the Firebase account missing |
| **WhatsApp reminders / tasks** | both template SIDs missing |
| **OCR / document extraction** | Vision API key **and** both `documents` columns missing |
| **Inbound email** | both Postmark secrets missing |
| **Name recognition accuracy** | `voice_keyterms` missing — staging transcribes names *worse* than production, which bears on the open [[B4b]] investigation |
| **First-call state** | `first_call_completed_at` — the defect that exposed all of this ([[B11c]]) |

**Consequence that must be stated plainly:** alert fan-out is specified as SMS + WhatsApp + Email + Push + Voice. **Two of those five channels cannot fire on staging.** Any alert testing done there has been exercising a partial system.

## 4. ⚠️ Not yet measured — and the blocker

| Category | Status |
|---|---|
| **Cron jobs** | **Not measured** — needs SQL access |
| **RLS policies** | **Not measured** — needs SQL access |
| **DB functions / triggers** | **Not measured** — needs SQL access |
| **Indexes / constraints** | **Not measured** — needs SQL access |

**The blocker:** the staging database connection string is in `CLAUDE.md`; **production's is not available in this environment.** Comparing these four needs a read-only production connection.

**Given the alert-fan-out finding, cron jobs are the highest-value unmeasured category** — `evaluate-rules` and `check-reminders` are cron-driven, and a missing or differently-scheduled job would mean alerts behave differently between environments without anything visibly failing.

## 5. Success Criteria

1. Every category in §3 and §4 measured, both directions, with the result written down.
2. Every genuine gap closed **by a migration or a documented configuration step** — not by hand-editing staging, which would leave the files still untruthful.
3. Applying the catch-up migrations to **production is a no-op** (`IF NOT EXISTS`). Production behaviour must not change.
4. Re-running the measurement returns **empty**. That is the proof — not the intention.
5. **A check exists that fails when they drift apart again.**

**Criterion 5 is the one that decides whether this was worth doing.** 1–4 fix today; only 5 keeps it true. Every other "living" artefact in this project decayed without a forcing function — the architecture document sat stale for four months, the version line stopped being bumped, and `people` printed a warning in every test run for months without being read.

## 6. In Scope

- Measuring all categories, both directions.
- Catch-up migrations for genuine gaps.
- Staging configuration for missing secrets (values differ; **presence** must not).
- **Triage of debris.** Not every difference should be copied. `distance Matrix API` has a space in its name; five staging-only Edge Functions are called by nothing. **A gap is not automatically a thing to replicate** — each is proposed for Wael's decision, not silently canonised.
- The drift check (criterion 5).

## 7. Out of Scope

- **Changing production behaviour.** Catch-up migrations must be no-ops there.
- **Copying data.** Functional parity, not row parity — Wael's own distinction.
- **Promoting [[S1]].** Its three `voice_pin_*` columns are legitimately staging-ahead and reach production through S1's own gates, not this work.
- **[[B11f]]**, which is mid-flight.
- Deleting the dead Edge Functions or unused tables — worth doing, separate decision.

## 8. Permanent, intended differences — never "fixed"

Twilio numbers, Railway services, Supabase project refs, API key *values*, test data, and the `OUTBOUND_ALLOWLIST` guard that exists only on staging by design. **If these matched, there would not be two environments.** Parity means the same *names* and the same *capability*, not the same values.

## 9. Completion Criteria

1. A measurement document listing every difference, both directions, all categories.
2. Each difference classified: **replicate** / **debris, delete** / **intended difference**.
3. Migrations written, applied to staging, verified no-op on production.
4. Re-measurement returns empty for everything classified "replicate".
5. The drift check runs automatically and fails on divergence.
6. Architecture Reference §0b updated: it currently presents the two projects as the environments and **does not say staging is migration-built and may therefore differ** — precisely the false confidence that document exists to prevent.

## 10. What Phase 0 does not authorize

No migrations, no configuration changes, no code. **One thing is needed to proceed past the current measurement: a read-only production database connection string** (§4).
