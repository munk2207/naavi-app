# Phase 6 Review Prompt — T4, all passes

**Work item:** T4 — staging/production functional parity
**Date:** 2026-08-20
**Scope of this review:** Passes 2b, 2c, 3 and 4, the drift check and its enforcement, and the
`search_path` fix. Pass 1 and Pass 2a were reviewed separately
(`T4_PHASE_6_TECHNICAL_REVIEW_PASS1_2026-08-20.md`).

**Not in scope:** B11f (voice server, pause/resume) shipped the same day. Different repo,
different work item, its own record.

**Evidence package:** `docs/T4_PHASE_5_EVIDENCE_ALL_PASSES_2026-08-20.md`
**Architecture Reference:** version **2026.07.18.6**, §0c added by this work item.

---

## 1. What was implemented

Everything below is on **Supabase staging** (`xugvnfudofuskxoknhve`). **Production was read from
and never written to** — every production query in this work item was a `SELECT`.

| Pass | Change | Migration |
|---|---|---|
| — | Two CHECK constraints where staging rejected values production accepts (`calendar` document type; three `web-*` ticket sources) | `20260820130000` |
| **2b** | Four tables staging never had: `people`, `conversations`, `pending_disambig`, `waitlist_signups`, with their constraints, indexes and RLS posture | `20260820150000` |
| **3** | Three unique constraints, three indexes (incl. the pgvector index behind knowledge search), one CHECK | `20260820160000` |
| **3** | Three `knowledge_fragments` CHECK constraints, added `NOT VALID` | `20260820170000` |
| **4** | Access policies: read-only on `calendar_events`/`gmail_messages`, delete-own-token, two ticket staff policies | `20260820180000` |
| — | Restored the two policies Pass 4 removed | `20260820190000` |
| — | `search_path` on `search_knowledge_fragments` | `20260820200000` |
| **2c** | Six Edge Function secrets; two cron jobs applied directly (not as migrations — see §4.1); per-environment push identity (`lib/push.ts`, `eas.json`) | — |
| — | Outbound guard extended to the ticket pipeline (`ingest-ticket`, `send-ticket-reply`) | — |

**Tooling:** `scripts/t4-drift-check.js`, `docs/T4_accepted_differences.json`,
`docs/T4_SCHEMA_FINGERPRINT.sql` (amended three times — §5).

**Result: 184 differences → 97.**

---

## 2. Enforcement — the part the last review round rejected twice

Wael's Phase 6 decision required the drift check to be an **enforced automatic gate**, not a
command. Two rounds:

1. Bound to `test:auto`. **Rejected** — correctly. It moved the problem from "remember to run
   drift:check" to "remember to run test:auto".
2. `.githooks/pre-push`, running on every push. Pushing is not optional, so nothing is remembered.

**Both are now in place.** Fails closed: no `STAGING_DB_URL`, or staging unreachable, and the push
is refused rather than waved through.

**Verified both directions before committing, and the commit that added it exercised it live** —
the push output shows the check running and passing before the push was accepted.

---

## 3. Regression evidence

**The drift check is the primary evidence and was verified in both directions.** A gate that has
only ever passed has not been tested:

- Clean at baseline → exit 0
- One accepted difference removed → exit 1, naming it, in the right category
- After each pass: exactly the expected entries closed, **and no new drift**. That second half is
  the real proof — a wrong type, default or policy expression would surface as "defined
  differently" rather than silently matching.

**Manual validation: 8 of 9**, four of them by Wael personally (pause/resume on a live call,
knowledge search, and the three restored code paths). The ticket pipeline counts as his — Claude
sent it, Wael confirmed receiving the emails.

**Only push notifications remain**, legitimately blocked on a staging APK build requiring Wael's
authorisation.

**Wael's caveat, recorded rather than rounded up:** the three restored paths passed, and he wants
them retested in future. No defect named.

---

## 4. Decisions the reviewer should scrutinise

### 4.1 Two cron jobs applied directly, not as migrations

A migration carrying staging's URL is the trap defused the previous night — one would have pointed
production at staging every five minutes. A `-- STAGING ONLY` comment does not stop `db push`
reading the file. The drift check covers cron jobs, so the record is mechanical.

**Is "apply directly, let the drift check be the record" acceptable, or does it create an
un-replayable environment?**

### 4.2 Three constraints added `NOT VALID`

35 rows on staging carry a `source` production rejects. Those rows are the manual-testing
account's memories — a doctor, a prescription, a blood test. Wael's ruling: parity is about
"functions not data that belong to the individual testing each system."

`NOT VALID` applies the rule to new rows and never examines existing ones. **This deliberately
changes staging behaviour**: anything writing `source='conversation'` is now refused there, as
production would refuse it.

**Is a deliberately-divergent constraint state (validated on production, NOT VALID on staging)
acceptable parity, or does it defer a problem?**

### 4.3 Production's Epic policies were NOT copied

Production has `using = true` on four Epic tables — any authenticated user can read every user's
rows. Staging scopes per user. **Staging is correct.** Copying production would have imported the
weaker rule.

Epic was trialled and postponed; its Edge Functions are empty folders; the client gates those
reads behind a per-user check, so it was never reachable.

