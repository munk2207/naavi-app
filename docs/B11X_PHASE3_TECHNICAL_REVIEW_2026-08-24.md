# B11x — Phase 3: Technical Review (Before Coding)

**Work item:** [[B11x]] — redundant email classification
**Date:** 2026-08-24
**Risk:** MEDIUM → Phase 3 review is **mandatory**
**Plan under review:** `docs/B11X_PHASE2_CHANGE_PLAN_2026-08-24.md` revision 2 (commit `41ebb09`)

**Status:** ✅ **APPROVED WITH MANDATORY CHANGES — ChatGPT, 2026-08-24.** All three mandatory changes discharged (§9). **No code written. Phase 4 requires Wael's separate authorization.**

> Sections 1-8 below are the package as it was sent for review, preserved unchanged. **The verdict and the discharge of all three mandatory changes are in §9.**

---

## ⭐ Correction to the plan, found while preparing this package

**`backfill-email-actions` already has a `force` parameter.** Phase 2 revision 2 describes adding one. It exists today at `:25`:

```ts
const { user_id, max = 100, force = false } = await req.json();
```

Two consequences the reviewer should have in front of them:

**1. The change is smaller than the plan says.** It is not "add `force`" — it is "pass the existing `force` down to `extract-email-actions`."

**2. ⭐ `backfill-email-actions` already implements the exact guard Phase 2 rejected as broken.** At `:48-55`:

```ts
const existing = await supabase
  .from('email_actions')
  .select('gmail_message_id')
  .eq('user_id', user_id);
const seen = new Set((existing.data ?? []).map(r => r.gmail_message_id));

const todo = (msgs ?? [])
  .map(r => r.gmail_message_id)
  .filter(id => force ? true : !seen.has(id));
```

This is "skip if an `email_actions` row exists" — the trap named in Phase 0 and Phase 2. It is **live in production today**, and it means the backfill utility currently re-sends every pre-filtered email to `extract-email-actions` on every run, while skipping the ones that produced actions. Exactly backwards.

Once the sentinel guard lands downstream, this `seen` set becomes redundant **and wrong**. The reviewer is asked to rule on whether retiring it is in scope (§5, Q4).

**3. Minor:** the function's own header at `:8` documents the input body as `{ user_id: string, max?: number }` — omitting `force` entirely.

---

## 1. The defect, in brief

`sync-gmail:362` fires classification on `if (!error && !isMarketing)`. `!error` is true for an UPDATE exactly as for an INSERT, and the upsert at `:336-354` (`onConflict: 'user_id,gmail_message_id'` at `:354`) cannot fail on a message already present. Every email in the rolling 7-day window is re-sent to Claude on every sync.

`extract-email-actions` does not compensate — its path is fetch row (`:66`) → date (`:82`) → keyword pre-filter (`:146`) → Claude (`:232`), with no check for prior classification anywhere.

**Measured:** Anthropic Console, Haiku 4.5, edge-functions key, 2026-08-24 by hour — 22,916,042 input tokens over ~19 hours, **flat at ~1.21M/hour including overnight**. Naavi has two users; two people do not produce a level line at 3 AM. ~$930/month projected.

**Five callers trigger `sync-gmail`, not one** (found in Phase 1A). Two pass a parameter it does not read and silently sync *every* user — the mobile app on a 60-second interval, and the email-search intent. **Those two are a separate item, [[B11y]], and are NOT in scope here.**

---

## 2. The constraint that shapes the fix

The fact "this message was classified" **does not exist** for most emails. `extract-email-actions:148-153`:

```ts
if (!matchesActionable) {
  console.log(`[extract-email-actions] Pre-filter: no actionable keywords ...`);
  fireHarvest();
  return new Response(JSON.stringify({ action: null, reason: 'pre_filter_no_keywords' }), { ... });
}
```

**No row is written.** The comment at `:107` estimates this path takes **70-80%** of emails. A failed Claude call also writes nothing.

`gmail_messages` cannot answer it either: it has **no `created_at`** and no classification-state column, and `updated_at` is stamped `now()` on every upsert (`sync-gmail:353`). The row cannot tell you whether it is new.

