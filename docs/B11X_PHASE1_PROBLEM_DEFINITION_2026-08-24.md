# B11x — Phase 1: Problem Definition

**Work item:** [[B11x]] — `sync-gmail` re-sends every email in its 7-day window to Claude on every cron tick
**Date:** 2026-08-24
**Phase 0:** `docs/B11X_PHASE0_INTENT_2026-08-24.md` — approved with comments by Wael, 2026-08-24
**Status:** **REVISED 2026-08-24 after Phase 1A returned DOES NOT PASS.** Awaiting Wael's re-approval. No code written. No mechanism selected.

**⭐ Revision 2 (2026-08-24).** Phase 1A (`docs/B11X_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-08-24.md`, commit `a06dafa`) found this document's problem definition materially incomplete: it counted one caller of `sync-gmail` where there are five, and declared mobile uninvolved when mobile triggers the capability every 60 seconds. Four corrections applied — §1, §2.1, §6, and In Scope. **The original claim of "up to 168" is preserved below, marked as superseded, rather than quietly overwritten** — a reader needs to see what the first pass believed and why it was wrong, or the same reasoning recurs.

**Governance note.** Per `AI_DEVELOPMENT_GOVERNANCE.md` §3, no phase's own completeness is permission to proceed. This document answers Phase 1's five questions and nothing further.

---

## ⭐ The escalation Phase 0 did not record

**B11x touches Protected Core.** Phase 0 assigned "Governance: Full Phase 1–8" and "Risk: MEDIUM" without citing the Architecture Reference. That governance level happens to be correct, but for a reason Phase 0 never stated:

> **Gmail integration** — `sync-gmail`, both sides' live-fetch code, `extract-email-actions`, `harvest-attachment` — *"Reads a real inbox; privacy-sensitive, and feeds several other features (document harvesting, alerts)"* — **Review level: Full Phase 1-8**
> — Architecture Reference §4, Protected Core

**Both files named In Scope by Phase 0 are Protected Core files.** Per §4, that means technical review **before *and* after** any change, regardless of how small it looks, and Wael's explicit go-ahead between every phase.

A second Protected Core area sits adjacent but is **not** touched: *Background scheduling* covers the `cron.job` entry for `sync-gmail`. Phase 0 places cadence changes explicitly Out of Scope, so this item must not modify it. **Phase 2 must not "fix" this with a cron edit** — that would silently pull a second Protected Core area into scope.

---

## 1. What exactly is broken

**Every email in the rolling 7-day window is re-sent to Claude on every `sync-gmail` run, for as long as it remains in the window.**

The intended number of classifications per email is 1. **The actual number has no fixed ceiling.**

> **Superseded, retained deliberately.** Revision 1 said: *"The actual number is up to 168 (24 ticks/day × 7 days)."* That counted the hourly cron and nothing else. Phase 1A found four more triggers. **168 is the floor, reached only when nobody is using the product** — see §2.1a.

**The property this reframing exposes, which revision 1 missed entirely: using Naavi makes the bill worse.** Every open app and every email question adds full-window reclassifications on top of the crons.

Nothing is functionally wrong with the output — `email_actions` rows are correct, the morning brief is correct, Global Search is correct. **The defect is exclusively cost.** That is why it survived four months and three attempted fixes: there is no user-visible symptom.

---

## 2. What evidence proves the problem

### 2.1 Source evidence (observation)

**`supabase/functions/sync-gmail/index.ts:336-354`** — the upsert:

```
const { error } = await adminClient
  .from('gmail_messages')
  .upsert({ ... }, { onConflict: 'user_id,gmail_message_id' });
```

**`:362`** — the firing condition, twelve lines later:

```
if (!error && !isMarketing) {
  fetch(`${...}/functions/v1/extract-email-actions`, { ... })
}
```

`!error` is true for an **UPDATE** exactly as for an **INSERT**. An upsert on a row already present cannot fail. The condition therefore holds on every tick, for every non-marketing message in the window.

