# FAQ Rebuild — Phase 6: Technical Review (After Coding)

**Date:** 2026-09-02
**Item:** F25
**Architecture Reference:** `2026.09.01.16` — re-confirmed current at the time of this review, per Phase 1A's Version Verification requirement. No newer revision has landed since Phase 1A.
**Governance:** v4.3, Phase 6.

Claude's self-review of its own implementation, prepared for external review. **Not an approval.** Three findings below are open and one of them is a live gap.

---

## 1. What is being reviewed

**17 files: 14 from Phase 2 §1, plus 3 from §7b's approved scope addition.** Nothing else.

```
naavi-app         migration + 3 Edge Functions + migration script + test catalogue
                  tests/runner.ts        +2 lines
                  HOLDING_LIST           +2 lines (F25 row, approved under Rule 1b)
naavi-staff       faq.html new; index.html +9; support.html +24; vercel.json +1
mynaavi-website   faq.html +503/−; report.html +72; contact.html +72; vercel.json +1
                  build-faq.js new
```

**Diff totals:** naavi-app 4 insertions to existing files, everything else new. mynaavi-website 340 insertions / 310 deletions. naavi-staff 35 insertions / 1 deletion.

**Isolation is strong.** Only **four lines** were added to pre-existing naavi-app code, and both files are tracking documents rather than logic. `check-staff` was not modified. No file under `app/`, `lib/`, or `naavi-voice-server/` was touched.

---

## 2. Architecture impact — named, not left to inference

Governance requires each of the following to be stated explicitly.

**Did it increase duplication?** **Yes, in two small places, and both are named here rather than left for the reviewer to find.**

- **`extractJson` exists twice** — in `match-faq` and `manage-faq` — and a third functionally equivalent copy already lived in `naavi-chat/index.ts:72`. I copied the approach rather than importing it. **Justification:** `naavi-chat`'s copy is embedded in a larger function with a different return contract, and extracting it into `_shared/` would have modified `naavi-chat` — a Protected Core file outside the approved boundary. **This is real duplication, accepted deliberately, and it should be a follow-up item rather than a silent cost.** See §6.
- **The support-form glue is duplicated** across `report.html` and `contact.html` (~45 lines each). Both were generated from one script so they are byte-identical today, but nothing keeps them so. **The matching logic itself is not duplicated** — it lives in `match-faq`; what repeats is which fields to read and how to render a panel.

**Did it reduce duplication?** **Yes, and by more than it added.** Three copies of the FAQ content became two: the page and its hidden search-engine block are now generated from one record. `lib/faq.ts` remains the second copy until the mobile stage, exactly as Phase 2 stated.

**Did it bypass Shared Core?** No. All FAQ reads and writes go through the three Edge Functions. No page talks to the database directly.

**Did it introduce another independent implementation?** No. `match-faq` is the single matcher. **The FAQ page's local search is not a second implementation of it** — it filters an already-fetched list by word prefix and makes no server call. Phase 2 §3 named this and stated the alternative and its cost; it remains the correct read.

**Did it violate entry-point responsibilities?** No. Every page collects input, calls a function, renders the result. **No page contains matching or classification logic.**

**Did it change an API contract?** No existing contract changed. Three new ones were created; `match-faq`'s carries the three properties Phase 2 §5 fixed in advance.

**Did it change a capability's ownership?** **Yes — Duplicated → Shared Core, approved by Wael separately under §4's Ownership Change Rule on 2026-09-02.** This makes the Phase 8 Architecture Reference update a hard merge precondition.

**Did it expand what counts as Protected Core?** **Yes, unavoidably.** Two new tables, three new API contracts, and a new unauthenticated-read boundary all fall inside existing Protected Core areas. This was declared at Phase 0 and is why the full process ran.

---

## 3. Architecture Drift Rule

**Two outcomes apply at once, and they are handled differently.**

**Outcome 2 — divergence from an intentional, approved change.** The Duplicated → Shared Core move is exactly this. **The Phase 8 Reference update is therefore a hard precondition for merge, not an optional follow-up.**

**Outcome 3 — the Reference was already stale before this work began.** It is silent on the FAQ, the staff portal and the ticket system. Recorded at Phase 1A, carried here unchanged. Under v4.3 implementation did not stop, and continuing was neither unsafe nor impossible to define because Phase 1A produced the missing map by direct investigation.

**What Phase 8 must add** — larger than F25 itself, and Wael approved that scope: the FAQ capability and its Shared Core classification; the **staff portal** (`munk2207/naavi-staff`, fourth repository, shipped as F6a in June and invisible to the Reference ever since); and the ticket system it hosts.

---

## 4. Invalidated planning assumptions

Recorded per the Invalidated Planning Assumption Rule — each is a **planning** error, not an implementation error or a scope cut, and each points at a different lesson.

