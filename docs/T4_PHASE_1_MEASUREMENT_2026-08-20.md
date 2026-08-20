# Phase 1 — Measurement — T4 — Staging / Production Functional Parity

**Date:** 2026-08-20
**Governance version:** v4.0
**Phase 0:** approved with required clarification — definition-level equivalence, not `IF NOT EXISTS`
**Method:** `docs/T4_SCHEMA_FINGERPRINT.sql` run read-only against both projects. Production by Wael in the SQL editor; staging directly. Raw production output: `docs/T4_fingerprint_production.json`.
**Status:** Measurement complete. **Awaiting Wael's go-ahead for Phase 1 → 2 (triage and change plan).**

---

## 1. ⭐ Headline: definition-level found ten times more than name-level

Phase 0's measurement compared **names** and found 14 gaps. The Phase 0 reviewer required definition-level comparison instead, warning that an object can exist in both environments and still differ.

**They were right, and the margin is not small:**

| | Name-level (Phase 0) | Definition-level (this phase) |
|---|---|---|
| Differences found | **14** | **89 missing · 44 staging-only · 51 different** |

**The 51 "present in both but different" category did not exist at all in the earlier measurement** — those objects were reported as matching. That category contains the most consequential finding in this document (§3).

## 2. ⚠️ First, a correction to my own numbers

The raw comparison reported **207** objects missing from staging. **118 of those are false positives** — pgvector and pg_trgm functions that exist in production's `public` schema and in staging's `extensions` schema. Same extensions, same versions, different placement.

**Real project functions missing from staging: zero.**

Stated prominently because a 207 that is really 89 is exactly the kind of number that drives the wrong decision, and I would have reported it uncorrected if I had not checked what the names were.

## 3. ⭐⭐ The important finding: 42 columns exist in both with different definitions

Not missing. **Present in both, defined differently.** And the pattern is consistent:

**Production enforces `NOT NULL` where staging does not — including on `user_id`:**

| Column | Production | Staging |
|---|---|---|
| `contacts.user_id` | **NOT NULL** | nullable |
| `calendar_events.user_id` | **NOT NULL** | nullable |
| `gmail_messages.user_id` | **NOT NULL** | nullable |
| `knowledge_fragments.user_id` | **NOT NULL** | nullable |
| `push_subscriptions.user_id` | **NOT NULL** | nullable |
| `naavi_notes.user_id` | **NOT NULL** | nullable |
| `contacts.name`, `naavi_notes.title`, `knowledge_fragments.content`, `calendar_events.google_event_id`, `gmail_messages.gmail_message_id`, `push_subscriptions.endpoint` … | **NOT NULL** | nullable |

Production also holds defaults staging lacks — `gmail_messages.snippet/subject/body_text` default `''`, `calendar_events.attendees` defaults `'[]'`, `knowledge_fragments.confidence` defaults `1.0`, `reminders.user_id` defaults `auth.uid()`.

### 3.1 Why this is the worst possible direction for the difference

**Staging is more permissive than production.**

A row with a NULL `user_id` inserts happily on staging and is **rejected by production**. So:

- **A test that passes on staging can fail in production** — the opposite of what a staging environment is for.
- **Data-integrity tests run on staging prove nothing.** CLAUDE.md's DATA INTEGRITY — FOUR LAYERS makes `NOT NULL` on every depended-upon column *Layer 1*. Staging cannot exercise Layer 1 for these tables, because it isn't there.
- Multi-user safety (Rule 10) rests on `user_id` being present. Staging permits rows that have no owner.

**This is the single most important result in the measurement**, and name-level comparison could never have found it.

### 3.2 A few differ the other way

`contacts.created_at`, `naavi_notes.created_at`, `gmail_messages.is_tier1/is_unread/is_important/updated_at`, `calendar_events.is_priority/updated_at`, `knowledge_fragments.created_at/is_priority`, `user_tokens.updated_at` — staging is **stricter** than production. Also real drift, lower risk.

### 3.3 One piece of debris worth naming

`user_settings.morning_call_phone` has a **DEFAULT of `'+16137697957'`** on staging — Wael's real phone number, hardcoded as a column default. Production has no default. Any row created without an explicit phone silently inherits it.

## 4. Full results by category

Excluding the 118 extension-placement false positives.

| Category | Production | Staging | Missing | Staging-only | **Different** |
|---|---|---|---|---|---|
| Tables | 34 | 31 | **4** | 1 | — |
| Columns | 351 | 327 | **36** | 12 | **42** |
| Indexes | 102 | 95 | **13** | 6 | 0 |
| Constraints | 107 | 102 | **14** | 9 | **5** |
| RLS policies | 53 | 44 | **22** | 13 | 0 |
| Project functions | — | — | **0** | 2 | **3** |
| Triggers | 1 | 2 | 0 | **1** | 0 |
| Extensions | 9 | 9 | 0 | 0 | **1** |
| Cron jobs | 12 | 11 | **2** | 1 | 0 |
| Secrets | 39 | 29 | **12** | 2 | — |
| Edge Functions | 75 | 82 | **0** | 7 | — |

**Tables missing:** `waitlist_signups`, `pending_disambig`, `conversations`, `people`
**Crons missing:** `sync-calendar-every-6h` ← **calendar sync never runs on staging**; `cleanup-old-emails`
**Extension difference:** `pg_net` — production `0.20.0`, staging `0.20.3`

### 4.1 RLS — checked specifically, and the alarming case does not apply

A table with RLS enabled and **no** policy denies everything to non-service-role clients. That would have meant the mobile app on staging could not read its own data.

**Verified: no staging table is in that state.** Every RLS-enabled table on both sides has at least one policy. The 22/13 split is a difference in *how* access is expressed, not a lockout — it needs case-by-case triage, not emergency work.

*(Production has two RLS-enabled tables with no policies — `pending_disambig`, `waitlist_signups` — which is a coherent server-only pattern.)*

## 5. Features that cannot work on staging — the answer to the original question

| Feature | Why |
|---|---|
| **Calendar sync** | `sync-calendar-every-6h` cron missing — `calendar_events` is never populated |
| **Morning call** | 3 state columns missing |
| **Push notifications** | all 3 VAPID secrets + Firebase account missing |
| **WhatsApp reminders / tasks** | both template SIDs missing |
| **OCR / document extraction** | Vision API key + 2 `documents` columns missing |
| **Inbound email** | both Postmark secrets missing |
| **Name recognition accuracy** | `voice_keyterms` missing |
| **First-call state** | `first_call_completed_at` missing ([[B11c]]) |
| **Data-integrity enforcement** | `NOT NULL` missing on 6+ `user_id` columns (§3) |

## 6. Proposed triage buckets for Phase 2

Not yet classified — Phase 0 requires each difference be decided, not copied blindly.

- **Replicate** — the §3 `NOT NULL`/default differences, the missing tables, columns, indexes, constraints, secrets and the calendar cron.
- **Debris, delete** — the `+16137697957` column default; the 5 dead staging-only Edge Functions; the secret literally named `distance Matrix API`.
- **Intended difference** — `OUTBOUND_ALLOWLIST`, `VOICE_CALL_FROM_NUMBER`, S1's three `voice_pin_*` columns (staging-ahead, promoted by S1's own gates), the `pg_net` patch version.
- **Needs a decision** — the staging-only `sync-active-email-alerts` function and its cron: wanted in production, or an abandoned experiment? The 22/13 RLS policy split. The staging-only trigger.

## 7. What this phase does not authorize

No migrations, no configuration changes, no deletions. Phase 2 classifies every difference and writes the change plan; Phase 3 reviews it before anything is applied.
