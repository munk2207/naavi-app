# B11x — Phase 6: Technical Review (After Coding)

**Work item:** [[B11x]] — redundant email classification
**Date:** 2026-08-24
**Implementation:** commit `3ef7e6a`
**Evidence Package:** `docs/B11X_PHASE5_EVIDENCE_PACKAGE_2026-08-24.md` (accepted by Wael)
**Architecture Reference:** **2026.07.18.11** — revision 11, `f06cf1c`, landed *before* this review (see §1)

**Status:** **AWAITING EXTERNAL REVIEW.** Reviewer: ChatGPT, via Wael.

> **Wael — forward this document.** Self-contained; the reviewer has no repo access. Per §14 Cost Awareness, do not send the governance document or earlier phase documents.

---

## 1. ⭐ A drift blocker was found and cleared before this review was written

Phase 1A found the Architecture Reference described `sync-gmail` as *"cron-driven"* — **false, and false before B11x began.** It classified this as **Architecture Drift Rule Outcome 3** (Reference already stale). That outcome states implementation stops and the Reference is reconciled *before* Phase 6 review, "not something to note and continue past."

**Phase 6 was therefore held, and the Reference corrected first** — revision 11, commit `f06cf1c`: §2's Gmail row rewritten, a new §2d recording the five-trigger inventory, a row added for `extract-email-actions` (which the document had never listed at all), and the version bumped in the same commit.

**The reviewer is asked to confirm this was the right handling** (§6, Q1) rather than take it as settled.

**Why the word mattered:** every attempt to control this pipeline's cost for four months cut the cron cadence — 5 → 15 → 30 → 60 minutes, three migrations — because the cron is what the map showed. None touched the other four triggers, because nothing recorded they existed.

---

## 2. What changed

`3ef7e6a`, four files, matching the authorized boundary exactly:

| File | Lines | Change |
|---|---|---|
| `extract-email-actions/index.ts` | +138 / −4 | Guard, `force`, two sentinel sites, MC2 comment, header |
| `backfill-email-actions/index.ts` | +38 / −18 | `seen` guard removed (MC1), `force` forwarded, header |
| `tests/catalogue/b11x-email-reclassification.ts` | +422 | New — 6 cases |
| `tests/runner.ts` | +2 | Registration |

**Most of the +138 is comment.** The executable change is roughly 25 lines: one guarded SELECT, two identical upserts, one parameter.

### The guard

```ts
if (!force) {
  const { data: priorRow } = await supabase
    .from('email_actions')
    .select('id')
    .eq('user_id', user_id)
    .eq('gmail_message_id', gmail_message_id)
    .maybeSingle();

  if (priorRow) {
    return new Response(JSON.stringify({ action: null, reason: 'already_classified' }), { ... });
  }
}
```

Placed before the Anthropic client is constructed. Keys on `(user_id, gmail_message_id)` only — the same logical key as `email_actions`'s existing `UNIQUE` constraint.

### The sentinel — identical at both sites

```ts
await supabase.from('email_actions').upsert({
  user_id, gmail_message_id,
  action_type: null,
  extracted_at: new Date().toISOString(),
}, { onConflict: 'user_id,gmail_message_id' });
```

Failure is logged, not thrown: a failed sentinel degrades to today's behaviour (re-classified next sync), never worse.

### The removal

`backfill-email-actions`'s `seen` set and its filter are gone; `todo` is every fetched id and `force` is forwarded per message.

---

## 3. ⭐ Invalidated Planning Assumption — declared, per the rule

Governance requires Phase 6 to record these **distinctly** from an omitted feature or a deliberate scope cut. This is one.

| | |
|---|---|
| **Phase 2 assumed** | Three terminal outcomes: action found / pre-filter rejected / call errored |
| **Phase 4 discovered** | A fourth at `extract-email-actions:387` — `if (!parsed?.is_actionable)`, where Claude runs to completion, judges the email non-actionable, and returns **writing nothing** |
| **Why the assumption didn't hold** | Phase 2 reasoned from where *Claude calls are avoided*. This branch is where a Claude call has already been **paid for** and produces no row — invisible from that framing, and never surfaced by the regression trace because it is a control-flow path, not a consumer |

**Consequence had it shipped as planned:** that email class would be re-sent to Claude every tick forever — **and it would have looked fixed.** The pre-filter path is 70-80% of volume, so token counts would have collapsed convincingly while this class kept billing underneath. Structurally the same partial-fix shape as the three cron reductions that preceded this work item.

A sentinel was added there. **Deliberately not applied to the `parse_failed` branch** — a malformed Claude response is transient and must stay retryable, like the error path.

**This is the one item where implementation exceeded the literal Implementation Boundaries**, which authorized *"write a sentinel row on the pre-filter branch."* Wael ruled it implements the approved intent and referred it here. **Q2 asks the reviewer to rule.**