**4a. The allowed-tag list was asserted rather than measured.** Phase 2 §7a named "the six tags the existing 23 answers actually use". Phase 4 measured: `p` 152, `strong` 88, `em` 34, `br` 24, `span` 10, `a` 2 — **`code` appears zero times and `span` was missing.** Five answers would have failed to migrate. *Why it didn't hold:* the claim was written from memory of what FAQ answers usually contain, and nothing in Phase 2 or Phase 3 required it to be checked against the file.

**4b. The Non-Determinism Rule and the result cache are in tension.** Phase 3 mandated 3 independent trials; Phase 3 also mandated caching by normalised input. **Together, three identical calls replay one answer three times and prove nothing.** Phase 4 found this while writing the test, which now clears the cache before each trial. *Why it didn't hold:* both requirements were correct in isolation and were never evaluated against each other.

**4c. Phase 0's Success Criterion for one phrase was wrong.** `"my alarm didn't go off this morning"` was required to find the morning-brief answer; it returned 0/3. Investigation showed **the expectation was wrong** — the two were paired on the word "morning", and the brief question is about the brief showing the wrong day. Corrected on Wael's ruling. *Why it didn't hold:* the criterion was written by word association rather than by reading the answer it named.

**4d. No phase before 5 considered search-engine indexing.** The dynamic page removed the answers from static HTML. Phase 0 did not mention it, Phase 1A did not surface it, Phase 3 did not catch it. Found at Phase 5, scope added under §7b and built. *Why it didn't hold:* every earlier phase reasoned about the customer in front of the page, and none about the crawler that finds it.

---

## 5. Regression risk

| Area | Assessment |
|---|---|
| **`check-staff`** | Not modified, so no direct regression is expected — **but it gains a fifth consumer, and integration is untested.** Phase 7 must exercise the portal home, `/support` and `/admin`, not only the new page. This is the correction the Phase 3 review required and it is still outstanding. |
| Existing Edge Functions | None modified. The three new ones are additive and nothing pre-existing calls them. |
| Existing tables | None altered. Four new tables; RLS denies every client role, verified. |
| Mobile | No file touched. `Help → Frequently asked` opens the website, so the app **inherits the rebuilt page with no release** — verified by reading `app/help.tsx:21,50`, not assumed. |
| Voice | No file touched; no FAQ logic exists there. |
| The 23 published addresses | All 23 anchors verified present and resolving, including the 12 the app deep-links. |
| Website support forms | The FAQ check cannot block a submission — verified by pressing Send twice; the second reached `ingest-ticket`. |
| **The website build step** | ⚠️ `buildCommand` was `""` and is now `node build-faq.js`. **Every future deploy of the entire site now depends on that script exiting 0.** It is written to exit 0 on any failure and leave the file untouched, but this is a new single point of failure for a site that previously had none. |

---

## 6. Test coverage

**17 tests, 17 passing, 0 skipped.** Five are live 3-trial cases against deployed staging functions; the rest are source and integration assertions.

**Gaps, disclosed rather than left implicit:**

1. **The staff portal page has no automated test.** `naavi-staff/faq.html` is a static page in a fourth repository the runner cannot reach. Its behaviour is unverified by anything except my own browser session — and **I have not exercised it at all**, because the portal points at production where none of this exists. **This is the largest coverage gap in the item.**
2. **The deploy hook is untested end to end.** `VERCEL_DEPLOY_HOOK_URL` does not exist yet. What is proven is that its absence cannot block a save; what is unproven is that its presence regenerates the page.
3. **`check-staff`'s four existing consumers are untested** since it gained a fifth. Phase 7.
4. **The three website pages** are verified by browser session and by source assertion, not by an executable test.

---

## 7. Four verdicts

**Technical Review: PASS.** The implementation matches the approved plan. Four defects were found during Phase 4 — all in my own code, all fixed, all now covered by regression tests: the JSON parser that reported `unavailable` where `no_match` was correct; the asserted tag list; six tests silently skipping behind a green summary; and one corrupted file caught and restored.

**Architecture Completeness: PASS, with the duplication in §2 named.** Duplication reduced on net. No Shared Core bypass, no second matcher, no entry point holding logic. The ownership change was separately approved.

**Governance Compliance: PASS.** Phases 0–5 all approved by Wael, with corrections applied and recorded rather than silently absorbed. Rule 1b honoured for the F25 row. Rule 15a satisfied. The Non-Determinism Rule satisfied with distributions reported. Staging-first held throughout — **nothing has been committed, pushed, or deployed to production.**

**Overall Recommendation: APPROVED WITH MANDATORY CHANGES.**

Three items, all narrow and listable:

