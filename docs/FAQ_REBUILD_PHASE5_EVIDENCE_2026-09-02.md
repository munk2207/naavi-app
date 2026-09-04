# FAQ Rebuild — Phase 5: Evidence Package

**Date:** 2026-09-02
**Item:** F25
**Phases 0, 1, 1A, 2, 3:** approved by Wael. Phase 2 amended twice (Phase 3 review, then the six mandated changes).
**Architecture Reference:** `2026.09.01.16`
**Environment:** everything below is **staging** (`xugvnfudofuskxoknhve`). **Nothing has been committed, pushed, or deployed to production.**

> ## STATUS: complete — the Phase 5 hold is closed
>
> **Phase 5 review held on 2026-09-02** on one finding: the dynamic FAQ page reduced search-engine indexing, because the answer text was no longer present in static HTML for crawlers that do not execute JavaScript.
>
> **Wael's ruling: do not accept the regression.** Crawlable answers preserved, database still the single source of record. **Built and verified — see §10.** Phase 2 §7b and Phase 3 Part C2 were amended for the scope addition before it was implemented, as the review required.
>
> **A note on how the decision was reached, because the reasoning was wrong first.** I recommended checking `/faq` search traffic and treating negligible traffic as grounds to accept the regression. **Wael corrected that: the traffic is zero because there are no real users yet.** Today's analytics measure the absence of a user base, not the value of search to the users this is being built for — and the cheap moment to make a page crawlable is before anything depends on it.

---

## 1. Summary

The FAQ was authored as markup in three places with no source of record, so every surface kept its own copy and one had been eleven questions behind for months. Finding an answer required the customer to use MyNaavi's vocabulary; the website's own support forms had no matching at all.

**What now exists on staging:** one stored record, written through a single entry point, read by the customer FAQ page and by a shared matcher that reads meaning rather than words. Staff write answers in the portal they already use. The 23 existing answers moved across unchanged.

**Scope held.** Web only. No mobile file changed, no voice file changed, no cron created. `lib/faq.ts` is untouched, so duplication drops from three copies to two — not to one — exactly as Phase 2 stated.

---

## 2. Files changed

**14 planned in Phase 2 §1, plus 3 approved in §7b after the Phase 5 hold. 17 delivered. No file was added beyond the plan.**

### `munk2207/naavi-app`

| File | Class | State |
|---|---|---|
| `supabase/migrations/20260902000000_f25_faq_items.sql` | Database | new |
| `supabase/functions/get-faq/index.ts` | Backend | new |
| `supabase/functions/manage-faq/index.ts` | Backend | new |
| `supabase/functions/match-faq/index.ts` | Backend | new |
| `scripts/migrate-faq-to-db.js` | Backend | new |
| `tests/catalogue/faq.ts` | Tests | new |
| `tests/runner.ts` | Tests | +2 lines (import + registration) |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | — | +2 lines (F25 row + summary line, approved separately under Rule 1b) |

### `munk2207/naavi-staff`

| File | Class | Diff |
|---|---|---|
| `faq.html` | UI | new — the authoring page |
| `index.html` | UI | +9 — the FAQ tile |
| `support.html` | UI | +24 — "Make this an FAQ" |
| `vercel.json` | Configuration | +1 — the `/faq` rewrite |

### `munk2207/mynaavi-website`

| File | Class | Diff |
|---|---|---|
| `faq.html` | UI | +126 / −425 — dynamic page; the 192-line hand-maintained JSON-LD block removed |
| `report.html` | UI | +72 — match on Send |
| `contact.html` | UI | +71 — match on Send |

**Also present but not part of F25:** `docs/.obsidian/workspace.json` and `supabase/.temp/cli-latest` are incidental tool churn, and `mynaavi-website/.backups/`, `my-naavi-site/` and a stray `.mp3` were already untracked before this session. None will be committed with this work.

---

## 3. Git diff

Not yet committed anywhere. Working-tree state:

```
naavi-app        4 modified, 11 new (5 are the phase documents)
naavi-staff      3 modified, 1 new          35 insertions
mynaavi-website  3 modified                271 insertions, 425 deletions
```

The website's large deletion count is almost entirely the removed JSON-LD block and the 23 static `<details>` blocks whose content now lives in the database.

---

## 4. Tests executed

### 4a. Auto-tester — `npm run test:auto --grep f25.`

**17 tests, 17 passed, 0 failed, 0 errored, 0 skipped.** (13 before §10; four added with it.)