---

## 4. Architecture impact

| Question (per Phase 6's required list) | Answer |
|---|---|
| Increase duplication? | **No.** One guard, in the one function both callers pass through |
| Reduce duplication? | **Yes, incidentally** — `backfill-email-actions` held a second, broken dedup guard over the same fact; now removed (MC1) |
| Bypass Shared Core? | **No.** The change *is* Shared Core |
| Introduce another independent implementation? | **No** |
| Violate entry-point responsibilities? | **No.** No entry point touched; no mobile or voice file changed |
| Change an API contract? | **Yes — additive.** Both functions accept an optional `force`; `extract-email-actions` returns one new `reason` value, `already_classified`. Omitting `force` preserves prior behaviour exactly, so `sync-gmail:363` is unchanged and undeployed since **2026-06-20** |
| Change a capability's ownership? | **No.** `extract-email-actions` remains Shared Core |
| Expand Protected Core? | **No.** Both files were already inside it ("Gmail integration") |

**Semantic change the reviewer should weigh:** `email_actions` now means *"emails Naavi has looked at"*, not *"emails with actions"*, with `action_type IS NULL` marking the empty ones. Recorded in §2d of the Reference.

---

## 5. Regression risk, isolation, test coverage

**Deployed to STAGING only** (`extract-email-actions` v21, `backfill-email-actions` v21, both 2026-08-24 ~6:18 PM EST). Production untouched and still carrying the defect.

**Isolation:** `sync-gmail` v20, last deployed **2026-06-20** — positive evidence the plan's "not changed" held, not an assertion of it.

**Database-level trace (Phase 3 MC3, run before coding):** ten objects. No views, no triggers on the table, no Postgres function referencing it, no scheduled SQL job querying it, no client-side `from('email_actions')`. Two live findings: `email_actions_document_type_check` passes on NULL (a CHECK fails only on FALSE — confirmed against existing behaviour, since today's upsert already writes a nullable `document_type`); and `email_actions_user_due_idx` grows ~4-5× because sentinels default to `dismissed = false`. That index growth is the honest cost.

**Tests:** 6 new cases, all green, plus the full Gate 1 suite.

```
Testing against: STAGING (xugvnfudofuskxoknhve)
✓ 537 passed   ✗ 0 failed   ⨯ 1 errored   ⧗ 0 timed out   ○ 5 skipped
```

**Gate 1 is NOT green** — one error, proven unrelated: `naavi-chat` was deployed 2026-08-13, eleven days before this work, and B11x touched neither it nor `get-naavi-prompt`. Reproduced 3/3 per the Non-Determinism Rule. Opened as **[[B11z]]**; the reason it could not be dated is opened as **[[B12a]]** (test reports never record which environment they targeted).

**Non-Determinism Rule does not bind this change** — no Claude or Haiku prompt was modified. The classifier prompt is byte-identical.

---

## 6. Questions for the reviewer

**Q1 — Was the drift blocker handled correctly?** Phase 6 was held and the Architecture Reference corrected first (§1). Is Outcome 3 the right classification, and is revision 11 sufficient reconciliation — or should the trigger inventory have waited for [[B11y]] to fix the defect it documents?

**Q2 — The fourth sentinel site (§3).** Implementation exceeded the literal boundary. Approve as implementing the approved intent, or require it be re-authorized?

**Q3 — Is `parse_failed` correctly excluded?** It leaves no row, so a message whose Claude response repeatedly fails to parse is retried indefinitely — paying for a Claude call each time. Argued as transient-therefore-retryable. Is that right, or is a repeatedly-unparseable response effectively permanent?

**Q4 — Two writers now exist for `email_actions` rows** — the real classification upsert and the sentinel upsert, in the same function. Both key on the same constraint. Is that acceptable, or should they be one code path?

**Q5 — Is shipping with Gate 1 red acceptable for this item?** B11x ships no client, and Rule 15 gates production AABs. Wael accepted Phase 5 on that basis and opened [[B11z]]. Confirm or object.

---

## 7. Required output

Four independent verdicts — no numeric scores:

- **Technical Review:** PASS / FAIL
- **Architecture Completeness:** PASS / FAIL — naming explicitly any of: increased duplication, reduced duplication, bypassed Shared Core, another independent implementation, entry-point violation, API contract change, ownership change, Protected Core expansion
- **Governance Compliance:** PASS / FAIL
- **Overall Recommendation:** Approved / Approved with Mandatory Changes / Rejected

Plus an **Architecture Drift Rule** verdict: does the implementation now match Architecture Reference 2026.07.18.11 — Matches / Diverges-approved / Diverges-other?

---

## 8. Verdict

**To be completed when the review returns.**