**Window:** `sync-gmail/index.ts:118` — `let daysBack = 7;` (read from source, not from CLAUDE.md).

### 2.1a ⭐ `sync-gmail` has five callers, not one (added by Phase 1A)

Revision 1 named only the hourly cron. Every row below was freshly verified by direct read.

| # | Caller | `file:line` | Params sent | Actual scope | Correct? |
|---|---|---|---|---|---|
| 1 | Hourly cron | `20260430000001_gmail_sync_cron_60min.sql:24` (`'0 * * * *'`) | none | all active users, 7 days | ✅ intended |
| 2 | `sync-active-email-alerts` — **5-minute cron** | `sync-active-email-alerts/index.ts:68` | `target_user_id` | one user, 7 days | ✅ correct |
| 3 | **Mobile app, 60-second interval** | `lib/gmail.ts:33` | **none** | **all active users, 7 days** | ❌ |
| 4 | `naavi-chat` email-search intent | `intentHandlers.ts:346` | **`user_id`** | **all active users, 7 days** | ❌ |
| 5 | `naavi-chat` live-recent + billing | `naavi-chat:1265`, `:3478` | `target_user_id`, `days_back: 1` | one user, 1 day | ✅ correct |

**Callers 3 and 4 pass a parameter `sync-gmail` does not read**, so both fall through to the global default. `sync-gmail` accepts only `target_user_id` (`:131-132`); there is no `body.user_id` branch anywhere in the function.

**Caller 3's chain:** `app/index.tsx:1269` `setInterval(runSync, 60 * 1000)` → `:1250` `registry.email.sync(currentUserId)` → `email.adapter.ts:75-77` `sync(userId) { await triggerGmailSync(); }`, **which accepts the user id and discards it** → `lib/gmail.ts:33`, POST with no body.

**Both are tracked as their own defect, [[B11y]]** — they cause a global fan-out where a per-user call was intended, which is a correctness and privacy-surface question independent of cost.

**A sixth path bypasses `sync-gmail` entirely:** `backfill-email-actions/index.ts:67` calls `extract-email-actions` directly. A guard placed only in `sync-gmail` does not cover it. Now named In Scope below.

### 2.2 The receiving function does not compensate (observation)

The complete path in `supabase/functions/extract-email-actions/index.ts` from entry to the Claude call:

| Step | Line | What it does |
|---|---|---|
| Fetch the email row | `:66-71` | Selects `subject, sender_name, sender_email, snippet, body_text, received_at, is_tier1` |
| Compute today's date | `:82-90` | For anchoring relative dates in the email |
| Keyword pre-filter | `:110-146` | Fixed `ACTIONABLE_KEYWORDS` list matched against email text |
| Call Claude | `:232-238` | `claude-haiku-4-5`, `max_tokens: 512` |

**There is no check for prior classification at any point.** The SELECT at `:66-71` does not even *fetch* a field that could answer the question — no such field is requested, because no such field exists (§4.2 below).

The pre-filter at `:110-146` is a deterministic keyword match against unchanging stored text, so a message that passes it passes on every tick.

### 2.3 Billing evidence (observation)

Anthropic Console → Usage. Filters: API key `naavi-edge-functions-2026-05` · Model `claude-haiku-4-5` · Workspace All · Account All · **View by Day, 2026-08-24**.

| Metric | Value |
|---|---|
| Total tokens in | **22,916,042** |
| Total tokens out | 510,679 |
| Hours elapsed at capture | ~19 |
| Implied rate | **≈ 1.21M input tokens/hour** |

**The shape is the evidence.** Broken into hourly bars the traffic is flat — ~1.2M tokens every hour, bar after bar, overnight included, with a few taller and shorter bars at the right edge.

**Naavi has two users.** Two people do not produce a level 1.2M tokens/hour at 3 AM. Human traffic is spiky and clusters around waking hours. A flat hourly line is a machine repeating identical work on a schedule — which is what `'0 * * * *'` does.

