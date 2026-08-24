# B11x — Phase 1A: Architecture Completeness Review

**Work item:** [[B11x]] — redundant email classification
**Date:** 2026-08-24
**Phase 1:** `docs/B11X_PHASE1_PROBLEM_DEFINITION_2026-08-24.md` (commit `29d4077`)
**Architecture Reference version reviewed against:** **2026.07.18.10** (Revision 10, 2026-08-23, [[B11k]] Phase 1A)

**Status:** ⛔ **DOES NOT PASS. Phase 1's problem definition is materially incomplete.**

**Phase 2 must not begin.** Phase 1 requires revision and re-approval first.

---

## ⭐ Verdict in one paragraph

Phase 1 states the defect is driven by an **hourly cron**, giving **up to 168 classifications per email**. A fresh cross-surface grep — required by the Architecture Scope Rule and not performed during Phase 1 — finds **`sync-gmail` has five callers, not one**. Two of them pass a parameter `sync-gmail` does not read, so they silently run a **full 7-day sync for every active user** where a single-user sync was intended. One of those two is **the mobile app, on a 60-second interval.** The hourly cron is not the dominant trigger, and 168 is not the ceiling.

---

## The six mandatory questions

### 1. What is the architectural owner of the affected capability?

**Shared Core** — the Edge Functions codebase, `munk2207/naavi-app/supabase/functions/*`.
*Relying on Architecture Reference §0a classification, not re-checked this session.*

### 2. Is the capability Shared Core, Duplicated, or Platform-specific?

The Reference (§2) classifies it: *"Gmail — background sync | `sync-gmail` (Shared Core) | Genuinely shared, **cron-driven**, writes to `gmail_messages`."*

**The "Shared Core" half is correct. The "cron-driven" half is incomplete and is the source of this review's finding.**
*Freshly verified this session — evidence below.*

### 3. If duplicated, were all documented implementations investigated?

The classification logic itself is **not** duplicated — `extract-email-actions` is the single classifier.
*Freshly verified this session — evidence: a repo-wide grep for `extract-email-actions` finds exactly two invoking call sites, `sync-gmail:363` and `backfill-email-actions:67`; every other hit is a comment, a test, or a parity manifest entry.*

**But its trigger is duplicated five ways**, which Phase 1 treated as one. See §4.

### 4. Which implementations were investigated and which were not?

**All five callers of `sync-gmail` investigated. None excluded.**
*Freshly verified this session — evidence in the table below.*

| # | Caller | `file:line` | Params sent | Actual scope | Correct? |
|---|---|---|---|---|---|
| 1 | Hourly cron | `20260430000001_gmail_sync_cron_60min.sql:24` | none (`'0 * * * *'`) | all active users, 7 days | ✅ intended |
| 2 | `sync-active-email-alerts` — **5-minute cron** | `sync-active-email-alerts/index.ts:68` | `target_user_id` | one user, 7 days | ✅ correct |
| 3 | **Mobile app** | `lib/gmail.ts:33` | **none** | **all active users, 7 days** | ❌ **see §5.1** |
| 4 | `naavi-chat` email-search intent | `naavi-chat/intentHandlers.ts:346` | **`user_id`** | **all active users, 7 days** | ❌ **see §5.2** |
| 5 | `naavi-chat` live-recent + billing | `naavi-chat:1265`, `naavi-chat:3478` | `target_user_id`, `days_back: 1` | one user, 1 day | ✅ correct |

**Second consumer of the classifier, also not in Phase 1:** `backfill-email-actions/index.ts:67` calls `extract-email-actions` directly, bypassing `sync-gmail` entirely. Described in its own header as a one-off utility. **Any guard placed only in `sync-gmail` does not cover it.**
*Freshly verified this session — evidence: `supabase/functions/backfill-email-actions/index.ts:4, :45, :67`.*

### 5. Does the documented problem scope match the Architecture Reference?

**No — and the Reference is itself incomplete.** Two defects follow.

#### 5.1 ⭐ The mobile app triggers a global Gmail sync every 60 seconds

The chain, each link verified:

| Step | `file:line` | What it does |
|---|---|---|
| 1 | `app/index.tsx:1269` | `const syncInterval = setInterval(runSync, 60 * 1000);` |
| 2 | `app/index.tsx:1250` | `runSync` → `registry.email.sync(currentUserId)` |
| 3 | `lib/adapters/google/email.adapter.ts:75-77` | `async sync(userId: string) { await triggerGmailSync(); }` — **accepts `userId` and discards it** |
| 4 | `lib/gmail.ts:33` | `fetch('/functions/v1/sync-gmail', { method: 'POST' })` — **no body** |
| 5 | `sync-gmail:118-132` | no body → `daysBack = 7`, `targetUserId = null` → **every active user** |

*Freshly verified this session — every line above read directly.*

**Consequence:** while one user has the home screen open, `sync-gmail` runs a full 7-day sync — for **every active user in the system** — **once a minute**. Each of those runs re-fires `extract-email-actions` on every non-marketing message in every user's window, via the `!error` condition at `:362` that is B11x's root cause.

The adapter's signature is the tell: it takes a `userId` and throws it away. The intent was per-user; the behaviour is global.

