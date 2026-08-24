# B11x — Phase 2: Change Plan

**Work item:** [[B11x]] — redundant email classification
**Date:** 2026-08-24
**Phase 1:** `docs/B11X_PHASE1_PROBLEM_DEFINITION_2026-08-24.md` (revision 2, approved 2026-08-24)
**Phase 1A:** `docs/B11X_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-08-24.md` — DOES NOT PASS, resolved by Phase 1 revision 2
**Architecture Reference:** 2026.07.18.10

**Status:** **DRAFT — awaiting Wael's Phase 2 → Phase 3 approval.** No code written.

**Risk classification: MEDIUM.** No user-visible behaviour should change. The danger is the opposite of the defect: a guard that is slightly too broad silently stops classifying emails that should be classified, and the symptom — a bill that never arrives in the morning brief — is invisible until a user misses a payment.

---

## 1. Mechanism selected, and why

### The constraint that decides it

Phase 1 §4.2 established that **the fact "this message was classified" does not exist** for the majority of emails: the pre-filter early-returns at `extract-email-actions:151-153` and writes no row, and the code comment at `:107` puts that path at 70-80%. A failed Claude call also writes nothing.

So any guard must *first create the fact*. The choice is **where**.

### Options considered

| # | Option | Covers all 6 trigger paths? | Solves retry? | Schema change? |
|---|---|---|---|---|
| 1 | Detect INSERT vs UPDATE in `sync-gmail`, fire only on insert | ❌ misses `backfill-email-actions:67` | ❌ **breaks Success Criterion 3** | No |
| 2 | **Record the outcome in `extract-email-actions`, guard on it** | ✅ guard sits at the point of expense | ✅ | **No** — uses existing `email_actions` columns |
| 3 | New column or table recording classification state | ✅ | ✅ | **Yes** — not authorized by Phase 0 |

**Option 1 is rejected as the primary mechanism**, and this reverses the direction Phase 0 originally leaned. Today a failed classification *is* retried — accidentally, because everything is retried. Option 1 removes that accident and puts nothing in its place, so an email whose Claude call errors on the tick it arrives is **never classified at all**. That directly violates Success Criterion 3.