1. ⚠️ **A deploy hook that stops firing must be noticeable.** Today `pingDeployHook` writes a log line nobody reads. If it silently stops, the crawler copy goes stale — the same shape as the `lib/faq.ts` drift that motivated this entire item, reproduced in the fix for it. **The item should not merge with that unaddressed.** Options: surface `updated_at` versus the generated page's build stamp on the staff page; or a `needs_regeneration` flag cleared by the build.
2. **`VERCEL_DEPLOY_HOOK_URL` must exist before the website is pushed**, or the crawler copy never regenerates and §10 delivers nothing.
3. **Phase 7 must exercise `check-staff`'s four existing consumers**, per the correction the Phase 3 review already required.

---

## 7a. Mandatory change #1 — CLOSED, 2026-09-02

**Requirement:** deploy-hook failure and staleness must be detectable before merge.

**Built:**

- **`build-faq.js` stamps the generated block** with the time it ran and how many answers it wrote: `<!-- F25:generated-at 2026-09-02T22:07:49.650Z count:23 -->`. Without a stamp there is no way to distinguish a fresh page from one whose hook stopped firing weeks ago.
- **`manage-faq` gains `publish_status`** — reads the live page **server-side** (the staff portal and the website are different origins and `mynaavi.com` sends no CORS headers, so a browser check would simply be blocked), extracts the stamp, and compares it against the newest `updated_at` among active answers. Returns `current` / `stale` / `unknown`, plus whether the hook is configured at all.
- **`manage-faq` gains `rebuild_now`** — a manual recovery path when the hook has failed.
- **The staff FAQ page shows a banner**, so this reaches the person who would care at the moment they would care. Three states, each saying something different and true: *the public page is not being rebuilt* (no hook), *the public page is behind* (with the last build time in EST and a Rebuild-now button), and *cannot tell whether the public page is up to date*.

**`unknown` is deliberately not reported as healthy.** A check that says "fine" when it could not look is the failure this change exists to prevent.

**Verified live against staging:**
```
state              : unknown
hook_configured    : false          <- the red banner case, correct today
page_reachable     : true           <- it did reach mynaavi.com/faq
page_generated_at  : null           <- the live page carries no stamp yet
last_content_change: 2026-09-02T17:23:34Z
rebuild_now        : HTTP 400 {"ok":false,"error":"hook_not_configured"}   <- refuses honestly
```

**Stamp parsing and the comparison, against the real generated file:**
```
matched: true · generated_at 2026-09-02T22:07:49.650Z · count 23
content changed 10 min after the build  -> stale
content changed  5 s  before the build  -> current
content changed 30 s  after the build   -> current   (one minute of slack)
```

**Three tests added — 20/20 passing.**

⚠️ **Disclosed gap:** the `stale` and `current` branches are proven by parsing the real stamp and exercising the comparison, **but not end-to-end**, because no deployed page carries a stamp yet. That closes when the website is deployed, and Phase 7 should confirm it there.

---

## 7b. Mandatory change #2 — CLOSED, 2026-09-02

`VERCEL_DEPLOY_HOOK_URL` must exist before the website is deployed, or the crawler copy never regenerates and §10 delivers nothing.

**Created by Wael in the Vercel dashboard and verified before configuring anything:**
```
POST https://api.vercel.com/v1/integrations/deploy/prj_.../...
HTTP 201  {"job":{"id":"VP1v5gX70qYWWK37aulc","state":"PENDING"}}
```
That rebuild redeployed the then-current `main`, which contains none of this work, so the live site was unchanged by the test.

**Set on PRODUCTION only** — `hhgyppbxgmjrwdpdubcx`, confirmed present at 22:50:21 — **and deliberately NOT on staging**, confirmed absent.

**Why staging is left without it, recorded so nobody "fixes" it later:** the website is a single environment, so that hook rebuilds the live `mynaavi.com`. Had staging carried it, every test save during development would have triggered a rebuild of the production website. Staging's banner therefore reads *"the public page is not being rebuilt"*, which is **true for staging** and is the correct thing for it to say.

**Security note.** The hook URL is a credential: anyone holding it can trigger a rebuild of mynaavi.com. It was pasted into a chat transcript during this session. It grants no data access and cannot alter content, so the exposure is nuisance-level — flagged to Wael at the time, with the option to rotate it by deleting and recreating the hook in Vercel.

---

## 8. Deferred, and why

**Extract `extractJson` into `_shared/`.** Three copies now exist across the codebase. Not done here because it would modify `naavi-chat`, a Protected Core file outside the approved boundary, and Phase 4's No Extra Changes Rule forbids opportunistic refactoring. **Recommended as its own small item** — it is exactly the kind of duplication that produces divergent bug fixes, and this session found the bug in two of the three copies.

**Share the support-form glue between `report.html` and `contact.html`.** The natural home is `shared.js`, which Phase 3 explicitly excluded. Deferred with the same reasoning.