**This also falsifies the Architecture Reference's "cron-driven".** Mobile is a direct client trigger of a capability the Reference documents as background-only. Per the Architecture Drift Rule this is an omission in the Reference, not merely in Phase 1.

#### 5.2 ⭐ `intentHandlers.ts:346` sends a parameter `sync-gmail` does not read

```
body: JSON.stringify({ user_id: userId }),
```

`sync-gmail` reads **only** `target_user_id` (`:131-132`). There is no `body.user_id` branch anywhere in the function.
*Freshly verified this session — evidence: `grep -n "body.user_id" supabase/functions/sync-gmail/index.ts` returns nothing; `:131` is the sole user-scoping branch.*

The unrecognised key is silently ignored and the call falls through to defaults: **all active users, 7 days.** The comment above it says *"so the answer reflects the current inbox"* — the author's intent was clearly one user.

**Every email search by any user triggers a full-window reclassification for every user.**

#### 5.3 What this does to Phase 1's central number

Phase 1 says *"up to 168 times (24 ticks/day × 7 days)."* That figure counts caller #1 alone.

| Trigger | Syncs/day | Notes |
|---|---|---|
| Hourly cron | 24 | Phase 1's only counted source |
| 5-min alert cron | up to **288** | per user with an enabled email alert |
| Mobile, home screen open | **60/hour** | global scope, per open app |
| Email-search intent | per query | global scope |

**168 is not the ceiling; it is the floor, and only when nobody is using the product.** The true multiplier is unbounded and partly driven by user activity — which means *using Naavi makes the bill worse*, a property Phase 1 does not capture at all.

**This is consistent with the billing evidence rather than contradicting it.** The flat overnight baseline is the crons, when no app is open. The taller daytime bars Phase 1 attributed to "the humans" are more likely the 60-second mobile interval — not conversation cost, but conversation *triggering* global reclassification. **Stated as inference, not observation:** distinguishing them requires the Console cache split or Edge Function invocation logs, neither yet obtained.

### 6. Is any documented implementation excluded from the investigation?

**No implementation is excluded.** All five `sync-gmail` callers and both `extract-email-actions` callers are enumerated above with evidence.

**Voice: explicitly out of scope, with justification.** The voice server never calls `sync-gmail` or `extract-email-actions`.
*Freshly verified this session — evidence: the only matches in `naavi-voice-server/src/index.js` are comments at `:693`, `:726` and `:1457` describing the pipeline; there is no `fetch` to either function.* Voice's Gmail contact is live/recent reads, a separate Duplicated capability formally accepted as an Architecture Exception (ADR 0006). **No matching change required in voice.**

**Mobile: NOT out of scope, contrary to Phase 1.** Phase 1 §6 states *"Mobile involvement: None."* §5.1 disproves that. Mobile owns a live trigger of the affected capability, and `app/index.tsx` + `lib/gmail.ts` + `lib/adapters/google/email.adapter.ts` must be treated as in-scope surfaces or explicitly excluded with a reason — silence is not acceptable in either direction.

---

## Required corrections to Phase 1

1. **§6 "Mobile involvement: None" is wrong.** Mobile triggers the capability every 60 seconds.
2. **§1 and §2.1's "168" must be reframed** as a floor for the cron path only, with the five-caller table replacing it.
3. **§6's Cross-Cutting Change Parity Check dismissal must be revisited.** Phase 1 argued the check does not apply because B11x is backend-only. If the mobile trigger is fixed, that stops being true and a client build enters scope.
4. **Add `backfill-email-actions` to In Scope or exclude it explicitly** — a `sync-gmail`-only guard does not cover it.

## Required correction to the Architecture Reference

§2's Gmail row reads *"Genuinely shared, cron-driven."* **Cron-driven is false.** Per the Architecture Drift Rule this is Outcome 3 — an omission predating this work item — and the Reference should gain the trigger inventory in the same session as the fix, with a version bump.

---

## Two findings that may not belong to B11x

Wael's call. Neither is authorized here.

1. **The mis-parameterised calls (§5.1, §5.2) are arguably their own defect.** They cause a global sync where a per-user sync was intended — a correctness and privacy-surface issue independent of cost. They may warrant a separate item, since fixing them is valuable even if B11x never ships.

2. **`registry.email.sync(userId)` discarding its argument** is the kind of signature-lies-about-behaviour bug that will be reintroduced unless the signature changes. Worth its own note whoever fixes it.

---

## What this document does and does not authorize

**Authorizes:** nothing. This is a **DOES NOT PASS** verdict.

**Requires:** Phase 1 revised on the four points above, re-reviewed, and re-approved by Wael before Phase 2 may be drafted.

**Does not authorize:** any code change, any mechanism, any schema change, any deploy.

---

## Provenance summary

Per the Verification Provenance Rule, every claim above is tagged. Two rest on the Architecture Reference without re-checking (§0a ownership; ADR 0006's exception status). **Every claim about what the code actually does was freshly verified this session by direct read**, and the central finding — §5.1 — was reached precisely because the Reference's own classification was not treated as sufficient.

That is this rule's purpose, and it is the second time it has paid: B10r's Phase 1A found `fetchUpcomingBirthdays` the same way, and the note in the governance document predicting recurrence was correct.