```
f25.match.delete-an-alert ....................................... PASS (4157ms)
f25.match.partial-phrase ........................................ PASS (3752ms)
f25.match.no-shared-words ....................................... PASS (3449ms)
f25.match.described-not-named ................................... PASS (3498ms)
f25.match.returns-nothing-when-nothing-fits ..................... PASS (6167ms)
f25.regression.json-extractor-handles-trailing-prose ............ PASS
f25.regression.match-faq-validates-returned-slugs ............... PASS
f25.regression.manage-faq-allows-span ........................... PASS
f25.manage-faq-rejects-event-handlers ........................... PASS
f25.manage-faq-fails-open-on-classifier-outage .................. PASS
f25.get-faq-has-no-caller-controlled-filtering .................. PASS
f25.get-faq-serves-every-anchor-the-app-links-to ................ PASS (343ms)
f25.seo.answers-present-in-static-html .......................... PASS
f25.seo.generated-block-is-output-not-a-source .................. PASS
f25.seo.failed-fetch-keeps-the-static-answers ................... PASS
f25.seo.save-is-not-blocked-by-the-deploy-hook .................. PASS
f25.web-pages-are-wired ......................................... PASS
```

⚠️ **The first run of this suite reported 7 passed / 6 skipped, and the summary looked healthy.** The six live cases were skipping because this file read `process.env` at module scope, and `runner.ts` loads `.env` at line 165 — *after* importing the catalogue at line 28. Reads were made lazy. **A skip is not a pass**, and a suite that skips its only meaningful cases while printing green is worse than one that fails.

### 4b. Non-Determinism Rule — full distribution, 3 independent trials each

Governance Phase 3 requires a minimum of 3 independent trials per positive-control case, with the distribution reported rather than a single outcome.

**"Independent" required work:** `match-faq` caches by normalised input (A1e), so three identical calls would replay one model answer three times. **Each trial deletes the cache row first.** A 3-trial rule and a result cache are in direct tension, and nothing in the plan noticed until the test was written.

| Phrase | Keyword score today | Trial 1 | Trial 2 | Trial 3 | Result |
|---|---|---|---|---|---|
| `how do i delete an alert` | 3.0 — works | delete-alert | delete-alert | delete-alert | **3/3** |
| `how do i delete` | 1.5 — nothing | delete-alert, manage-lists | same | same | **3/3** |
| `my alarm didn't go off this morning` | 1.5 — nothing | set-up-alert, report-problem | same | same | **3/3** |
| `I want to add my daughter to my community` | **0.0 — nothing** | community-add | community-add | community-add | **3/3** |
| `order a pizza for delivery tonight` (control) | — | no_match, [] | no_match, [] | no_match, [] | **3/3** |

**No variation was observed across any trial.**

⭐ **One expectation was wrong and was corrected, not re-run.** `my alarm didn't go off this morning` initially returned **0/3** against an expected `brief-showing-tomorrow`. Investigation showed the *expectation* was wrong: that phrase and the morning-brief answer were paired on the word "morning", but the brief question is about the brief showing the wrong *day*, not an alert failing to fire. The matcher's answer — set-up-alert and report-problem — is better. **Wael ruled on this directly (option 1, 2026-09-02)** and Phase 0's Success Criterion was corrected with the reasoning recorded in place.

### 4c. Migration — the 23 answers, word for word

```
parsed 23 answers from mynaavi-website/faq.html
written: 23/23   classifier-flagged: 0
--- word-for-word comparison, all 23 ---
  identical: 23/23    differing: 0
ALL 23 ANSWERS MIGRATED WORD FOR WORD.
--- anchors ---
  23 in source, 23 live, 0 lost
```

The comparison strips tags and entities and compares visible words. Phase 0's constraint was that wording must not change; this is the proof, printed rather than asserted.

### 4d. Schema — all four data-integrity layers

```
tables exist (service_role)          faq_items · faq_categories · faq_match_cache · faq_rate_limit — HTTP 200
categories seeded                    the six approved, in sort order
L3 RLS — anon key on all four        rows=0 on every table (no policy = no rows; service_role bypasses)
L1 duplicate slug                    first insert 201, duplicate 409 (23505)
CHECK bad slug shape                 400 rejected
CHECK blank question                 400 rejected
CHECK blank answer                   400 rejected
```

### 4e. Classification of the 23

All 23 classified, **0 needed the fail-open path**. 15 of 23 landed in more than one category — the multi-category requirement working, not a theory. Average 11.4 search terms per answer.

Distribution: Talking to MyNaavi 13 · Alerts & reminders 9 · Getting started 8 · Privacy & help 6 · Calls & briefings 4 · Messages & lists 4.

**Observation for Wael, not a defect:** "Talking to MyNaavi" holds 13 of 23, which may be too broad to be useful as a filter, and "What is the MyNaavi Community?" was placed under *Alerts & reminders*, which is hard to defend. Categories are a browsing aid and a wrong one misleads nobody, but the bucket sizes are a product judgement only Wael can make.

### 4f. Browser verification — against staging, in a real browser

