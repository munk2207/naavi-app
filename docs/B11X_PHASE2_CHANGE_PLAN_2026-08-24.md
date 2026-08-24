# B11x — Phase 2: Change Plan

**Work item:** [[B11x]] — redundant email classification
**Date:** 2026-08-24
**Phase 1:** `docs/B11X_PHASE1_PROBLEM_DEFINITION_2026-08-24.md` (revision 2, approved 2026-08-24)
**Phase 1A:** `docs/B11X_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-08-24.md` — DOES NOT PASS, resolved by Phase 1 revision 2
**Architecture Reference:** 2026.07.18.10

**Status:** **CHANGES REQUIRED → APPLIED. Phase 2 → Phase 3 authorized by Wael, 2026-08-24.** No code written.

**Revision 2 (2026-08-24)** — Wael's five required changes, all applied: (1) `force: true` on `backfill-email-actions` approved, §8a; (2) sentinel content fields stay `NULL`, §8; (3) guard key defined as `(user_id, gmail_message_id)`, §8a; (4) `force` bypasses that guard only, §8a; (5) `backfill-email-actions/index.ts` added to §2 and forced-reclassification tests to §9a. **One knock-on correction not in his list:** the Change Impact Matrix's API-contracts row said "No"; adding an optional `force` parameter to two functions makes that false, so it is now "YES — additive only".

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
| `supabase/functions/extract-email-actions/index.ts` | **Backend** (Protected Core) | Add existence guard on `(user_id, gmail_message_id)` before the Claude path; accept `force: true` to bypass **only** that guard; write a sentinel row on the pre-filter branch with all content fields `NULL`; leave the error path writing nothing |
| `supabase/functions/backfill-email-actions/index.ts` | **Backend** | Accept `force` on its own request body and pass `force: true` per message to `extract-email-actions`, so the utility still re-runs classification after a schema upgrade. Added at Wael's direction — see §8a |
| `tests/catalogue/b11x-email-reclassification.ts` | **Tests** (new) | Rule 15a regression tests — including **forced-reclassification coverage** (§9a) |
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
| **API contracts** | **YES — additive only** (revised at Wael's direction) | Both functions gain an **optional** `force` boolean on their request body. Omitting it preserves today's behaviour exactly, so no existing caller breaks — `sync-gmail:363-370` sends no `force` and is unchanged. `extract-email-actions`'s response gains one new `reason` value (`already_classified`); existing values are unchanged, and the only caller reading the response is the auto-tester. **Revision 1 said "No" on the strength of the guard being internal; adding `force` makes that false, and an additive change is still a contract change.** |
| **Tests** | **YES** | New suite plus runner registration, per Rule 15a. Coverage list at §9a. |

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
| `backfill-email-actions` | `:46-67` | Calls the classifier directly | **⭐ Changes — and is now in the change list.** Without a bypass the new guard would skip every re-run and defeat a utility whose entire purpose is re-running. Wael approved `force: true` (§8a); this file passes it per message, so its behaviour is preserved. |

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

## 8. Decisions — RESOLVED by Wael, 2026-08-24

Both open decisions were settled in the Phase 2 review. Neither is open.

1. **`backfill-email-actions` gets `force: true` — APPROVED.** The parameter bypasses the existing-classification guard so the utility keeps working after a schema upgrade, while default behaviour stays safe. Scope is defined in §8a.

2. **Sentinel content fields stay `NULL` — APPROVED.** No `'pre_filter_no_keywords'` string in `summary` or any other user-content column. `action_type IS NULL` is the sole marker. This keeps a system string out of a column `get-naavi-prompt:1319` instructs Naavi never to read aloud.

---

## 8a. ⭐ Guard key and `force` scope — normative

Added at Wael's direction, 2026-08-24. These two definitions are binding on Phase 4 implementation.

### The guard key

**The existing-classification guard keys on `(user_id, gmail_message_id)` — nothing else.**

This is the same logical key as `email_actions`'s own `UNIQUE (user_id, gmail_message_id)` constraint (`20260419000001_email_actions.sql`), so the guard's lookup and the table's uniqueness cannot disagree. The guard must not additionally consider `action_type`, `dismissed`, `extracted_at`, recency, or any content field: a row's **existence** under that key is the whole signal, which is precisely what makes a sentinel row work as a record of "already looked at, found nothing".

Per CLAUDE.md's data-integrity checklist — *"What's the logical key? Is there a UNIQUE constraint on it?"* — the answer is yes, and it already exists. No new constraint is required.

### What `force: true` does, and only that

**`force: true` bypasses the existing-classification guard, and nothing else.**

Every other behaviour is unchanged when it is set:

| Behaviour | Under `force: true` |
|---|---|
| Existing-classification guard | **bypassed** — the only effect |
| Keyword pre-filter (`:110-146`) | still runs, unchanged |
| Sentinel row written on pre-filter rejection | still written |
| Error path writes nothing | unchanged |
| Marketing exclusion in `sync-gmail` | unchanged — `force` is not plumbed through `sync-gmail` |
| `onConflict` upsert semantics | unchanged — a forced re-run overwrites the existing row for the same key |

**`force` is not a general "reprocess everything" switch and must not grow into one.** It is accepted only on `backfill-email-actions`'s own request body and passed to `extract-email-actions` per message. **No cron, and no path reachable from `sync-gmail`, may set it** — if it were reachable from the hourly or 5-minute cron, it would reinstate B11x exactly.

---

## 9a. Test coverage — Rule 15a

New suite `tests/catalogue/b11x-email-reclassification.ts`, registered in `tests/runner.ts`. **Must be green against staging before this item closes.**

| # | Test | Control |
|---|---|---|
| 1 | Second call for the same `(user_id, gmail_message_id)` returns `reason: 'already_classified'` and makes **no** Claude call | Negative — guards the defect |
| 2 | Pre-filtered email writes a sentinel row: `action_type IS NULL`, and `title`/`vendor`/`summary`/`reference` all `NULL` | Positive — locks Wael's decision 2 |
| 3 | Second call on a pre-filtered email is skipped by the sentinel | Negative — the 70-80% case, the whole reason Option 1 was rejected |
| 4 | **Forced reclassification:** `force: true` re-runs a message that already has a row, and overwrites it | Positive — locks §8a |
| 5 | **`force` scope:** with `force: true`, the keyword pre-filter still runs and a rejected email still writes its sentinel | Negative — proves `force` bypasses the guard *only* |
| 6 | `backfill-email-actions` end-to-end re-runs an already-classified message | Positive — the utility still works |
| 7 | An errored Claude call writes **no** row, so the next call retries | Positive — Success Criterion 3 |
| 8 | A sentinel row is invisible to `global-search`'s `email_actions` adapter | Negative — guards the §6 regression claim |

**Test 5 is the one that matters most for future safety.** If `force` ever silently widens beyond the guard, that is the test that fails.

---

## 9. What this document does and does not authorize

**Authorizes, on Wael's approval:** the Phase 2 → Phase 3 transition (Technical Review before coding).

**Does not authorize:** writing any code, deploying anything, or modifying any file. Per governance §3, each transition needs Wael's own separate word.
