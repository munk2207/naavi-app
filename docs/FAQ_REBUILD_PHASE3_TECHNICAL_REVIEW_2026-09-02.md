# FAQ Rebuild — Phase 3: Technical Review (Before Coding)

**Date:** 2026-09-02
**Item:** F25
**Risk:** Medium (Phase 2 §6) — Phase 3 review is therefore mandatory
**Phases 0, 1, 1A, 2:** approved by Wael. Phase 2 approved with 1 correction, applied.
**Architecture Reference:** `2026.09.01.16`
**Governance:** v4.3, Phase 3. No code written.

This document is Claude's technical self-review of its own Phase 2 plan, prepared for external review. **It is not an approval.** Six findings follow; three are gaps the plan does not currently handle, and one of those is a live cost-exposure issue.

---

## Part A — Findings

### A1 — ⚠️ `match-faq` is unauthenticated and spends money on every call

**Severity: highest finding in this review. The plan does not address it.**

Phase 2 specifies `match-faq` as a public endpoint that calls Claude on each request. **Anyone who finds the URL can call it in a loop**, and each call bills the `ANTHROPIC_API_KEY`. Nothing in the plan bounds this.

"Matching runs on Send, not per keystroke" bounds cost for *customers using the form*. It bounds nothing for anyone calling the endpoint directly.

**Options, for the reviewer to choose between:**

| | Approach | Assessment |
|---|---|---|
| a | Require the Supabase anon key | Trivially extractable from page source. Raises the floor slightly; not a control. |
| b | Rate-limit by IP in the function | Real, but needs a store for counters, which the plan has no table for. |
| c | Cap input length and reject empty/garbage before any AI call | Cheap, necessary regardless, insufficient alone. |
| d | Run the free keyword filter first; call AI only when it finds nothing | Bounds cost **and** latency for the common case. **But partially reverses Wael's 2026-09-02 simplification** ("one call per submission, so the AI can simply run every time"). |
| e | Cache by normalised input text | Repeated identical probes cost once. Helps abuse and real traffic both. |

**Claude's recommendation: c + e + b**, keeping Wael's "AI every time" behaviour for genuine submissions while bounding the abuse case. **d is deliberately not recommended** — it reintroduces the hybrid Wael removed, and should only return if the reviewer judges b infeasible.

**This needs Wael's decision, not just the reviewer's**, because option d would alter a behaviour he chose explicitly.

### A2 — ⚠️ Classification failure has no defined behaviour

The plan says `manage-faq` classifies on save. **It does not say what happens when that call fails** — Anthropic down, timeout, rate limit.

Two bad outcomes are available by accident:
- **The save fails** → a staffer loses an answer they just wrote, because a third-party API was unavailable. Unacceptable.
- **The save succeeds with no categories, to be fixed "later"** → there is no cron and no retry, so *later never comes*, and the item is silently missing from every category filter.

**Required behaviour, proposed:** the save always succeeds. Classification is attempted; on failure the row is stored with empty categories and a `needs_classification` flag. Un-classified rows are **still published and still searchable** — they appear under "All" and in text search — so a classifier outage degrades findability, never availability. `manage-faq` retries on the next edit, and the staff page shows which rows need it with a "classify now" action.

**This is a gap in Phase 2, not a refinement.** Phase 2 must be amended before Phase 4.

### A3 — ⚠️ The Non-Determinism Rule applies, and Phase 2's test plan does not satisfy it

Governance Phase 3's Non-Determinism Rule: any Claude/Haiku classifier change must be validated with **a minimum of 3 independent trials per positive-control case**, with Phase 5 reporting the **full distribution**, not a pass/fail.

**Both new AI paths are classifiers** — `manage-faq`'s category assignment and `match-faq`'s matching. Phase 2's Success Criteria lists the four measured phrases as single expected results. **That is single-trial validation and does not comply.**

**Required:** each of the four phrases run **at least 3 times**, distribution reported. Phase 0's Completion Criterion 3 must be read as "3 of 3 trials return the required result," and if a phrase returns 2 of 3, that is a finding — not a pass to be re-run until green, which is the fake-test pattern.