**Customer FAQ page**
```
23 of 23 answers rendered from the database
all 23 anchors present; the 12 the mobile app deep-links all resolve
/faq#privacy       → found, opened, scrolled into view
category dropdown  → All + the six, populated from the database
filter "Calls & briefings" → 4 answers
search "password"  → finds "What does MyNaavi remember?" via the AI's search terms,
                     though the word appears in neither the question nor the answer
search "zzzz"      → 0, with the contact-support fallback shown
background         → rgb(250,250,247); nav unchanged, FAQ still highlighted
```

⚠️ **A search defect found and fixed here:** `"PIN"` initially returned **5** answers because plain substring matching hits `ty`**`pin`**`g`. Changed to prefix-of-a-word matching. `"PIN"` now returns the 2 that genuinely mention it, and half-typed `"aler"` still finds all 12 alert answers.

**Website Report-a-problem form** — typed *"I want to add my daughter to my community but I cannot work out how"*, pressed Send:
```
panel shown  : true
heading      : "Before we send this — does one of these answer it?"
match        : "How do I add someone to my MyNaavi Community? →"
link         : https://mynaavi.com/faq#community-add
```
That phrase scores **zero** under keyword matching, and the website has no matching at all today.

**Second Send must still submit.** Pressed again: the form submitted and reached `ingest-ticket`, which refused it with `origin_not_allowed` — the existing origin control, correct for a localhost test. **The FAQ check did not block it.** A customer is never trapped behind the suggestion.

---

## 5. Manual tests required

Nothing above can be exercised by hand yet, because the staff portal and the website both point at **production**, where none of this is deployed. Wael's testing therefore comes after a production deploy, and needs:

1. **Write a question in `staff.mynaavi.com/faq`** and confirm it appears on the FAQ page.
2. **Edit an existing answer's wording** and confirm its categories are recomputed.
3. **Open a ticket → "Make this an FAQ"** and confirm the editor pre-fills.
4. **Search the FAQ page** for something in his own words.
5. **Submit the website's Report form** describing a problem, and confirm the suggestion appears — then press Send again and confirm the ticket is actually filed.
6. **Confirm a known deep link still lands**, e.g. `mynaavi.com/faq#privacy`.

---

## 6. Rollback instructions

**Nothing is live, so rollback today is `git checkout`.** After deployment:

**Website** — `git revert` the commit and push. Vercel redeploys the previous `faq.html`, `report.html` and `contact.html`. The old page is fully self-contained: its 23 answers are in the file, so it works with the database gone.

**Staff portal** — `git revert` and push. Removing the tile and the `/faq` rewrite makes the page unreachable; nothing else in the portal depends on it.

**Edge Functions** — redeploy the previous version, or `npx supabase functions delete get-faq|manage-faq|match-faq`. Nothing existing calls them, so deleting them breaks nothing that predates F25.

**Database** — the four tables are additive and no existing table was altered. Dropping them is safe, but **not while a deployed page still reads them**: revert the website first, then the functions, then the tables.

**`check-staff` was not modified**, so nothing about the portal's existing authentication needs rolling back.

---

## 7. Known risks

| Risk | State |
|---|---|
| **The website has no staging environment.** Its pages go live on push and point at production. | Build order holds them until the functions exist in production. Unchanged from Phase 2. |
| ~~**Search-engine indexing of the answers.**~~ **CLOSED by §10.** The old page carried all 23 answers as static HTML; the new one fetches them. Crawlers that do not run JavaScript will no longer see the answer text. | ⚠️ **DECIDED 2026-09-02 — regression not accepted.** Found in Phase 4, covered by no earlier phase. Wael had ruled the hidden JSON-LD block immaterial, but that was about the block, not the answers. Closed by the scope addition in §10. **The website must not be pushed until §10 is built.** |
| Unbounded spend on a public AI endpoint | Bounded by input validation, cache and per-IP rate limit. The limiter fired against my own test runs, which is the control working. Test runs need a documented reset step — now in the test file. |
| Classifier outage | Fail-open, tested. 0 of 23 needed it in practice. |
| Matcher non-determinism | 5 cases × 3 trials, zero variation observed. Bounded further by selecting from a supplied slug list and discarding anything unknown. |
| `check-staff` gains a fifth consumer | Not modified, so no direct regression expected — **integration still to be tested in Phase 7**, per the Phase 3 correction. |
| Category quality | See §4e. A product judgement, not a defect. |

---

## 8. Defects found in this work, by me, during Phase 4

Recorded because each was a real failure that the plan did not anticipate, and three of them printed a healthy-looking result while being wrong.

