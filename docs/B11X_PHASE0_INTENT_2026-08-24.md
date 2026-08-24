# B11x — Phase 0: Intent Approval

**Work item:** [[B11x]] — `sync-gmail` re-sends every email in its 7-day window to Claude on every run; nothing anywhere records that a message was already classified
**Date:** 2026-08-24
**Scope:** **BACKEND ONLY** — Shared Core Edge Functions (`sync-gmail`, `extract-email-actions`). No mobile, no voice, no schema change proposed.
**Governance:** Full Phase 1–8
**Risk:** MEDIUM — the defect is cost, not correctness, but the fix changes *when* classification fires, and a careless version silently stops classifying emails that should be classified.
**Status:** **DRAFT — awaiting Wael's Phase 0 approval.** No mechanism approved. No code written.

---

## Why this Phase 0 exists

**Every email in the rolling 7-day window is sent to Claude again on every cron tick, for as long as it stays in the window.**

Verified directly by reading the source, 2026-08-24, on `main`:

`supabase/functions/sync-gmail/index.ts:354` upserts the message —

```
}, { onConflict: 'user_id,gmail_message_id' });

if (!error) count++;
```

— and then, twelve lines later at `:362`, fires classification on the result of that upsert:

```
if (!error && !isMarketing) {
  fetch(`${...}/functions/v1/extract-email-actions`, { ... })
}
```

`!error` is true for an **UPDATE** exactly as it is for an **INSERT**. The upsert cannot fail on a message already present, so the condition is satisfied on every run for every message in the window.

`supabase/functions/extract-email-actions/index.ts` does not compensate. The complete path from entry to the Claude call is: fetch the email row (`:66`), compute today's date (`:82`), run a keyword pre-filter (`:146`), call Claude (`:232`). **There is no check, at any point, for whether this message has already been classified.** The keyword pre-filter at `:110-146` is a fixed list matched against email content — deterministic, so a message that passes it passes it on every run.

**Cron cadence is hourly** — `supabase/migrations/20260430000001_gmail_sync_cron_60min.sql:24`, `'0 * * * *'`.
**Window is 7 days, up to 100 messages** (`sync-gmail`, per the documented tier-1 sync behaviour in CLAUDE.md).

**Therefore each qualifying email is sent to Claude up to 168 times** (24 ticks/day × 7 days) before it ages out of the window. The intended number is 1.

### This has been fought three times at the wrong end

| Migration | Change | Stated reason |
|---|---|---|
| `20260422_gmail_sync_cron_reduce_frequency.sql` | 5 min → 15 min | *"the email pipeline fires 3x more often than needed"* |
| `20260424_gmail_sync_cron_30min.sql` | 15 min → 30 min | *"Halving the cron frequency halves the per-user email-processing cost"* |
| `20260430000001_gmail_sync_cron_60min.sql` | 30 min → 60 min | *"$581 month-to-date across 2 users; mostly from this pipeline"* |

Each reduced the multiplier. None removed it. The multiplier is the defect; the cadence is not.

### Provenance of this finding

It came out of reviewing an external cache-cost diagnosis (artifact "MyNaavi Cache Remediation", 24 Aug 2026), whose conclusion was that Naavi's Haiku requests never attempt prompt caching. **That conclusion is incorrect** — `cache_control` is set at all six Claude call sites. The redundant-classification defect was found while checking why the volume was as high as the Console reported.

**Not verified:** the actual call count in the Anthropic account. Every claim above is read from source and migration files; the size of the dollar effect is arithmetic from those, not a measured figure. Confirming it in Console → Usage is proposed as the first step of Phase 1, and is the number that would size this work item honestly.

---

## User Intent

Stop paying to classify the same email over and over. An email should be sent to Claude once, when it first arrives — not on every hourly sync for the week it remains in the window.

## Success Criteria

1. A newly arrived email is classified exactly once.
2. An email already present in `gmail_messages` is **not** re-sent to Claude on subsequent sync runs.
3. No email that would have been classified before this change goes unclassified after it — including emails whose first classification attempt failed.
4. Nothing user-visible changes: the morning brief, Global Search, and `email_actions` contents are the same as before, minus the redundant work.

## In Scope