---

## 3. The proposed change

**Guard the classifier, not the caller.** `extract-email-actions` records every terminal outcome, then skips messages it has already seen.

| Outcome | Today | Proposed |
|---|---|---|
| Claude ran, found an action | writes a full row | unchanged |
| Pre-filter rejected it | **writes nothing** | writes a **sentinel row** — `action_type: null`, all content fields `NULL` |
| Claude call errored | writes nothing | **still writes nothing** — retries next tick, preserving today's accidental retry deliberately |

**Guard key:** `(user_id, gmail_message_id)` and nothing else — the same logical key as `email_actions`'s existing `UNIQUE (user_id, gmail_message_id)`.

**`force: true`** bypasses that guard **and only** that guard. Pre-filter still runs; sentinels still written; error path unchanged. No cron and no `sync-gmail`-reachable path may set it — if it were reachable from the hourly or 5-minute cron it would reinstate the defect exactly.

**Files:** `extract-email-actions/index.ts`, `backfill-email-actions/index.ts`, one new test suite, `tests/runner.ts`. **`sync-gmail` is not changed.** No migration. No mobile or voice code.

**Why fire-on-insert in `sync-gmail` was rejected** (Phase 0 originally leaned that way): it misses `backfill-email-actions`, which reaches the classifier without passing through `sync-gmail`; and it breaks Success Criterion 3, because today a failed classification *is* retried — accidentally, since everything is retried — and insert-detection removes that accident with nothing in its place.

---

## 4. Regression trace (produced by grep, not memory)

Sentinel rows have `action_type`, `title`, `vendor`, `summary`, `reference` all `NULL`.

| Consumer | Query shape | Impact |
|---|---|---|
| `global-search` email_actions adapter | `.eq(user_id)`, `.eq(dismissed,false)`, `.or(<ILIKE on title/vendor/summary/reference>)` | **None** — `ILIKE` against `NULL` is never true, so sentinels are unreachable |
| `harvest-attachment:225-234` | `.maybeSingle()` for `id, document_type` | **None** — already falls back to filename detection on a null `document_type` |
| `naavi-spend-summary` | joins `documents` via `email_action_id`, sums amounts | **None** — sentinels have no linked document, no amount |
| `evaluate-rules` (email alerts) | — | **None** — `grep -c "email_actions"` returns **0**; it reads `gmail_messages` at `:271` and `:616` |
| `assistant-fulfillment`, voice server | — | **None** — both moved off `email_actions` for the brief on 2026-05-10 |
| `count(*)` over `email_actions` | the one shape sentinels *would* distort | **No such query exists anywhere in the repo** |

---

## 5. Questions for the reviewer

Answer these specifically; general approval is less useful than a ruling on each.

**Q1 — Is the error-path asymmetry correct?** Pre-filter rejections are recorded (deterministic — same keyword list, same answer forever). Errors are not recorded (transient — next attempt may succeed). This is what makes Success Criterion 3 hold with no new state. **Is there a failure mode where an error is actually permanent, making "retry forever" the wrong default?** A permanently-failing email retries indefinitely — that is today's behaviour, so not a regression, but the plan accepts rather than solves it.

**Q2 — Is the sentinel row the right carrier, or is it overloading a table?** `email_actions` stops meaning "emails with actions" and starts meaning "emails Naavi has looked at". The alternative was a new column on `gmail_messages`, rejected as a schema change Phase 0 does not authorize and that an existing table can already express. **Is that the right trade?**

**Q3 — Retroactive keyword changes.** After this lands, widening `ACTIONABLE_KEYWORDS` no longer re-evaluates already-marked emails; it applies only to new mail. Today it re-evaluates the whole window. **Is that acceptable, or does the plan need a documented sentinel-clearing procedure before it ships?**

**Q4 — Should `backfill-email-actions`'s own `seen` guard be retired?** See the correction at the top. It is the broken row-existence guard, live today. Retiring it is arguably in scope (the file is already being changed) or arguably scope creep. **Rule on it.**