**Design consequence:** `match-faq` should constrain the model to selecting from a supplied list of slugs rather than generating free text, and **validate every returned slug against the known set, discarding anything not in it.** This bounds non-determinism to *which* published answer is chosen, and makes an invented answer structurally impossible rather than merely instructed against.

### A4 — `get-faq` uses service-role against a table clients cannot read

Option B means `faq_items` denies client access and `get-faq` reads it with service-role privileges. **A public endpoint holding service-role credentials must not accept caller-controlled filtering** — no arbitrary `select`, no caller-supplied `where`, no "include inactive" parameter. The response shape must be fixed in code.

**Not a flaw in the choice of option B** — it is the specific discipline option B requires, and it should be stated in Phase 2 rather than left to implementation instinct.

### A5 — Payload growth is unbounded by the design

`get-faq` returns every published answer so the page can filter locally. At 23 questions this is small. **The whole point of this item is that the list grows.** At several hundred, every page load ships the entire FAQ.

**Not a reason to change the design now** — local filtering is what makes search instant and free, and caching absorbs repeat visits. **But a threshold should be recorded** so a future session recognises the moment rather than rediscovering it: if `get-faq`'s payload exceeds roughly 250 KB, the page should move to server-side search. Recording it costs nothing; discovering it costs a slow page.

### A6 — Staff-authored HTML is rendered into a public page

`answer_html` holds formatted text written by staff and rendered on `faq.html`. Staff are trusted, so this is not an injection threat in the usual sense — but **an authoring page that round-trips arbitrary HTML into a public page is a wide surface for an accident**, and the current `faq.html` answers contain only `<p>`, `<strong>`, `<em>`, `<br>`, `<code>` and `<a>`.

**Proposed:** restrict stored answers to that tag set, rejecting anything else at write time in `manage-faq`. Narrow by construction rather than by trust.

---

## Part B — The five Mandatory Review Gates (§13)

**Gate 1 — Scope Compliance.** **PASS.** Every file in Phase 2 §1 serves a Phase 0 in-scope item. No mobile file, no voice file, no cron. A2's and A6's remedies are inside scope. **A1 option d would touch scope**, because it reverses a behaviour Wael chose — flagged, not assumed.

**Gate 2 — Governance Compliance.** **CONDITIONAL FAIL, self-reported.** The Non-Determinism Rule (A3) is not satisfied by Phase 2's test plan. This is a governance non-compliance in the plan as written, and it is reported here rather than discovered at Phase 6. Remedied by amending the test plan before Phase 4.

**Gate 3 — Architecture Compliance.** **PASS.** No existing Shared Core code is modified; `check-staff` is called, not changed. The Duplicated → Shared Core ownership change carries Wael's separate §4 approval. Cross-Repository Verification completed at Phase 1A with provenance tags on every bullet. The Outcome 3 drift finding is recorded and deferred to Phase 8 per v4.3.

**Gate 4 — Technical Correctness.** **FAIL as written.** A1 (unbounded cost on a public AI endpoint) and A2 (undefined classifier-failure behaviour) are defects in the plan, not in future code. Both must be resolved before Phase 4.

**Gate 5 — Evidence Sufficiency.** **Not yet reachable.** Depends on the amended test plan from A3.

**Overall recommendation: APPROVED WITH MANDATORY CHANGES** — A1, A2 and A3 resolved and Phase 2 amended; A4, A5 and A6 folded into the plan as written constraints.

---

## Part C — Implementation Boundaries

**No implementation is authorized by this document.** When authorization is given, it covers exactly the 14 files in Phase 2 §1 and the change described for each. Specifically:

- **No additional files** beyond those 14.
- **No opportunistic refactoring** — in particular, `faq.html`'s existing answer text is *moved*, never edited, and `shared.js` is not touched.
- **No architectural changes** beyond the approved Duplicated → Shared Core move.
- **Explicitly excluded from any authorization:** every file under `app/` and `lib/`, including `lib/faq.ts`; the voice server; the Architecture Reference (Phase 8, per the Reference-Document Read-Only Rule); and production deployment of anything.