1. **The JSON parser was wrong in both AI functions.** Haiku answers with fenced JSON *followed by prose*; stripping a fence from each end left unparseable text, so `match-faq` returned **`unavailable`** — the one status the contract reserves for "nothing was checked" — precisely on off-topic input where `no_match` is correct. Fixed with the brace-walking extractor `naavi-chat` already uses. Caught by a control probe, not by the four required phrases.
2. **The allowed-tag list was asserted, not measured.** Phase 2 §7a named "the six tags the existing answers actually use". `<code>` appears **zero** times and `<span>` appears **ten**; five answers would have failed to migrate.
3. **Six tests skipped silently** while the suite printed green — module-scope `process.env` reads, before the runner loads `.env`.
4. **`faq.html` was corrupted once** by splicing with offsets computed before an earlier insertion shifted them. Caught immediately, restored from git, and the script now recomputes after every edit.

---

## 9. Not done, and deliberately

- **No mobile change.** `lib/faq.ts` untouched; the app's forms keep their 12 keyword entries and keep working. Scope set after the web build is tested (Wael, 2026-09-02).
- **No voice change.** No FAQ logic exists there.
- **No production deploy**, no commit, no push.
- **No Architecture Reference edit** — Phase 8, per the Reference-Document Read-Only Rule. The Outcome 3 finding stands: the Reference is silent on the FAQ, the staff portal **and** the ticket system, and Wael approved that all three are covered at Phase 8.

---

## 10. Crawlable answers — BUILT AND VERIFIED

**Approved by Wael, 2026-09-02**, after the Phase 5 hold. Phase 2 §7b and Phase 3 Part C2 were amended first, then this was built.

### What it does

When a staffer saves, `manage-faq` pings a **Vercel deploy hook**. Vercel runs `build-faq.js`, which reads `get-faq` and writes the answers into `faq.html` **as real HTML** between two generator markers. The page still fetches live data for humans, so an edit is visible immediately; the file always holds the current text for crawlers.

**The static text is generated output, never authored.** Nobody edits it, so it cannot carry a sync obligation and be forgotten.

### Why not the cheap version

Leaving the answers baked in and letting JavaScript overwrite them looks identical to a crawler on day one, and diverges the first time a staffer edits an answer, because nothing regenerates it. **That is a copy with a sync obligation and nothing enforcing it — the mechanism that left `lib/faq.ts` eleven questions behind.** Rejected on the record.

### Files — three, as approved

| File | Repo | Change |
|---|---|---|
| `build-faq.js` | mynaavi-website | new — reads `get-faq`, writes the answers into `faq.html` |
| `vercel.json` | mynaavi-website | `buildCommand` was `""`; now runs the generator |
| `supabase/functions/manage-faq/index.ts` | naavi-app | ping the deploy hook after create / update / deactivate / reactivate |

New Supabase secret required before production: **`VERCEL_DEPLOY_HOOK_URL`**.

### Evidence

**Generation, against staging:**
```
[build-faq] wrote 23 answers into faq.html
[build-faq] word-for-word check: 23/23 identical
```

**What a crawler with no JavaScript now sees:**
```
answers in static HTML : 23/23
visible words          : 2789
contains a real answer : true   (the assistant description)
contains the PIN answer: true   (six-digit, i.e. the corrected copy)
tag integrity          : details ok · div ok · style ok · section ok
```

**Live page, in a browser against staging:** 23 rendered from the database, status "23 answers", search for "PIN" still narrows to 2, controls visible, `#privacy` resolves.

**Failure path — the point of the whole exercise.** Against a deliberately unreachable endpoint:
```
answers still visible : 23
first question        : "What is MyNaavi?"
anchors intact        : true
controls hidden       : true   (they cannot work without the data)
error message shown   : false
```
**This is strictly better than before §10**, where a failed fetch replaced the page with an error and showed nothing.

**Fail-open on the hook, verified live** with `VERCEL_DEPLOY_HOOK_URL` unset:
```
HTTP 200 {"ok":true,"slug":"does-a-save-survive-a-missing-deploy-hook","needs_classification":false}
```
A missing or broken hook cannot cost a staffer the answer they wrote.

**Four tests added**, bringing the suite to 17/17: answers present in static HTML · the block is output not a source · a failed fetch keeps the answers · the hook cannot block a save.

### Risk this introduces, still open

⚠️ **A deploy hook that silently stops firing leaves the crawler copy stale.** Humans are unaffected — the page fetches live — but it is the same shape as the `lib/faq.ts` drift that motivated F25, and `pingDeployHook` currently only writes a log line nobody reads. **Phase 6 must settle how this gets noticed.** Recorded here rather than discovered later.

### Correction recorded

My first recommendation was to check `/faq` search traffic and treat negligible traffic as grounds to accept the regression. **Wael rejected the reasoning: the traffic is zero because there are no real users yet.** Today's analytics measure the absence of a user base, not the value of search to the users the FAQ is being built for.