**The flat baseline is the cron. The variable bars riding on top are the humans.**

### 2.4 What is inference, not observation

Per 5-levers #3, stated explicitly:

- **Observation:** every source citation above; the four Console figures; the flat hourly shape; every prompt size measured from source.
- **Inference:** that the flat baseline is `extract-email-actions` *specifically* rather than another hourly job. Anthropic Console bills per API key and every Edge Function shares one key, so it cannot attribute per function.
- **Inference:** the per-call token estimate (~2,150 = 1,300–1,500 measured prompt + a body capped at 3,000 chars) and therefore the derived call count.

**The proposed discriminator, not yet run:** the Console *Caching* view's uncached vs. cache-read split. The classifier prompts are all below Haiku 4.5's 4,096-token minimum and cannot cache; `naavi-chat`'s cached block is ~38–42K tokens and does. If the flat traffic is overwhelmingly **uncached**, attribution to the classifier is settled. Requested from Wael, not yet supplied.

**This does not block Phase 1A.** It sharpens attribution; it does not change the root cause, which is proven from source.

---

## 3. Root cause

**Root cause: PROVEN.**

`sync-gmail/index.ts:362` uses the *success of an upsert* as a proxy for *the arrival of a new message*. Those are different facts, and the upsert cannot distinguish them: `{ onConflict: 'user_id,gmail_message_id' }` succeeds identically whether it inserted a row or updated one.

No downstream stage recovers the lost distinction, because `extract-email-actions` never asks the question (§2.2).

**The single sentence:** *the pipeline has no record that a message was already classified, and infers "new" from a signal that does not carry that information.*

---

## 4. Why this stage lacks the guard its neighbours have

Not required by governance, but it is the reason three prior fixes missed and belongs in the record.

### 4.1 Three of four stages are already guarded (observation)

| # | Stage | Guard against redoing work |
|---|---|---|
| 1 | `sync-gmail` — fetch & store | ✅ `UNIQUE (user_id, gmail_message_id)` — no duplicate rows |
| 2 | `extract-email-actions` — **Claude classifies** | ❌ **none** |
| 3 | `harvest-attachment` — download attachment | ✅ **two** layers, both verified this session: a pre-INSERT lookup on `(user_id, gmail_message_id, file_name)` at `:308-311`, and `onConflict: 'user_id,gmail_message_id,file_name', ignoreDuplicates: true` at `:371` |
| 4 | `extract-document-text` — OCR / read | ✅ `extracted_at` + the classify-once rule, `extract-document-text:615` |

Plus three shipped cost measures that are real and are not this defect: the **V57.7 dormancy filter** (`sync-gmail:162`), the **V57.9.1 backfill gate** (`sync-gmail:141`), and the **V57.7 keyword pre-filter** (`extract-email-actions:110-146`).

**The reprocessing problem was correctly identified and correctly solved — for the stages that leave a durable artifact behind.** Stage 2 often leaves nothing, so it was skipped.

### 4.2 ⭐ The fact needed does not exist in the schema (observation)

`gmail_messages`, per `supabase/migrations/20260321_missing_base_tables.sql`:

```
id, user_id, gmail_message_id, thread_id, subject, sender_name,
sender_email, snippet, body_text, received_at, is_unread,
is_important, is_tier1, signal_strength, labels, updated_at
```

**There is no `created_at` and no classification-state column.** `updated_at` is set to `now()` on every upsert (`sync-gmail:353`), so it records when the row was last touched, never when it first arrived. **The row cannot answer "is this new?" about itself.**

Contrast `email_actions` (`20260419000001_email_actions.sql`), which has both `extracted_at` and `created_at` — and `documents`, whose `extracted_at` is exactly what lets stage 4 enforce classify-once.

**Where the "already classified" fact exists today:**

