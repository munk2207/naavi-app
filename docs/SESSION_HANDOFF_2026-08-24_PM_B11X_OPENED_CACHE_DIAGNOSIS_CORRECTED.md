# Session Handoff — 2026-08-24 PM

**B11x is the priority for the next session.** Its Phase 0 is drafted and **not approved.**

---

## ⭐ Start here

**[[B11x]] — `sync-gmail` re-sends every email in its 7-day window to Claude on every hourly run.**

Phase 0 document: `docs/B11X_PHASE0_INTENT_2026-08-24.md`
Holding list row: added, status OPEN.
**Status: awaiting Wael's Phase 0 approval. He was asked directly and the session ended before he answered — do not read the ending as approval.**

Approving Phase 0 authorizes **Phase 1 only** — the investigation. No code, no mechanism, no schema change, no deploy.

**The first Phase 1 step is already identified:** measure the actual call count in Console → Usage, filtered to Haiku 4.5. Everything in the Phase 0 document is read from source; the size of the effect is arithmetic from that, never measured. That number is what sizes this item honestly.

---

## What the defect is

`supabase/functions/sync-gmail/index.ts:362` fires `extract-email-actions` on:

```
if (!error && !isMarketing) {
```

`!error` is true for an **UPDATE** exactly as for an **INSERT**, and the upsert at `:354`
(`onConflict: 'user_id,gmail_message_id'`) cannot fail on a message already present. So the
condition holds on every run, for every message in the window.

Nothing downstream compensates. `extract-email-actions/index.ts` runs fetch row (`:66`) → date
(`:82`) → keyword pre-filter (`:146`) → Claude (`:232`), with **no check for prior
classification at any point**. The pre-filter is a fixed keyword list, so a message that passes
it passes on every run.

Cadence is hourly (`20260430000001_gmail_sync_cron_60min.sql:24`, `'0 * * * *'`). Window is
7 days. **Up to 168 Claude calls per email, where the intended number is 1.**

## ⭐ Two things the next session must not get wrong

**1. The obvious guard is a trap.** *"Skip if an `email_actions` row already exists"* would break
the majority of emails. `extract-email-actions:148-153` returns early with
`reason: 'pre_filter_no_keywords'` and **writes no row at all** — its own comment at `:107`
estimates that path takes 70-80% of emails. For those, "no row" cannot distinguish
never-processed from processed-and-found-nothing. Same for a Claude call that errored.

Wael chose fire-on-**insert** in `sync-gmail` for this reason. That decision is recorded in Phase 0.

**2. Fire-on-insert does not close the failed-attempt case.** An email whose classification errors
out on the tick it arrives would never be retried. Phase 2 owes an answer. Flagged in Phase 0, not
solved.

## ⭐ This has been fought three times at the wrong end

| Migration | Change | Stated reason |
|---|---|---|
| `20260422_gmail_sync_cron_reduce_frequency.sql` | 5 → 15 min | *"fires 3x more often than needed"* |
| `20260424_gmail_sync_cron_30min.sql` | 15 → 30 min | *"halving the cron frequency halves the cost"* |
| `20260430000001_gmail_sync_cron_60min.sql` | 30 → 60 min | *"$581 month-to-date across 2 users; mostly from this pipeline"* |

Each reduced the multiplier. None removed it. **Do not propose a cadence change as the fix** —
it is explicitly Out of Scope in Phase 0. If B11x works, cadence could arguably be raised back
toward responsiveness, which is a separate later decision.

---

## How this was found, and what it says about external diagnoses

Wael supplied an external artifact, *"MyNaavi Cache Remediation"* (24 Aug 2026), diagnosing his
Anthropic bill. Its central claim:

> the overwhelming majority of your Haiku requests simply never attempt it \[caching]

**That is wrong.** `cache_control` is set at **all six** Claude call sites — `naavi-chat`,
`get-naavi-prompt`, `extract-actions`, `extract-email-actions`, `ingest-note`,
`extract-document-text`. Its recommended fix — add the parameter — was already done.

The artifact's own closing caveat named the gap accurately: *"I have not read your edge-function
code."* One grep for `cache_control` disproved the premise. **The redundant-classification defect
was found while checking why the call volume was as high as the Console reported** — a question
the caching frame never asks.

**Worth carrying forward:** the artifact was well-argued, correctly sourced from real Console
numbers, and pointed at a genuine finding two orders of magnitude smaller than the real one.
Confident and sourced is not the same as checked against the code.

---

## Two findings NOT opened as items — Wael's call

Both are recorded in the Phase 0 document under "Related findings". Neither is authorized by it.

**1. Prompt caching is a silent no-op on three of four Haiku call sites.** Haiku 4.5's minimum
cacheable prefix is **4,096 tokens** — verified against Anthropic SDK documentation this session,
not taken from the artifact, which flagged its own figure as unverified. Below that, `cache_control`
writes nothing and reports nothing; no error. The cached blocks in `extract-email-actions`
(~1.2k tokens, per its own comment at `:158`), `extract-document-text` and `ingest-note` are all
under it. Only `naavi-chat:3579` (6K+ stable rules block) clears the bar — consistent with the
Console showing 2% cache writes and a healthy 7.23× amortization on the one path that qualifies.

**Do not "fix" this by padding prompts to reach 4,096** — that pays the write premium on filler.

**2. A banned word is live in a production prompt.** `extract-email-actions:161` opens:
*"You are helping a senior user triage email."* CLAUDE.md bans "senior" in any prompt and directs
retroactive application. One-line change, but it is a prompt change and carries Phase 3's
non-determinism rule (3 independent trials).

---

## Uncommitted at session end

```
 M docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md   (B11x row added; also had pre-existing edits from before this session)
?? docs/B11X_PHASE0_INTENT_2026-08-24.md            (new)
?? docs/SESSION_HANDOFF_2026-08-24_PM_...md         (this file)
```

**Nothing was committed. No code was written. No deploy happened.**

---

## Session hygiene note — two projects, two sessions

This session **opened as an AccountLens session, not a Naavi one.** Wael's first message was
*"i want to create a new project"*, his second *"not related to Naavi"*. A folder was created at
`C:\Users\waela\OneDrive\Desktop\AccountLens` and this session moved into it. He then supplied the
cache artifact, said it was under the wrong project, and asked for AccountLens to be removed and
the work restarted under Naavi. Its contents at that moment were only `.claude` and `.git`, both
auto-created minutes earlier; they were deleted and this session returned to Naavi.

**AccountLens is now a real project, built by a different session.** It was initialized at
**7:52 AM EST 2026-08-24** (commit `4e046a5` *"Initialize AccountLens"*) with its own `CLAUDE.md`
and `docs/ARCHITECTURE.md`, after this session had left. Its `CLAUDE.md` states scope is not yet
defined and carries a **"THIS IS NOT NAAVI"** section forbidding shared source, shared Supabase,
and wholesale copying of Naavi's rules.

**For the next session: AccountLens is not yours unless Wael says so.** Naavi's holding list,
staging refs, gates and governance do not apply there.