**Q5 — Hidden coupling.** The regression trace was produced by one grep by one reader. **Is there a consumer class it would structurally miss** — a database view, an RLS policy, a trigger, a scheduled job defined in SQL rather than TypeScript?

---

## 6. Gates (§13) — evaluate in order

| Gate | Question |
|---|---|
| 1 — Scope Compliance | Inside Phase 0's approved scope? Phase 0 named `sync-gmail` and `extract-email-actions`; the plan does **not** change `sync-gmail` and **adds** `backfill-email-actions`. Is that within scope or does it need Wael's amendment? |
| 2 — Governance Compliance | Complies with the governance document? |
| 3 — Architecture Compliance | Preserves architecture integrity? Protected Core: "Gmail integration", Full Phase 1-8. |
| 4 — Technical Correctness | Assumptions, architecture, isolation, hidden coupling, implementation strategy. |
| 5 — Evidence Sufficiency | Not applicable at Phase 3 — no code exists yet. Applies at Phase 6. |

---

## 7. Non-Determinism Rule — does not apply

**No Claude or Haiku prompt is modified by this change.** The guard is control flow; the sentinel is a database write. The 3-independent-trials requirement therefore does not bind here.

Stated explicitly because two prompt-level findings *were* made during this investigation and are deliberately **not** part of B11x: the banned word "senior" in three production prompts, and `${todayISO}` interpolated inside a cached block at two sites. Both are recorded in the Phase 0 document's "Related findings" and would each carry the 3-trials rule if opened.

---

## 8. Requested output — §14 Claude Implementation Handoff

Please conclude with this compact format, not extended prose:

- **Decision** — Approved / Approved with Mandatory Changes / Rejected
- **Mandatory Changes** — the specific listed changes, if any. Nothing beyond this list may be performed.
- **Architecture Requirements** — what §4 compliance requires for this change specifically
- **Regression Requirements** — what must be traced
- **Scope Restrictions** — the Phase 0 boundary this must stay inside
- **Verification Checklist** — what evidence Phase 5 must produce

Plus, per Phase 3's own requirements:

- **Implementation Boundaries Confirmed** — which files are authorized and the specific change in each; that no additional files are approved; that no opportunistic refactoring is approved; that no architectural changes beyond the plan are approved; and what is explicitly excluded.
- **Deferred Architectural Decisions** — any idea raised but not approved, with the condition that would make it worth reconsidering.

---

## 9. Verdict — APPROVED WITH MANDATORY CHANGES (ChatGPT, 2026-08-24)

**Q1** error-path asymmetry correct · **Q2** sentinel acceptable · **Q3** acceptable with a documented forced-reprocessing procedure · **Q4** retire the old guard · **Q5** expand the trace to database-level consumers before implementation.

**Coding may proceed only when separately authorized.** Phase 3 approval is not Phase 4 authorization.

### Mandatory Change 1 — retire `backfill-email-actions`'s `seen` guard ✅ folded into the plan

Its `:48-55` row-existence guard duplicates the broken semantics B11x exists to fix. It is removed; the existing `force` value passes downstream instead, and `force: true` bypasses only the new classifier guard.

### Mandatory Change 2 — document keyword-change handling ✅ recorded below and in §7 of the Phase 2 plan

**If `ACTIONABLE_KEYWORDS` is widened, previously created sentinels must be deliberately reprocessed via the forced backfill path:**

```
POST /functions/v1/backfill-email-actions
{ "user_id": "<uuid>", "force": true, "max": <n> }
```

**No automatic sentinel-clearing mechanism is required or approved.** This procedure belongs as a comment at the `ACTIONABLE_KEYWORDS` declaration itself (`extract-email-actions:110`), not only in this document — the person widening that list is reading the list, not the governance record.

### Mandatory Change 3 — SQL-level hidden-coupling search ✅ **COMPLETE, run before coding**

Q5 could not be closed by TypeScript grep alone. Full search of `*.sql` for `email_actions`, plus a search for every `CREATE VIEW` / `CREATE TRIGGER` / `CREATE FUNCTION` and every `cron.schedule` in `supabase/migrations/`.