| Case | Share | Fact available? |
|---|---|---|
| Claude ran, found an action | minority | ✅ `email_actions` row, with `extracted_at` |
| Pre-filter rejected the email | **70-80%** (`extract-email-actions:107`) | ❌ **nothing written** |
| Claude call errored | unknown | ❌ **nothing written** |

**This is the central constraint Phase 2 inherits.** For the majority of emails, "no row" cannot distinguish *never processed* from *processed and correctly found nothing*. Phase 0 flags this as the trap; Phase 1 confirms it from the schema and adds the reason: **the absent fact is absent by construction, not by oversight.**

Consequence to state plainly: **the mechanism must either derive the fact from something outside the row (which requires no schema change), or create the fact (which does).** Phase 0 grants no schema-change authority. Phase 2 must resolve this and may need to come back for separate approval.

---

## 5. Alternatives considered

| # | Alternative | Status |
|---|---|---|
| 1 | **Reduce cron cadence** | **Tried three times, rejected.** `20260422` 5→15 min, `20260424` 15→30 min, `20260430000001` 30→60 min. Each divided the multiplier; none removed it. The multiplier is the defect. Explicitly Out of Scope, and touching it pulls in a second Protected Core area. |
| 2 | **Prompt caching** | **Measured and rejected.** `cache_control` is already set at every Claude call site. Five of six cached blocks sit under Haiku 4.5's 4,096-token minimum and write nothing — not a misconfiguration, and no configuration fixes it. Padding prompts to reach the threshold pays the 1.25× write premium on filler. Caching would at best make redundant calls cheaper; B11x stops making them. Detail: Phase 0, "Related findings" #1. |
| 3 | **Shrink the 7-day window** | **Rejected — same error as #1.** Reduces the multiplier, does not remove it, and loses coverage the morning brief depends on. |
| 4 | **Skip if an `email_actions` row exists** | **Rejected — would break Success Criterion 3.** Fails for the 70-80% pre-filtered case and for errored calls (§4.2). This is the trap Phase 0 names. |
| 5 | **Record the fact that a message was classified** | **Open — the surviving direction.** Includes both schema-free variants (deriving "new" at the `sync-gmail` boundary) and schema-bearing ones (a column or table). **Phase 1 does not choose between them.** |

Insert-vs-update detection at `sync-gmail:362` is one candidate within #5, named by Phase 0 as an option to evaluate. **It does not by itself solve the failed-attempt retry case** — an email whose classification errors on the tick it arrives would never be retried. Phase 2 owes an answer for that case whichever mechanism it selects.

---

## 6. Architecture ownership and classification

Per Architecture Reference §0a Ownership Model:

| Question | Answer | Citation |
|---|---|---|
| Owning component | **Shared Core** — the Edge Functions codebase, `munk2207/naavi-app/supabase/functions/*` | §0a |
| Capability classification | **Shared Core** — *"Gmail — background sync \| `sync-gmail` (Shared Core) \| Genuinely shared, cron-driven, writes to `gmail_messages`"* | §2, capability table |
| Protected Core? | **Yes — "Gmail integration", Full Phase 1-8** | §4 |
| Mobile involvement | ⭐ **NOT none — corrected by Phase 1A.** Revision 1 said "None", citing that document harvesting is *"Mobile-backend only… server-side, no client code."* That is true of *harvesting* and irrelevant to *triggering*: `app/index.tsx:1269` fires `sync-gmail` every 60 seconds via `lib/gmail.ts:33`. **`app/index.tsx`, `lib/gmail.ts` and `lib/adapters/google/email.adapter.ts` are in-scope surfaces.** | Freshly verified |
| Voice involvement | **None.** Voice never calls this path. Voice's Gmail contact is *live/recent reads*, a separate Duplicated capability (ADR 0006) | §2, §5 |

**Architecture location: PROVEN.** Every row above is a citation into the Architecture Reference, not a grep.

**Environment consequence (§0b):** the mobile app and Supabase each have two environments. The fix is exercised on staging `xugvnfudofuskxoknhve` and reaches production only on Wael's explicit word.