**Option 3 is rejected as unnecessary.** `email_actions` already has everything required: `extracted_at`, `created_at`, and `UNIQUE (user_id, gmail_message_id)` (`20260419000001_email_actions.sql`). Adding a column to record what an existing table can already record would fail the Complexity Tax (AI Coding Discipline #23).

### ⭐ Option 2 — selected

**`extract-email-actions` writes an `email_actions` row on every terminal outcome, including the ones it currently skips, and returns early if a row already exists.**

Three outcomes, three behaviours:

| Outcome | Today | Under this plan |
|---|---|---|
| Claude ran, found an action | writes a full row | unchanged |
| Pre-filter rejected the email | **writes nothing** | writes a **sentinel row** — `action_type: null`, all content fields `NULL`, `extracted_at` set |
| Claude call errored | **writes nothing** | **still writes nothing** — so it retries next tick, preserving today's accidental retry deliberately |

The guard is a single existence check at the top of the handler, before the Claude client is constructed.

**Why "error writes nothing" is the right asymmetry:** a pre-filter rejection is *deterministic* — the same email against the same fixed keyword list gives the same answer forever, so re-running it is pure waste. An error is *transient* — the next attempt may well succeed. Recording the first and not the second is what makes Success Criterion 3 hold without any new state.

### What this deliberately does NOT do

- **It does not reduce the number of syncs.** Callers 3 and 4 keep triggering global syncs; that is [[B11y]]. This plan makes each sync cheap instead of making fewer of them. **Consequence to state plainly: `extract-email-actions` will still be invoked ~8,700 times/day; each invocation becomes two indexed DB queries instead of a Claude call.** That removes essentially all of the cost while leaving the invocation count untouched.
- **It does not change cadence.** Out of scope per Phase 0, and cadence is a second Protected Core area.

---

## 2. Files that will change

| File | Classification | Change |
|---|---|---|
| `supabase/functions/extract-email-actions/index.ts` | **Backend** (Protected Core) | Add existence guard before the Claude path; write a sentinel row on the pre-filter branch; leave the error path writing nothing |
| `tests/catalogue/b11x-email-reclassification.ts` | **Tests** (new) | Rule 15a regression tests |
| `tests/runner.ts` | **Tests** | Register the new suite |

**`supabase/functions/sync-gmail/index.ts` — NOT changed.** Phase 0 named it In Scope and it is the file the defect was found in, but under Option 2 no change there is required: the guard downstream makes its firing condition harmless. **Stated explicitly rather than left silent**, because Phase 0's In Scope list implies it will change.

**No mobile files change.** No voice files change. No migrations.

---

## 3. Change Impact Matrix

Every row answered explicitly, per governance.

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **No** | No client file changes. Mobile continues to trigger `sync-gmail` every 60 seconds — wasteful, and tracked as [[B11y]], not fixed here. Global Search's `email_actions` rendering (`app/index.tsx:2381-2389`) is unaffected because sentinel rows cannot match the adapter's filters (§7). |
| **Voice** | **No** | The voice server never calls `sync-gmail` or `extract-email-actions`. *Freshly verified this session — no `fetch` to either exists in `naavi-voice-server/src/index.js`; only descriptive comments at `:693`, `:726`, `:1457`.* Voice's `email_actions` reads at `:1456-1466` sit in `fetchUnreadEmails`, which the comment at `:1466` records as **moved off `email_actions`** on 2026-05-10. |
| **Shared Core** | **YES** | `extract-email-actions` — the only file whose behaviour changes. |
| **Database** | **No schema change.** Row *volume* changes | No migration, no new column, no constraint change. Sentinel rows increase `email_actions` row count roughly 4-5× (the 70-80% pre-filtered share). At the observed ~362 emails per window that is hundreds of rows, not millions. |
| **Cron** | **No** | No cron definition is touched. Both the hourly `sync-gmail` job and the 5-minute `sync-active-email-alerts` job keep their schedules. Explicitly avoided — cadence is a second Protected Core area (Architecture Reference §4, Background scheduling). |
| **API contracts** | **No** | `extract-email-actions`'s request shape is unchanged. Its response gains one new `reason` value (`already_classified`); existing values are unchanged and the only caller that reads the response is the auto-tester. |
| **Tests** | **YES** | New suite plus runner registration, per Rule 15a. |

**Duplication:** the Architecture Reference does not mark this capability Duplicated — `extract-email-actions` is the single classifier. *Freshly verified this session — a repo-wide grep finds exactly two invoking call sites, `sync-gmail:363` and `backfill-email-actions:67`; all other hits are comments, tests, or parity-manifest entries.* Both callers pass through the changed function, so **one implementation changes and there is no second side to leave unaddressed.**

---

## 4. Mandatory Architecture Impact Checklist

| Question | Answer |
|---|---|
| Does this change modify **Shared Core**? | **Yes** — `extract-email-actions`, an Edge Function, owned per Architecture Reference §0a by `munk2207/naavi-app/supabase/functions/*`. |
| Does this change modify an **Entry Point** (mobile/voice translating logic)? | **No.** No client-side or voice-side translation logic is touched. |
| Does this change introduce **new duplication**? | **No.** The guard exists in exactly one place, deliberately chosen as the point every caller passes through. |
| Does this change **eliminate existing duplication**? | **No.** It does not attempt to unify the three Gmail-read paths (ADR 0006, accepted exception) or the five sync triggers ([[B11y]]). |
| Does this change modify **Protected Core**? | **Yes** — "Gmail integration", Architecture Reference §4, review level Full Phase 1-8. Requires technical review **before and after**. |

---

## 5. Regression Impact — the fixed checklist

Every item answered explicitly. Silence is not acceptable.

| Area | Affected? | Reasoning |
|---|---|---|
| **Voice commands** | **No** | Voice never reaches this code. Its `email_actions` read is in a function documented as no longer using `email_actions` for the brief. |
| **Geofencing** | **No** | No shared code path. Location triggers run through `report-location-event` / `evaluate-rules`. |
| **Gmail integration** | **YES — this is the change.** | Covered in detail by §6 and §7. |
| **Calendar integration** | **No** | Separate functions (`create-calendar-event`, `delete-calendar-event`), separate tables. |
| **Reminders** | **No** | `check-reminders` and the `reminders` table are untouched. |
| **SMS / call alerts** | **No — verified, not assumed** | `action_rules` supports `trigger_type='email'`, and the 5-minute `sync-active-email-alerts` cron exists to serve exactly those users, so this was the most plausible place for a hidden coupling. There is none: **`evaluate-rules` never reads `email_actions`** — *freshly verified this session: `grep -c "email_actions" supabase/functions/evaluate-rules/index.ts` returns **0**; it reads `gmail_messages` directly at `:271` (email trigger) and `:616` (contact-silence trigger).* Sentinel rows live in a table the alert engine does not consult. **Phase 3 should still re-run this one check independently** — it is the only area on this list where being wrong means a real message to a real person is sent or silently not sent. |
| **Onboarding** | **No** | No auth, permission, or first-run path touched. |
| **Staging build** | **No** | Edge Function deploy only. No APK, no AAB, no `app.json` version bump. |

---

## 6. Regression Matrix — every consumer, found by searching

Produced by `grep -rn "email_actions"` across the repo, excluding `node_modules`, `docs/`, `dist/`, and stale worktrees. **Not recalled from memory.**

### Consumers whose behaviour could change

| Consumer | `file:line` | Reads | Impact of sentinel rows |
|---|---|---|---|
| `global-search` email_actions adapter | `adapters/email_actions.ts:72-79` | `.eq('user_id')`, `.eq('dismissed', false)`, `.or(<ILIKE on title/vendor/summary/reference>)` | **None.** All four matched columns are `NULL` on a sentinel row, and `ILIKE` against `NULL` yields `NULL`, never true. Sentinel rows are unreachable by this query. |
| `harvest-attachment` | `:225-234` | `.maybeSingle()` for `id, document_type` | **None.** Already handles a null `document_type` by falling back to filename detection (`:234` comment). A sentinel row returns `document_type: null` — indistinguishable from today's no-row case. |
| `naavi-spend-summary` | `:183-269` | Joins `documents` via `email_action_id`, aggregates `extracted_amount_cents` | **None.** Sentinel rows have no linked `documents` row and no amount. |
| `extract-email-actions` itself | `:312` | The upsert being modified | This is the change. |
| `backfill-email-actions` | `:46-67` | Calls the classifier directly | **⭐ Behaviour change — intended.** Its re-runs will now be skipped by the new guard, which defeats a utility whose purpose is re-running. **See §8, open decision 1.** |

### Consumers confirmed unaffected

| Consumer | `file:line` | Why |
|---|---|---|
| `assistant-fulfillment` | `:70`, `:187` | Comment at `:70` records the brief moved **off** `email_actions` on 2026-05-10 to an unread count |
| `naavi-voice-server` | `:1456`, `:1466`, `:1668` | Same 2026-05-10 move; comment at `:1466` |
| `app/index.tsx` | `:2381`, `:2389`, `:3709` | Global Search **rendering** — displays whatever the adapter returns, and the adapter returns no sentinels |
| `hooks/useOrchestrator.ts` | `:2265-2267` | Same rendering path |
| `get-naavi-prompt` | `:1319`, `:1376`, `:1428` | Prompt **text** naming `email_actions` as a label Naavi must never speak aloud — not a query |
| `seed-test-user`, `scripts/diag-*` | various | Test fixtures and diagnostics, not production paths |

**The one query shape that WOULD break, checked explicitly:** a `count(*)` over `email_actions` would be inflated ~4-5× by sentinel rows, since counting does not care that the content columns are `NULL`. *Freshly verified this session — a repo-wide search for a count or `head: true` query against `email_actions` across `supabase/functions/`, `app/`, `hooks/`, `lib/` and `naavi-voice-server/src/` returns **nothing**.*

**Phase 3 should still re-derive this list independently rather than accept it** — it was produced by one grep by one reader, and the failure mode of an incomplete consumer trace is silent.

---

## 7. Behaviour changes a reviewer should push back on

Stated plainly rather than buried, because each is a real cost of this plan.

1. **⭐ Expanding `ACTIONABLE_KEYWORDS` stops working retroactively.** Today a keyword-list change re-evaluates every email in the window on the next tick, because everything is re-evaluated. After this change, emails already marked with a sentinel are never reconsidered. **Anyone who widens that list in future must also clear the sentinels for the affected window, or the change silently applies only to new mail.** This deserves a comment at the keyword list itself, not only in this document.

2. **A permanently-failing email retries forever.** The error path still writes nothing, so a message that always errors is retried on every tick indefinitely — 168+ times. That is exactly today's behaviour, so it is not a regression, and bounding it needs the attempt counter Option 3 would have provided. **Recorded as accepted, not solved.**

3. **`email_actions` stops meaning "emails with actions".** It becomes "emails Naavi has looked at", with a `NULL` `action_type` distinguishing them. Every future reader must know that. The table name will be mildly misleading; renaming it is not worth the churn.

---

## 8. Open decisions Phase 2 cannot make alone

1. **`backfill-email-actions` — exclude it from the guard, or let it be blocked?** Its purpose is re-running classification after a schema upgrade (`:45`). The new guard defeats that. **Recommend: give it a `force: true` parameter that bypasses the guard**, keeping the utility useful while default behaviour stays safe. That is a small addition to a second file and needs Wael's word.

2. **Should the sentinel row record *why* it was skipped?** A `summary` of `'pre_filter_no_keywords'` would make the table self-explanatory and cost nothing. Against: it puts a system string in a user-content column that Naavi is instructed never to read aloud (`get-naavi-prompt:1319`). **Recommend: leave all content fields NULL**, and rely on `action_type IS NULL` as the marker.

---

## 9. What this document does and does not authorize

**Authorizes, on Wael's approval:** the Phase 2 → Phase 3 transition (Technical Review before coding).

**Does not authorize:** writing any code, deploying anything, or modifying any file. Per governance §3, each transition needs Wael's own separate word.