**Is leaving a known-loose production policy in place, recorded but unfixed, the right call for a
parity work item — or does finding it oblige fixing it?**

### 4.4 A scope wobble, disclosed

Pass 4 removed two staging policies to match production. Wael then instructed that nothing be
deleted from any platform. Both were restored (`20260820190000`), with nothing dropped to restore
them.

**The removal was inside the stated scope and still went the wrong way.** Assess whether the
restore is complete and whether the resulting state — staging carrying both an `ALL` and a
redundant `SELECT` policy — is coherent.

### 4.5 Direction reversed mid-work

Pass 5 was scoped as "triage staging-only items into deliberate versus debris." Wael's ruling:
staging-only means **not yet promoted**, and nothing is deleted. Pass 5 is retired and its 43
items are a promotion list.

---

## 5. Invalidated planning assumptions (governance §Phase 6)

Three, none of which were implementation errors:

**5.1 — Pass 5 assumed debris existed.** Phase 2 planned triage into "deliberate versus debris".
Implementation found no debris: every staging-only item is either unpromoted work or something
staging does *better* than production. The category the plan was built around was empty.

**5.2 — Pass 3 assumed production's constraints could be added as written.** Implementation found
four would fail against existing staging rows. Two of those four were themselves false alarms
(`documents` looked blocked by seven duplicate groups; all rows have a NULL `gmail_message_id`,
and Postgres treats NULLs as distinct in a unique index). The remaining ones needed `NOT VALID`.

**5.3 — The `search_path` fix assumed production's value could be copied.** It could not.
Production's `SET search_path TO 'public','pg_temp'` **fails on staging**:

```
ERROR: operator does not exist: extensions.vector <=> extensions.vector
```

pgvector is in the `extensions` schema on staging and reachable from `public` on production.
Copying production's setting verbatim breaks knowledge search entirely. That is *why* staging's
function had no `search_path`. Applied as `public, extensions, pg_temp` instead.

**This difference was invisible to every comparison run** — the fingerprint recorded extension
names and versions, not schemas. It surfaced only when a migration failed.

---

## 6. Known weaknesses the reviewer should weigh

1. **~20 of the 97 remaining differences are measurement artifacts**, not drift. The fingerprint
   was amended three times mid-work (normalised function hashing; redact-before-truncate for cron
   commands; extension schemas). Production's snapshot predates all three, so both sides are
   currently measured differently. Known, recorded, resolves at the next production capture.
   **Anyone reading "97" without this context will over-read it.**
2. **The ticket-pipeline guard tests are source-level.** The guard's behaviour is already covered
   behaviourally by `t2-outbound-guard.ts`; the untested link was whether these two functions call
   it. The live alternative files a support ticket on every run. **They catch removal, not misuse.**
3. **The drift check compares staging live against a production snapshot.** Production changing is
   invisible until recapture. Deliberate — it means no production database credentials exist
   anywhere — and sound only because production changes solely by deliberate act.
4. **It compares schema, not data and not Edge Function code.** A function deployed to one project
   and not the other is invisible to it. `sync-active-email-alerts` is exactly that case.
5. **`app.settings.service_role_key` does not exist on staging**, and seven staging crons hardcode
   the key inline. Production reads it from that setting. Deferred deliberately: the failure mode
   lands on alerts, reminders and the morning call, on the environment Wael actively tests.

---

## 7. Architecture impact

**§0c added to the Architecture Reference**, version bumped **2026.07.18.5 → .6 in the same
commit** as the edit — which revision 5's own note asked of whoever came next.

It records that the two Supabase environments are not equal and never were; the three categories
of difference and why collapsing them loses the signal; and, deliberately, **what the drift check
cannot see**.

**One correction this work item made to the Reference's existing claims:** §0b stated an allowlist
guard "sits in Shared Core on every send path" and that production is protected "by construction."
That was true of eight alert-channel senders and **false of the entire ticket pipeline**, which
emailed the real `support@mynaavi.com` inbox from staging with nothing in the way. Now guarded,
and verified in both directions on staging (allowlisted → sent; RFC-2606 reserved address → HTTP
403, ticket correctly left unanswered).

**For the Architecture Drift Rule:** does this count as outcome 2 (intentional approved change,
Reference updated in the same work item) — or does the §0b correction indicate the Reference was
already stale before this work started, which is outcome 3?

---

## 8. Required output

Four independent verdicts, per governance §Phase 6:

- **Technical Review:** PASS / FAIL
- **Architecture Completeness:** PASS / FAIL — including the Architecture Drift Rule question in §7
- **Governance Compliance:** PASS / FAIL
- **Overall Recommendation:** Approved / Approved with Mandatory Changes / Rejected

No numeric scores.

**Please address specifically:**

1. The five decisions in §4, each of which was a judgement call rather than a forced move.
2. Whether the three invalidated planning assumptions in §5 point at a Phase 2 weakness worth
   changing, or are irreducible discovery.
3. Whether weakness §6.1 — a headline number roughly a fifth of which is measurement artifact —
   should block approval until production is recaptured.
4. Whether §6.2's source-level tests are adequate for a path that reaches real customers.
