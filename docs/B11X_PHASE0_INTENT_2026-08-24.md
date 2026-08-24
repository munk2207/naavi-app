# B11x — Phase 0: Intent Approval

**Work item:** [[B11x]] — `sync-gmail` re-sends every email in its 7-day window to Claude on every run; nothing anywhere records that a message was already classified
**Date:** 2026-08-24
**Scope:** **BACKEND ONLY** — Shared Core Edge Functions (`sync-gmail`, `extract-email-actions`). No mobile, no voice, no schema change proposed.
**Governance:** Full Phase 1–8
**Risk:** MEDIUM — the defect is cost, not correctness, but the fix changes *when* classification fires, and a careless version silently stops classifying emails that should be classified.
**Status:** **APPROVED WITH COMMENTS by Wael, 2026-08-24** — Phase 0 → Phase 1 authorized. No mechanism approved. No code written.
**Reviewer comment applied:** line 111 originally read *"firing on insert vs. update … is the shape chosen here,"* which selected a mechanism the document elsewhere says is not approved. Reworded to name it as one option for Phase 1/2 to evaluate. No other change requested.

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

It came out of reviewing an external cache-cost diagnosis (artifact "MyNaavi Cache Remediation", 24 Aug 2026).

**Its stated mechanism is wrong, but its conclusion is right — and was later confirmed by measurement.** The artifact said Naavi's Haiku requests "never attempt" caching; in fact `cache_control` is set at every Claude call site. What it got right is the part that matters: the problem is *coverage*, and prompt length is the gate. Five of six cached blocks sit under Haiku 4.5's 4,096-token minimum, so `cache_control` there writes nothing — the same observable outcome the artifact predicted, by a different mechanism. It also correctly predicted a date interpolated into a cached prompt (finding 3 below), having never read the code.

**The lesson for this item is not "the artifact was wrong."** It is that a confident, well-sourced diagnosis can be right about the destination and wrong about the road, and only reading the source separates the two. The redundant-classification defect was found while checking why call volume was as high as the Console reported — a question the caching frame never asks.

---

## ⭐ Measured evidence — the flat hourly line

**Added 2026-08-24 after Phase 0 approval.** The original draft said the dollar effect was arithmetic from source, not a measured figure. It has since been measured, and the measurement is stronger evidence than anything else in this document.

**Source:** Anthropic Console → Usage. Filters: API key `naavi-edge-functions-2026-05` · Model `claude-haiku-4-5` · Workspace All · Account All · **View by Day, 2026-08-24**.

**Observed:**

| Metric | Value |
|---|---|
| Total tokens in | **22,916,042** |
| Total tokens out | 510,679 |
| Hours elapsed at capture | ~19 |
| **Implied rate** | **≈ 1.21M input tokens/hour** |

**The shape is the finding.** Broken into hourly bars, the traffic is *flat* — roughly 1.2M tokens every hour, bar after bar, across the whole day including overnight. A few taller and shorter bars at the right edge ride on top of that floor.

**Naavi has two users.** Two people cannot generate a level 1.2M tokens/hour at 3 AM. Human traffic is spiky and clusters around waking hours. **A flat hourly line is a machine repeating identical work on a schedule — which is precisely what `sync-gmail`'s `'0 * * * *'` cron does.** The variable bars at the edge are the actual human usage; the flat baseline underneath it is the defect.

This upgrades the central claim from arithmetic to observation. Restated in the terms of 5-levers #3: *the flat baseline is an observation; attributing it specifically to `extract-email-actions` rather than another hourly job remains an inference* — the Console bills per API key and every Edge Function shares one, so it cannot split them directly. The cache-split view (uncached vs. cache-read) is the proposed discriminator, since the classifier prompts are all below the cacheable minimum and `naavi-chat`'s is far above it.

**Projected at the observed rate:** ~28.9M tokens/day ≈ $31/day ≈ $930/month. **⚠ CORRECTED 2026-08-24 (Phase 7) — that extrapolation was inflated ~2× and is retained here only so the error is visible.** The 22.9M token measurement is accurate, but the 19-hour window it came from **also contained this session's own testing** — the 543-case Gate 1 suite run twice, plus three trials of a `naavi-chat` test, all billed to the same key. The Console billing page reads **$357.68 spent** in the cycle from 1 August, which over 24 days is **≈ $15/day (~$450/month) all-in**, of which this pipeline is a large but unquantified share. **The flat hourly line, the root cause and the fix are unaffected — only the size of the prize was overstated.**

