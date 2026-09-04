# FAQ — Mobile Stage, Phase 1: Problem Definition

**Date:** 2026-09-04
**Item:** F25 Stage 2 (Wael's decision Q4 — extends F25, no new ID)
**Phase 0:** `docs/FAQ_MOBILE_PHASE0_INTENT_2026-09-04.md` — approved with 4 decisions, 2026-09-04
**Governance:** v4.3, Phase 1. **No code written during this phase.**
**Architecture Reference:** `2026.09.03.17`

Every claim below is a direct observation with its source. Where something is not proven, it says so.

---

## 1. What exactly is broken

**A — The app knows 12 of 26 published answers.** Its copy has not been updated since it was
written, and nothing forces it to be.

**B — The app's matcher cannot clear its own threshold on a single word.** This is arithmetic, not
tuning.

**C — There is no shared matcher.** The website reads meaning; the app compares literal words. The
same customer, describing the same problem, gets different results depending on which surface they
happen to use.

---

## 2. Evidence

### A — the copy

| Observation | Source |
|---|---|
| `lib/faq.ts` holds **12** entries | 12 `slug:` entries (13 matches, one of which is the `FaqEntry` interface field) |
| **26** answers are published | production `get-faq`, read 2026-09-04 |
| Its header instructs a human to keep it in sync | `lib/faq.ts:6-12` |
| Nothing enforces that | no test, no build step, no cron references it — the only automated reference asserts the count is 12, which *locks the staleness in* rather than detecting it (`tests/catalogue/faq.ts:568`) |

### B — the threshold

`lib/faq.ts:111-124`. `suggestFaq` scores each entry, keeps those at or above `minScore`, and both
call sites pass **`minScore: 2`** (`app/contact.tsx:50`, `app/report.tsx:66`).

`scoreEntry` awards **1** per literal keyword hit and **0.5** per title word present. So one
matching word scores **1.5** and can never qualify, however unambiguous it is. Measured in F25's
Phase 1 against the real function: `"how do i delete"` → 1.5, nothing; `"I want to add my daughter
to my community"` → **0**, against a published answer titled *"How do I add someone to my MyNaavi
Community?"*

**There is a second gate that has not been recorded before:** `lib/faq.ts:118` returns `[]` for any
text of fewer than **three words**. `"delete alert"` produces no suggestion at all, regardless of
score.

### C — the two matchers

| | Website | App |
|---|---|---|
| Matcher | `match-faq` (Shared Core), AI over published answers | `suggestFaq`, literal keyword arithmetic |
| Knows | all 26 | 12 |
| Runs | on Send | on every keystroke, 300 ms debounce (`app/contact.tsx:48-53`) |
| Minimum input | none | 3 words |

### Consumers — produced by searching, not recalled

`grep -rn "lib/faq"` across the repository, excluding `node_modules` and `.git`:

- `app/contact.tsx:31` — imports `suggestFaq`, `faqUrl`, `FaqEntry`
- `app/report.tsx:32` — the same three
- `tests/catalogue/faq.ts:568` — reads the file and asserts it holds 12 entries. **This test fails
  the moment the file is deleted, and that is correct — it must be rewritten, not deleted quietly.**
- `mynaavi-website/build-faq.js`, `supabase/functions/manage-faq/index.ts` — comments only, no code
- `.claude/worktrees/agent-af7f1550a5a91abbc/` — a **stale worktree**, not a live path. CLAUDE.md
  already records that worktrees under `.claude/worktrees/` are leftovers. Named here so a future
  search does not mistake it for a consumer.

**No other consumer exists.**

---

## 3. Root cause

**Proven. One cause, and it is the same one Stage 1 fixed everywhere else.**

The app has no data layer to read the FAQ from, so it carries its own copy. `lib/faq.ts` is
authored content compiled into the client — it can only change when someone edits it and ships a
release. Stage 1 removed that constraint for the website by putting the answers behind `get-faq`
and `match-faq`; the app was deliberately left out of Stage 1's scope, so its copy remains.

**Both defects follow from that single fact, not from two separate mistakes.** The 14 missing
answers are what happens when a copy is not updated. The scoring ceiling is what happens when
matching has to run locally against a compiled array — there is no model available on the device,
so it can only compare words.

**Not proven, and not claimed:** that customers are filing tickets in the app they would not file
if matching worked. No ticket data was examined.

---

## 4. Alternatives considered

| Alternative | Why rejected |
|---|---|
| Generate `lib/faq.ts` from the database at build time | Ends the drift, keeps the weaker matcher, and still spends a release. Wael rejected it 2026-09-04 in favour of calling `match-faq`. Phase 3's D3 named it and this closes it |
| Lower `minScore` from 2 to 1 | Measured in F25 Phase 1: `delete` alone then matches multiple unrelated entries, and the 14 absent answers still score 0. Fixes nothing that matters |
| Keep local matching, add the 14 missing entries by hand | Restores the drift the moment answer 27 is written. This is the mechanism that produced the defect |
| Ship a local copy AND call `match-faq` | Forbidden by Phase 0 Q2 — a local fallback copy is the thing this stage exists to delete |
| **Chosen: the app calls `match-faq`; `lib/faq.ts` is deleted** | One matcher, one set of answers, no copy left to drift |

---

## 5. Architecture location

**Answered from the Reference, which now covers this** — F25 Phase 8 added the rows on 2026-09-03.

| Question | Answer |
|---|---|
| Owning component | **Shared Core** — `match-faq`, per §2 |
| Classification | **Shared Core**, consumed by the website today |
| What changes | Mobile becomes a **second consumer**. No ownership moves, so §4's Ownership Change Rule does **not** apply |
| §5a effect | The FAQ-content duplication row (Priority 1d) closes: two copies become one |

**Cross-repository verification, freshly verified this session:**

- **Voice — freshly verified this session, evidence:** `grep -ric "faq"` across every file in
  `naavi-voice-server/src/` returns **0** in all six source files. No FAQ logic exists on either
  branch; nothing to change and nothing to justify omitting.
- **Website and staff portal — freshly verified this session:** both call `match-faq` / `get-faq`
  over HTTP and hold no matching logic. Neither changes.
- **Mobile — freshly verified this session, evidence:** `app/contact.tsx:31` and
  `app/report.tsx:32` are the only importers of `lib/faq.ts` in live code.

---

## 6. The mobile-safe rate-limit identity — Wael's Q3

Phase 0 made this a required Phase 1 investigation, and explicitly rejected raising the ceiling.

### What exists today

`supabase/functions/match-faq/index.ts:113-135`. The key is `sha256` of the first value in
`x-forwarded-for`; the limit is **20 requests per 5-minute window**; the table's primary key is
`(ip_hash, window_start)` (`20260902000000_f25_faq_items.sql:128-133`).

**`match-faq` reads no authentication at all today** — no `getUser`, no `user_id`, nothing.

### ⭐ The cache sits BEFORE the limiter, and this materially shrinks the problem

`match-faq` checks `faq_match_cache` at **:95** and returns at **:109**, *before* the rate-limit
block at **:112** — under a comment that says so: *"only for calls that will actually cost money."*

**So a repeated question costs nothing and consumes no quota.** Two customers behind one carrier
gateway asking the same thing consume one slot, not two. The NAT problem is real but it applies
only to *distinct* questions, which is the smaller half of the traffic.

**This does not make IP keying acceptable** — Wael's ruling stands, and a busy gateway still
aggregates many people's distinct questions into one bucket of 20. It does mean the risk is
narrower than "every mobile user shares one budget", and any Phase 2 proposal that ignores the
cache ordering will size the problem wrongly.

### The identity that is already available

**Freshly verified this session:** both screens already hold an authenticated session and already
send it to an Edge Function.

- `app/contact.tsx:58-61` reads `session.user.id`; `:85-93` sends
  `Authorization: Bearer <session.access_token>` to `ingest-ticket`
- `app/report.tsx:77`, `:106-114` — the same pattern

So a per-person key exists on the device today and needs no new plumbing on the client.

### Options, for Phase 2 to choose between

| | Approach | Assessment |
|---|---|---|
| a | **Verified user id when a JWT is present, IP otherwise** | Correct identity, immune to NAT, and does not weaken the web control. Cost: verifying the token is an auth round-trip on every call, added to a path already at ~1.3 s |
| b | Hash the bearer token without verifying it | No network cost. **Reject** — a caller sending random strings gets unlimited buckets, which defeats the limit rather than adapting it |
| c | Verify the JWT signature locally against the project secret | Same identity as (a) with no round-trip. More code, and a secret to handle |
| d | A client-supplied device id | Same defect as (b): client-controlled, so trivially rotated |

**Claude's assessment: (a) or (c), and the choice between them is latency versus complexity.**
Not a Phase 1 decision.

### ⚠️ Two consequences Phase 1A must rule on

1. **This makes `match-faq` read authentication for the first time.** Authentication and Permissions
   are both Protected Core (§4). The function must stay usable with **no** credentials — the public
   website depends on that — so whatever is added is an *optional* identity, never a requirement.
2. **The anon-key fallback collapses buckets.** `app/contact.tsx:86` falls back to `SUPABASE_ANON`
   when there is no session, and that value is identical for every install. Keying on the token
   would put every signed-out app user in **one** bucket — worse than IP. Any design must treat the
   anon key as "no identity", not as an identity.

---

## 7. What Phase 1A must settle

1. Whether adding an optional authenticated identity to `match-faq` is a Protected Core change
   requiring the full review, and what that obliges.
2. Whether mobile becoming a second consumer of a Shared Core function needs anything beyond the
   §2 row it already has.
3. The rate-limit identity: (a) or (c), with the latency measured rather than estimated.
4. What replaces `tests/catalogue/faq.ts:568`, which asserts a file this stage deletes.

**No implementation may begin. Phase 2 is not authorised by this document.**