| Database object | Sentinel-row impact | Verdict |
|---|---|---|
| `email_actions_user_due_idx` — `(user_id, due_date) WHERE dismissed = false` | Sentinels have `dismissed = false` by default, so they **do** enter this index; `due_date` is `NULL` | ⚠️ **Index grows ~4-5×.** No correctness impact. **The only real cost sentinel rows carry.** |
| `email_actions_expiry_idx` — `(user_id, expiry_date) WHERE expiry_date IS NOT NULL AND dismissed = false` | Sentinels have `expiry_date NULL` → **excluded by the predicate** | ✅ No impact |
| `email_actions_document_type_check` — `CHECK (document_type = ANY (ARRAY[...]))` | `NULL = ANY(...)` evaluates to `NULL`, and a CHECK passes on `NULL` (fails only on `FALSE`). **Confirmed by existing behaviour**: today's upsert at `:306` already writes `document_type: documentType`, which can be null | ✅ No impact — **this was the one object that could have blocked the implementation** |
| RLS: `for select using (auth.uid() = user_id)` | Sentinels are selectable by the owning user | ✅ No impact — *verified: no client-side `from('email_actions')` query exists in `app/`, `hooks/` or `lib/`; the SELECT policy is unexercised by app code* |
| RLS: `for all using (auth.jwt() ->> 'role' = 'service_role')` | The write path | ✅ Unchanged |
| FK `documents.email_action_id → email_actions(id) ON DELETE SET NULL` | Sentinels are valid targets but nothing links to them | ✅ No impact |
| **Views** | — | ✅ **None exist.** No `CREATE VIEW` anywhere in migrations |
| **Triggers** | — | ✅ **None on this table.** The only triggers are `trg_user_settings_phone_numbers_unique` and `tickets_updated_at_trigger` |
| **Postgres functions** | — | ✅ **None reference it.** The seven that exist cover user_settings, geofence, tickets, knowledge search, and the voice PIN counter |
| **Scheduled SQL jobs** | — | ✅ **None query it.** Every `cron.schedule` migration was searched for `email_actions`; no match |

**Conclusion: no database-level consumer blocks this change.** One consequence recorded rather than dismissed — `email_actions_user_due_idx` will grow with sentinel rows. At the observed ~362 emails per window that is hundreds of index entries, not millions, and it is the honest cost of Q2's accepted trade.

**Limitation, stated:** this search covers version-controlled migrations. An object created directly against the live database and never captured in a migration would not appear. Given T4's schema-parity work and the pre-push drift check, that risk is low — but it is not zero, and it is the residual Q5 cannot fully close from the repository alone.

### Implementation Boundaries Confirmed

**Authorized files, and only these four:**

| File | Authorized change |
|---|---|
| `supabase/functions/extract-email-actions/index.ts` | Existence guard on `(user_id, gmail_message_id)`; accept `force` to bypass only that guard; write a sentinel row on the pre-filter branch with all content fields `NULL`; error path continues to write nothing; MC2 procedure comment at `ACTIONABLE_KEYWORDS` |
| `supabase/functions/backfill-email-actions/index.ts` | Remove the `seen` guard (`:48-55`); pass existing `force` downstream; fix the `:8` header, which omits `force` |
| `tests/catalogue/b11x-email-reclassification.ts` | New regression suite, §9a of the Phase 2 plan |
| `tests/runner.ts` | Register the suite |

**No additional files are approved. No opportunistic refactoring is approved. No schema changes are approved. No architectural changes beyond the plan are approved.**

**Explicitly excluded:** all [[B11y]] work; any cron or cadence change; any change to `sync-gmail`; any mobile or voice change; the "senior" banned-word and `${todayISO}` prompt findings.

### Deferred Architectural Decisions

1. **Bounded retry state / a classification-state schema.** Not approved. A permanently-failing email retries indefinitely — today's behaviour, so not a regression. **Reconsider only if permanent failures create material repeated cost.**
2. **A dedicated table or column for classification state.** Not approved. Sentinel-table semantics are accepted; no new table or column is justified now.