- `supabase/functions/sync-gmail/index.ts` — the firing condition at `:362`.
- `supabase/functions/extract-email-actions/index.ts` — only if Phase 2 finds a guard is also needed there.
- Whatever record of "already classified" the fix requires, if the existing tables cannot answer the question. **A new column or table is a schema change and would need its own explicit approval** — it is not authorized by this Phase 0.
- An auto-tester regression test per Rule 15a, locking in "second sync run does not re-call Claude."

## Out of Scope

- **Prompt caching.** Real but separate, and roughly two orders of magnitude smaller — caching would halve the cost of redundant calls that should not be made at all. Recommend a separate item; see "Related findings" below.
- **Changing the cron cadence.** The three migrations above already show cadence is the wrong lever. If this fix works, cadence could arguably be *raised* back toward responsiveness — that is a later, separate decision.
- **The `harvest-attachment` and `extract-document-text` guards.** CLAUDE.md documents an idempotency guard on `harvest-attachment` at `(user_id, gmail_message_id, file_name)`; not re-verified this session. Their firing volume drops as a consequence of this fix, but their own logic is not touched.
- Mobile and voice. Neither calls this path.
- Production deployment. Staging first, per STAGING-FIRST.

## Constraints

- Staging only (`xugvnfudofuskxoknhve`) until Wael explicitly says otherwise.
- No schema change without separate approval.
- No cadence change.
- Rule 15a applies: the regression test exists and passes before this item is considered done.

## Completion Criteria

1. On staging, two consecutive `sync-gmail` runs over an unchanged inbox produce Claude calls on the first and **zero** on the second — evidenced from function logs, not inferred.
2. A newly arrived email during that window is still classified, and its `email_actions` row appears.
3. A regression test in `tests/catalogue/` covers the "second run makes no call" behaviour and is registered in `tests/runner.ts`.
4. `npm run test:auto` green against **staging** — env banner read and recorded, per the Cross-Cutting Change Parity Check.

---

## One trap Phase 2 must not fall into

The obvious guard — *"skip if an `email_actions` row already exists"* — **is wrong, and would silently break Success Criterion 3.**

`extract-email-actions:148-153` returns early with `reason: 'pre_filter_no_keywords'` and **writes no `email_actions` row at all.** The majority of emails take that path (the comment at `:107` estimates 70-80%). For those, "no row exists" is indistinguishable from "never processed" — so a row-existence guard would either re-process them forever, or, if inverted, mark them permanently done for the wrong reason.

The same applies to a failed Claude call: no row, and nothing recording that the attempt happened.

This is why firing on **insert vs. update** in `sync-gmail` is the shape chosen here — the message row's existence is the fact that is actually reliable. Phase 2 still owes an answer for the failed-attempt case, which insert-detection alone does not solve: an email whose classification errors out on the tick it arrives would never be retried.

---

## Related findings, not part of this item

Both were found during the same investigation. Recommend opening as separate holding-list items; neither is authorized by this Phase 0.

1. **Prompt caching is a no-op on three of the four Haiku call sites.** Haiku 4.5's minimum cacheable prefix is **4,096 tokens** (verified against Anthropic SDK documentation, not the external artifact, which flagged its own figure as unverified). The cached system blocks in `extract-email-actions` (~1.2k tokens, per its own comment at `:158`), `extract-document-text` and `ingest-note` are all below it, so `cache_control` there writes nothing and reports nothing — silent by design. Only `naavi-chat:3579` clears the bar. This is consistent with the Console showing 2% cache writes.

2. **A banned word is live in a production prompt.** `extract-email-actions:161` opens: *"You are helping a senior user triage email."* CLAUDE.md bans "senior" in any prompt, and directs that the rule be applied retroactively when editing existing prompts. One-line fix, but it is a prompt change and therefore carries the Phase 3 non-determinism rule (3 independent trials).

---

## What this Phase 0 does and does not authorize

**Authorizes, on Wael's approval:** the Phase 0→1 transition, and Phase 1's investigation — including measuring the real call count in Console → Usage.

**Does not authorize:** any code change, any mechanism, any schema change, any deploy, or drafting the Phase 2 document. Per governance §3, each transition needs Wael's own separate word.