**Unrelated but urgent, noted at the same capture:** the account credit balance displayed **$9.00**, roughly seven hours of runway at the observed burn. Credit exhaustion fails every Claude call on every surface — mobile, voice, demo line, morning brief. Not part of this work item; raised to Wael separately.

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

- **Prompt caching.** Out of scope, and — corrected 2026-08-24 — **not worth opening as a separate item either.** The original draft called it "real but separate, roughly two orders of magnitude smaller" and recommended a follow-up item. Measurement since showed there is nothing actionable: `cache_control` is already set at every call site, and the five blocks that don't cache are below Haiku's minimum by construction, which no configuration change fixes. Caching would at best have made redundant calls cheaper; B11x stops making them. See "Related findings" #1 for the measured detail, recorded so a future session doesn't re-derive it.
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

This makes **insert-vs-update detection** in `sync-gmail` one mechanism Phase 1/2 should evaluate — the message row's existence is a fact that is actually reliable. **It does not by itself solve the failed-attempt retry case:** an email whose classification errors out on the tick it arrives would never be retried. Phase 2 owes an answer for that case whichever mechanism it selects.

---

## Related findings, not part of this item

Both were found during the same investigation. Recommend opening as separate holding-list items; neither is authorized by this Phase 0.

1. **Prompt caching is a silent no-op on five of the six cached blocks.** Haiku 4.5's minimum cacheable prefix is **4,096 tokens** (verified against Anthropic documentation, not the external artifact, which flagged its own figure as unverified). Below that, `cache_control` writes nothing and reports nothing — no error.

   **Corrected 2026-08-24.** The original draft said *"three of the four Haiku call sites"*; both numbers were wrong. There are **eight** Haiku call sites, and `extract-actions:148` is **Sonnet 4.6**, not Haiku. Block sizes measured directly from source rather than taken from code comments:

   | Call site | Model | Cached block | Caches? |
   |---|---|---|---|
   | `naavi-chat:3579` (main conversation) | Haiku | ~38–42K tok | ✅ **yes** — the only one; source of the 7.23× amortization |
   | `naavi-chat:1778` (Layer-2 classifier) | Haiku | ~3,500–3,800 tok | ❌ **no `cache_control` at all**, and `${nowToronto}` sits at the top of the prompt |
   | `extract-email-actions:236` | Haiku | 5,282 chars ≈ 1,300–1,500 tok | ❌ under threshold |
   | `extract-document-text:441` (PDF) | Haiku | 2,547 chars ≈ 640–710 tok | ❌ under threshold |
   | `extract-document-text:177` (OCR) | Haiku | 1,635 chars ≈ 410–450 tok | ❌ under threshold |
   | `ingest-note:54` | Haiku | ≈ 270 tok | ❌ under threshold |

   **This is not a misconfiguration and there is no configuration that fixes it.** The prompts are structurally too small for Haiku's threshold. **Do not pad them to reach 4,096** — that pays the 1.25× write premium on filler every call and ends up worse than not caching. Caching is not a cost lever for Naavi; call volume is, which is what B11x addresses.

2. **A banned word is live in production prompts — at three sites, not one.** CLAUDE.md bans "senior" in any prompt and directs retroactive application.
   - `extract-email-actions:161` — *"You are helping a senior user triage email."*
   - `extract-document-text:146` — *"...for a senior user."*
   - `extract-document-text:402` — *"...attached to a senior user's email."*

   **Corrected 2026-08-24** — the original draft listed only the first. Three one-line fixes, but they are prompt changes and carry the Phase 3 non-determinism rule (3 independent trials).

3. **A date is interpolated inside a cached block, at two sites.** `extract-document-text:146` and `:402` both embed `${todayISO}` *within* the text carrying `cache_control`. Any change inside a cached prefix invalidates it — this one daily rather than per-request. **Currently moot**, because both blocks are under the 4,096 minimum and never cache anyway, but it would defeat caching the moment either prompt grew past the threshold.

   Recorded because it is the exact defect the external artifact predicted from Console data alone, without having read the code. If any of these prompts is ever enlarged to make caching viable, this must be fixed in the same change — move the date out of the cached block and into the user message.

---

## What this Phase 0 does and does not authorize

**Authorizes, on Wael's approval:** the Phase 0→1 transition, and Phase 1's investigation — including measuring the real call count in Console → Usage.

**Does not authorize:** any code change, any mechanism, any schema change, any deploy, or drafting the Phase 2 document. Per governance §3, each transition needs Wael's own separate word.