⭐ **Cross-Cutting Change Parity Check — status changed by Phase 1A.** Revision 1 dismissed it: *"B11x is backend-only — no mobile build, no voice deploy."* That rested on the "Mobile involvement: None" error corrected above.

**It now depends on a decision Phase 2 has not made.** If the fix is confined to Shared Core, the check still does not apply. If it touches `lib/gmail.ts` or `email.adapter.ts` to stop the 60-second global trigger, **a mobile client build enters scope** and the check becomes mandatory — the backend half must be confirmed deployed to the same environment the client build points at, by direct evidence.

**Phase 2 must state which case applies rather than inheriting revision 1's dismissal.** Voice remains genuinely uninvolved either way: *freshly verified this session — no `fetch` to `sync-gmail` or `extract-email-actions` exists in `naavi-voice-server/src/index.js`; the only matches are descriptive comments at `:693`, `:726`, `:1457`.*

---

## 7. What Phase 1 establishes that Phase 0 did not

1. **This is Protected Core** (§4 of the Reference) — Phase 0 set the governance level without knowing why.
2. **The required fact is absent from the schema by construction** — `gmail_messages` has no `created_at` and no classification-state column, so the row cannot answer "is this new?" about itself.
3. **The billing evidence is now measured, not arithmetic** — the flat hourly line, and the reasoning that two users cannot produce it.
4. **The cost is material.** ~$930/month was projected here; **corrected 2026-08-24 (Phase 7) to ≈$15/day (~$450/month) all-in** — the original extrapolation came from a 19-hour window that also contained this session's own test runs, and actual billing ($357.68 since 1 August) contradicts it. The flat hourly line and the root cause are unaffected.
5. **Attribution to `extract-email-actions` specifically is still an inference**, with a named discriminator not yet run.

---

## 8. Carried into Phase 1A / Phase 2

0. ⭐ **Which triggers the fix must cover** (added by Phase 1A). A guard in `sync-gmail` covers callers 1–5 but **not** `backfill-email-actions:67`, which reaches `extract-email-actions` directly. Phase 2 must either place the guard where all six paths pass through it, or exclude `backfill-email-actions` explicitly with a reason. **`backfill-email-actions` is hereby In Scope for that decision** — its header calls it a one-off utility, which is an argument for exclusion, not a reason to leave it unaddressed.

0b. ⭐ **Whether B11x fixes the global fan-out or leaves it to [[B11y]].** Callers 3 and 4 make the multiplier user-activity-driven. B11x could make each classification idempotent and leave the excess *syncs* in place, or the two items could be sequenced. **Phase 1 does not decide this**; Phase 2 must state which, because it determines whether a mobile build enters scope (§6).

1. **The failed-attempt retry case.** Unsolved by any mechanism yet named.
2. **Schema change or not.** §4.2 makes this the pivotal question. Phase 0 grants no authority; Phase 2 may need to return for it.
3. **The Console caching split.** Outstanding from Wael. Sharpens attribution; does not gate Phase 1A.
4. **Protected Core review, both sides.** Per §4, before *and* after.
5. **Rule 15a.** A regression test locking "second sync run makes no Claude call" must exist and pass before this item closes.

---

## 9. What this document does and does not authorize

**Authorizes, on Wael's approval:** the Phase 1 → Phase 1A transition (Architecture Completeness Review).

**Does not authorize:** any code change, any mechanism selection, any schema change, any deploy, or drafting the Phase 2 document. Per governance §3, each transition needs Wael's own separate word.

---

## Appendix — unrelated, raised separately

**Account credit balance displayed $9.00** at the 2026-08-24 capture, roughly seven hours of runway at the observed burn. Exhaustion fails every Claude call on every surface — mobile, voice, demo line, morning brief. **Not part of this work item** and not fixed by it; recorded because it was observed during Phase 1 evidence gathering.