---

## Part C2 — Implementation Boundaries, revised for the Phase 5 scope addition

**Added 2026-09-02**, after Phase 5 held on the search-indexing regression and Wael approved preserving crawlable answers (Phase 2 §7b).

**The authorised set becomes 17 files, not 14.** Three are added:

- `mynaavi-website/build-faq.js` — **new.** Reads `get-faq` and injects the answers into `faq.html` at build time. **Read-only against the database. It must not write anything.**
- `mynaavi-website/vercel.json` — **modified.** `buildCommand` only. No rewrites, redirects or headers are touched.
- `supabase/functions/manage-faq/index.ts` — **modified again.** One addition: a fire-and-forget ping to `VERCEL_DEPLOY_HOOK_URL` after a successful write. **Nothing else in that file may change.**

**Still explicitly excluded, unchanged:** everything under `app/` and `lib/`; the voice server; `shared.js`; the Architecture Reference; production deployment.

**Two constraints on the generator, because getting either wrong recreates the defect this item removes:**

1. **The generated text must be word-for-word identical to the database.** Proven by the same before/after comparison used for the migration, not asserted.
2. **The generated block must be output, never a source.** Nothing may edit it by hand, and the page's own script must overwrite it from live data on load — so the file is a crawler's copy and never a second place answers live.

**One new technical finding, raised here rather than discovered later:** a deploy hook that silently stops firing leaves the static copy stale, which is the same class of failure as the `lib/faq.ts` drift that motivated F25 — smaller, because only crawlers see it, but the same shape. **Phase 6 must require a way to notice it.** A generated page that quietly stops regenerating is exactly the "knowledge recorded with nothing enforcing it" pattern this project keeps paying for.

---

## Part D — Deferred Architectural Decisions

**D1 — Routing the FAQ page's own search box through `match-faq`.** Not approved. It would mean a paid network call per keystroke, which Wael rejected on 2026-09-02. Reconsider only if the local filter proves inadequate in real use — measured, not assumed.

**D2 — A shared matching module used by Naavi herself, in chat and on calls.** Not approved, and not in Phase 0's scope. The same matcher could one day answer "is this already in the FAQ?" inside a conversation. Reconsider once the web stage has real usage data.

**D3 — Generating `lib/faq.ts` from the database.** Not approved — the mobile scope is deliberately unset until the web build is tested (Wael, 2026-09-02). Reconsider at that decision point, alongside whether the app calls `match-faq` directly instead.

**D4 — Retiring the hidden search-engine block entirely.** Not approved, and not needed either way: it becomes generated output rather than hand-maintained content, so it stops being a maintenance cost without a decision being required. Wael's position, 2026-09-02: it does not affect function, so keeping or dropping it is immaterial.

---

## Part F — Review outcome, 2026-09-02

**APPROVE WITH MANDATORY CHANGES.** Decisions returned:

1. **A1 — approved c + e + b** (input validation, caching, per-IP rate limiting). **Option d rejected** — it reverses the previously approved AI-every-submission behaviour.
2. **A2 — approved** the proposed fail-open behaviour: save succeeds; classification failure is flagged and retryable.
3. **A3 — 3 independent trials per required phrase is sufficient for this phase.** All results reported; **no selective reruns.**
4. **A4 / A5 / A6 — accepted as implementation constraints.** No redesign required.

All six are amended into Phase 2 §7a. Gate 2 and Gate 4, which this document self-reported as failing, are resolved by that amendment.

---

## Part E — What the external reviewer is asked to decide

1. **A1** — which combination bounds cost on a public AI endpoint, and whether option d is ever acceptable given it reverses Wael's explicit choice.
2. **A2** — whether the proposed fail-open behaviour (save always succeeds; unclassified items remain published and searchable) is right.
3. **A3** — whether 3 trials is sufficient here, or whether a matcher facing free-text input needs more.
4. Whether A4, A5 and A6 are correctly assessed as constraints to record rather than defects to redesign.
