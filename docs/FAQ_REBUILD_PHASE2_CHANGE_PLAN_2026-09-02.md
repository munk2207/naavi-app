# FAQ Rebuild — Phase 2: Change Planning

**Date:** 2026-09-02
**Item:** F25 (proposed — row awaiting Wael's approval per Rule 1b)
**Phases 0, 1, 1A:** all approved by Wael, 2026-09-02
**Architecture Reference:** `2026.09.01.16` (per Phase 1A)
**Governance:** v4.3, Phase 2. No code written.

**Wael's Phase 1A decisions, carried into this plan:**
- **Ownership change approved** — Duplicated → Shared Core (§4 Ownership Change Rule)
- **Read mechanism: option B** — a read-only Edge Function, not an RLS public-read policy
- **Phase 8 Reference reconciliation covers the FAQ, the staff portal and the ticket system**

---

## 1. Files that will change

| # | File | Repo | Class | Change |
|---|---|---|---|---|
| 1 | `supabase/migrations/20260902_faq_items.sql` | naavi-app | **Database** | new — `faq_items`, `faq_categories`, constraints, RLS |
| 2 | `supabase/functions/manage-faq/index.ts` | naavi-app | **Backend** | new — staff write path + classification |
| 3 | `supabase/functions/get-faq/index.ts` | naavi-app | **Backend** | new — unauthenticated read of published answers |
| 4 | `supabase/functions/match-faq/index.ts` | naavi-app | **Backend** | new — the shared matcher |
| 5 | `scripts/migrate-faq-to-db.js` | naavi-app | **Backend** | new — one-time migration of the 23 existing Q&A |
| 6 | `tests/catalogue/faq.ts` | naavi-app | **Tests** | new — Rule 15a coverage |
| 7 | `tests/runner.ts` | naavi-app | **Tests** | modified — register the suite |
| 8 | `faq.html` | naavi-staff | **UI** | new — authoring page |
| 9 | `index.html` | naavi-staff | **UI** | modified — add the FAQ tile |
| 10 | `support.html` | naavi-staff | **UI** | modified — "Create an FAQ from this ticket" |
| 11 | `vercel.json` | naavi-staff | **Configuration** | modified — `/faq` rewrite |
| 12 | `faq.html` | mynaavi-website | **UI** | rewritten — reads `get-faq`, live filter, category dropdown |
| 13 | `report.html` | mynaavi-website | **UI** | modified — call `match-faq` on Send |
| 14 | `contact.html` | mynaavi-website | **UI** | modified — call `match-faq` on Send |

**No dependency changes.** No `package.json` in any repo is modified.

### Why each

**1 — schema.** `faq_items`: `slug` (unique — the logical key, preserving the 23 existing anchors), `question`, `answer_html`, `categories text[]`, `search_terms text[]`, `content_hash`, `active`, timestamps. `faq_categories`: `name`, `sort`, `active` — categories as data, so adding one is not a code change. Per CLAUDE.md DATA INTEGRITY: UNIQUE on the logical key, NOT NULL on every column the logic depends on, and RLS denying all client access so both read and write flow through one entry point each.

**2 — `manage-faq`.** Staff-only. Ops: `list`, `get`, `create`, `update`, `deactivate`, plus category `list` / `create`. Authenticates by the `check-staff` pattern. On `create`, and on `update` where `content_hash` changes, calls Claude Haiku to assign categories from `faq_categories` and draft search terms. **Never invents a category** — it selects from the existing list.

**3 — `get-faq`.** No authentication. Returns published fields only — `slug`, `question`, `answer_html`, `categories`, `search_terms` — for `active` rows, plus the category list. Explicitly does **not** return `content_hash`, drafts, or timestamps. This is option B: what is public is stated in code, so adding a column later cannot silently publish it.

**4 — `match-faq`.** No authentication. Takes the customer's text; returns matching published answers, or an empty list. **Selects from published answers only; never composes.** Response shape is the contract Phase 0 names as expensive to get wrong — see §5.

**5 — migration script.** Reads the 23 `<details>` blocks from the current `faq.html`, preserves each `id` as the `slug`, inserts rows, and prints a before/after text comparison per question. Run once, by hand, against staging then production.

**6, 7 — tests.** Rule 15a. Includes the four measured phrases as regression cases.

**8-11 — staff portal.** New authoring page; a tile on the portal home; a button on a ticket that pre-fills the form from the ticket's question and the reply that was sent; a rewrite so `/faq` resolves like `/support` and `/admin` already do.

**12-14 — website.** The FAQ page fetches from `get-faq` and filters locally as the customer types, with a category dropdown. The two support forms call `match-faq` on Send and show matches before filing.

---

## 2. Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **No** | No file under `app/` or `lib/` changes. `lib/faq.ts` is untouched and its 12 keyword entries keep working. **This is a deferral, not an absence of need** — Phase 1 records 11 questions the app cannot suggest. Wael's decision, 2026-09-02: mobile scope is set after the web build is tested. |
| **Voice** | **No** | Freshly verified in Phase 1A: no FAQ logic exists in `naavi-voice-server` on either branch. There is no second implementation to change and none to justify omitting. |
| **Shared Core** | **Yes** | Three new Edge Functions. This is the new capability whose Duplicated → Shared Core ownership change Wael approved at Phase 1A. **No existing Shared Core code is modified** — `check-staff` is reused unchanged. |
| **Database** | **Yes** | Two new tables, their constraints and RLS. No existing table is altered. |
| **Cron** | **No** | No scheduled job is created or changed. The hourly refresh Wael asked for is an HTTP cache lifetime on `get-faq`, not a cron. Confirmed against CLAUDE.md's "one cron job per purpose" check: nothing is being added, so nothing can duplicate. |
| **API contracts** | **Yes** | Three new contracts. `match-faq`'s is the one that must survive later mobile reuse without an API redesign. |
| **Tests** | **Yes** | New `tests/catalogue/faq.ts`, registered in `tests/runner.ts`. |

**Duplicated-capability statement.** The capability is Duplicated today (Phase 1A). **Only one side changes in this stage.** The website side moves onto the shared record; the mobile side (`lib/faq.ts`) does not. **Why:** Wael's explicit staging decision, recorded above. The consequence is stated rather than hidden — until the mobile stage, the app's forms continue to know 12 of the questions, and the duplication is reduced from three copies to two, not to one.

---

## 3. Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** **It adds to Shared Core; it modifies no existing Shared Core code.** Three new functions. `check-staff` is called, not changed.
- **Does this change modify an Entry Point?** **Yes** — three website pages and three staff-portal pages. Each translates only: they collect input, call a function, and render what returns. **No matching logic lives in a page.**
- **Does this change introduce new duplication?** **No — with one thing named explicitly so a reviewer can judge it rather than discover it.** The FAQ page filters its already-loaded list locally as the customer types. That is not a second matcher: it narrows a visible list by substring, over content already fetched, with no server call. `match-faq` interprets a described problem. Different jobs, different inputs, no shared logic to keep in step. **If a reviewer disagrees, the alternative is to route the FAQ page's own box through `match-faq` too, at the cost of a network call per keystroke — which Wael rejected on 2026-09-02.**
- **Does this change eliminate existing duplication?** **Yes, partially.** Three copies become two: the website page and its hidden search-engine block are both generated from one record. `lib/faq.ts` remains a separate copy until the mobile stage.
- **Does this change modify Protected Core?** **Yes — three of the twelve areas:** Database schema (new tables), API contracts (three new), and Permissions (the unauthenticated-read boundary). Authentication itself is **not** modified — `check-staff` is reused as-is.

---

## 4. Regression Impact

**Fixed checklist — every row answered explicitly.**

| Function | Affected? | Basis |
|---|---|---|
| Voice commands | **No** | No file in `naavi-voice-server` changes; no FAQ logic exists there |
| Geofencing | **No** | No change to `useGeofencing.ts`, `report-location-event`, or `action_rules` |
| Gmail integration | **No** | No change to `sync-gmail`, `extract-email-actions`, or `harvest-attachment` |
| Calendar integration | **No** | No change to calendar functions or `lib/calendar.ts` |
| Reminders | **No** | No change to `check-reminders` or the `reminders` table |
| SMS / call alerts | **No** | No change to `send-sms`, `evaluate-rules`, or channel fan-out |
| Onboarding | **No** | `discover/start.html` is not among the changed files. It links to `/faq` in navigation only, and that URL is unchanged |
| Staging build | **No** | No mobile code changes, so no APK or AAB is produced by this work |

**Regression Matrix — consumer trace, produced by searching, not recalled.**

**`check-staff`** — reused unmodified. Consumers found by search across all four repositories:
- `naavi-staff/index.html` — the portal's front-door gate
- `naavi-staff/support.html` — ticket management
- `naavi-staff/admin.html` — staffer management
- `supabase/functions/add-staffer/index.ts` — its header records that it verifies caller identity with the same logic inline

**No direct regression is expected because `check-staff` is not modified; integration must still be tested.** The new `manage-faq` becomes a **fifth** consumer, and adding a consumer is a change to the function's operating conditions even when its code is untouched — call volume, token handling under a new caller, and error behaviour when the new caller passes something the existing four never sent. Phase 7 must exercise the existing consumers, not only the new one.

> **Corrected 2026-09-02, Phase 3 review.** The original read: *"Because `check-staff` is not modified, none of these four can regress."* That inferred a runtime guarantee from a static fact. An unmodified function can still regress its consumers through load, configuration or integration effects — the file being untouched is evidence about the diff, not about behaviour.

**`mynaavi.com/faq` and its anchors** — the page being rewritten. Consumers found by search:
- `app/help.tsx:21` — `FAQ_URL`; opens the page. **Must keep working: the URL is unchanged.**
- `lib/faq.ts:126` — `FAQ_BASE_URL`, used by `faqUrl()` to build `#<slug>` deep links for 12 questions. **All 23 slugs must survive; this is the hard constraint.**
- `app/contact.tsx:181`, `app/report.tsx:201` — open those deep links
- `mynaavi-website/shared.js` — **three references**: the FAQ nav button (twice, desktop and mobile nav) and `activeIf(['/faq'])` for active-state highlighting. **The rewritten page must keep whatever `shared.js` needs for the nav to highlight correctly.**
- `mynaavi-website/sitemap.xml` — lists `/faq`
- `faq.html` itself — `canonical` and `og:url`

**`support_staff` table** — read by `check-staff`; unchanged.

**No consumer was found that is not listed above.**

---

## 5. The `match-faq` contract

Named separately because Phase 0 identifies it as the one decision expensive to get wrong, and Phase 1A's ownership approval rests on it being reusable.

**Request:** the customer's text, plus an optional surface label so later analysis can tell web from app.

**Response:** an ordered list of matches, each carrying `slug`, `question`, `url`, and a confidence indicator; plus a flag distinguishing *"no match"* from *"the matcher could not run."*

**Three properties that must hold, because changing any of them later would be an API redesign:**
1. **A list, never a single answer** — so a future surface can show one, two, or five.
2. **An empty list is a valid, meaningful response** — "nothing matched" is an answer, not a failure.
3. **"Could not run" is distinguishable from "no match"** — a page must be able to stay silent on an outage rather than tell a customer nothing matched when nothing was checked.

**What it must never return:** generated text. It returns pointers to published answers.

---

## 6. Risk classification

**Overall: Medium.**

| Risk | Level | Mitigation |
|---|---|---|
| The 23 answers altered during migration | **Medium** | Migration script prints a before/after comparison per question; Phase 5 evidence shows it rather than asserts it |
| An anchor lost, breaking the app's 12 deep links | **Medium** | All 23 verified live before the old page is retired |
| Website pages live on push with no staging environment | **Medium** | Pages are not pushed until the functions they call exist in the environment those pages point at |
| `match-faq` contract wrong | **Medium** | §5 states the three properties explicitly for Phase 3 to challenge before coding |
| New tables and functions | **Low** | Purely additive; nothing existing reads them |
| `check-staff` reuse | **Low** | Not modified, so no direct regression is expected — but it gains a fifth consumer, so integration is tested in Phase 7 rather than assumed |
| Classification quality | **Low** | A wrong category is a browsing annoyance, not a false statement to a customer. Wael's ruling, 2026-09-02 |
| Unbounded spend on a public AI endpoint | **Medium** | Found at Phase 3 (A1). Bounded by input validation, result caching and per-IP rate limiting — §7a |
| A classifier outage costing a staffer their work | **Medium** | Found at Phase 3 (A2). Save always succeeds; unclassified rows stay published and searchable — §7a |
| Matcher returning different results on identical input | **Medium** | Non-determinism is inherent (governance Phase 3 rule). Bounded by selecting from a supplied slug list, validating every returned slug, and 3-trial reporting — §7a |

---

## 7. Build and deploy order

1. Migration + three functions → **staging** (`xugvnfudofuskxoknhve`)
2. Migration script run against staging; before/after comparison produced
3. Staff portal FAQ page → staging-facing verification
4. Tests written and green
5. **Stop. Wael approves production.** Then functions + migration → production
6. Only then: website pages pushed, since they point at production and go live on push

**No production deploy without Wael's explicit instruction** (CLAUDE.md staging-first, rule 7).

---

## 7a. Amendments mandated by Phase 3 (2026-09-02)

Phase 3 returned **Approved with Mandatory Changes**. All six findings are resolved here. **No new files** — every change lands in files already listed in §1.

### A1 — bounding cost on a public AI endpoint · **c + e + b approved; d explicitly rejected**

`match-faq` is unauthenticated and bills the Anthropic key on every call. Three controls, all inside `match-faq` and the existing migration:

- **(c) Input validation before any AI call.** Reject empty input, input under a minimum length, and input over a maximum (proposed 2,000 characters). No model call is made for input that fails this.
- **(e) Cache by normalised input.** Store the result against a hash of the lower-cased, whitespace-collapsed text. A repeated identical request — a real one or a probe — is served from the cache and costs nothing.
- **(b) Rate limit by IP.** A counter per IP hash per window, checked before the AI call.

**Storage for (e) and (b) is added to the existing migration file (§1 item 1)** — `faq_match_cache` and `faq_rate_limit` — so the file count stays at 14.

**Option (d) — run the keyword filter first and call AI only on a miss — is rejected.** It would reverse the AI-every-submission behaviour Wael approved on 2026-09-02. Recorded so it is not reintroduced as an optimisation later.

### A2 — classifier failure · **fail-open approved**

`faq_items` gains a `needs_classification` boolean.

- **The save always succeeds.** A classifier outage never costs a staffer the answer they just wrote.
- On classification failure the row is stored with empty categories and `needs_classification = true`.
- **Unclassified rows are published and searchable** — they appear under "All" and in text search. An outage degrades findability, never availability.
- `manage-faq` retries classification on the next edit; the staff page lists rows needing it, with a "classify now" action.

### A3 — Non-Determinism Rule · **3 independent trials, all reported**

`tests/catalogue/faq.ts` runs **each of the four required phrases 3 times** and reports the **full distribution**, not a pass/fail.

- Phase 0 Completion Criterion 3 is read as **"3 of 3 trials return the required result."**
- **A phrase returning 2 of 3 is a finding, not a re-run.** Selective reruns until green are the fake-test pattern and are prohibited here explicitly.
- `match-faq` constrains the model to selecting from a supplied list of slugs, and **validates every returned slug against the known set, discarding anything not in it** — so an invented answer is structurally impossible, not merely instructed against.

### A4 — `get-faq` discipline · **accepted as a constraint**

`get-faq` holds service-role privileges against a table clients cannot read. Therefore: **no caller-controlled filtering of any kind** — no arbitrary select, no caller-supplied predicate, no "include inactive" parameter. The response shape is fixed in code: `slug`, `question`, `answer_html`, `categories`, `search_terms` for `active` rows, plus the category list. Nothing else.

### A5 — payload threshold · **recorded, no redesign**

Local filtering is retained. **If `get-faq`'s payload exceeds roughly 250 KB, the page must move to server-side search.** Recorded so a future session recognises the moment rather than rediscovering it as a slow page.

### A6 — stored answer HTML · **restricted at write time**

`manage-faq` accepts only the tag set the existing 23 answers actually use — `<p>`, `<strong>`, `<em>`, `<br>`, `<code>`, `<a>` — and rejects anything else on write. Narrow by construction rather than by trusting the author.

---

## 7b. Scope addition — crawlable answers (Phase 5 HOLD, 2026-09-02)

**Approved by Wael, 2026-09-02**, after Phase 5's review held on a regression no earlier phase covered: the dynamic page removes the answer text from static HTML, so crawlers that do not execute JavaScript no longer read it. The old page carried all 23 answers as static HTML.

**Decision: the regression is not accepted.** Crawlable answers are preserved and the database remains the single source of record.

### What is added

`manage-faq` pings a **Vercel deploy hook** after a successful write. Vercel runs a generator that reads `get-faq` and writes the 23 answers into `faq.html` **as real HTML**, inside the container the page's own script already fills. The page still fetches live data for humans; the file always holds the current text for crawlers.

**The static text is generated output, never authored.** Nobody edits it, so it cannot be "kept in sync" and forgotten.

### Files — three more, bringing the total to 17

| # | File | Repo | Class | Change |
|---|---|---|---|---|
| 15 | `build-faq.js` | mynaavi-website | **Backend** | new — reads `get-faq`, injects the answers into `faq.html` at build time |
| 16 | `vercel.json` | mynaavi-website | **Configuration** | modified — `buildCommand` is `""` today and must run the generator |
| 17 | `supabase/functions/manage-faq/index.ts` | naavi-app | **Backend** | modified — ping the deploy hook after a successful write (already file #2; this is an additional change to it) |

New Supabase secret: `VERCEL_DEPLOY_HOOK_URL`.

### Change Impact Matrix — delta only

| Layer | Affected? | Details |
|---|---|---|
| Mobile | **No** | unchanged |
| Voice | **No** | unchanged |
| Shared Core | **Yes** | `manage-faq` gains an outbound call. No new function. |
| Database | **No** | no schema change; the generator only reads |
| Cron | **No** | still no scheduled job — the trigger is a save, not a clock |
| API contracts | **No** | no contract changes; `get-faq` is consumed as-is |
| Tests | **Yes** | the generator's output must be proven word-for-word identical, same method as §4c of the evidence |

### Why the cheaper option is rejected

Leaving the 23 answers baked into `faq.html` and letting JavaScript overwrite them looks identical to a crawler on day one. It differs the day a staffer edits an answer: the baked copy still holds the old text and nothing updates it. **That is a copy carrying a sync obligation with nothing enforcing it — the exact mechanism that left `lib/faq.ts` eleven questions behind.** Rejected on the record so it is not revisited as a shortcut.

### Regression impact — delta only

- **`manage-faq`'s existing callers.** The hook ping must be fire-and-forget: a failed or slow hook must never fail a staffer's save. This is the same fail-open principle as A2, applied to a different dependency.
- **The FAQ page's failure behaviour improves.** Today a failed fetch shows an error message; with generated content in the file, a failed fetch leaves the last-generated answers visible. Better degradation, not worse.
- **No other consumer is touched.** `get-faq` gains a build-time reader; its contract is unchanged.

### New risk this introduces

⚠️ **A hook that silently stops firing leaves the static copy stale** — the same disease in smaller form. Humans still see current content because the page fetches live; only crawlers see stale. **Phase 6 must require a way to notice**, or this trades one silent staleness for another.

---

## 8. Not in this plan

- Any mobile change; no AAB
- Any voice change
- Cron jobs
- Holding-list row creation — pending Wael's approval of the F25 row text
- Architecture Reference edits — Phase 8, per the Reference-Document Read-Only Rule
