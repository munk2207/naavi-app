# FAQ Rebuild — Phase 0: Intent Approval

**Date:** 2026-09-02
**Status:** APPROVED WITH 2 CORRECTIONS — Wael, 2026-09-02. Corrections applied; see the approval section at the end.
**Item ID:** F25 proposed. Wael approved creating an ID on 2026-09-02; per CLAUDE.md Rule 1b the specific row is shown to him for approval before it is written into the holding list.
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v4.3, Phase 0.

**Protected Core — this work touches three of the twelve areas (§4):**
- **Database schema** — a new `faq_items` table
- **API contracts** — two new Edge Functions and their response shapes
- **Authentication / Permissions** — the boundary between unauthenticated read of published answers and staff-only write

Technical review is therefore mandatory before coding (Phase 3) and after implementation (Phase 6).

---

## User Intent

Wael wants an FAQ that **staff can add to and update with no technical step at all** — no file, no command, no push — and that **a customer can search in their own words rather than in MyNaavi's vocabulary**, reaching one set of answers written once instead of the three inconsistent copies that exist today.

This phase covers the **web stage only**. The mobile scope is deliberately deferred until the web build is finished and tested (Wael, 2026-09-02).

---

## Success Criteria

1. **A staffer adds a question in `staff.mynaavi.com` and it is live on `mynaavi.com/faq`** without anyone editing a file, running a command, or pushing anything.
2. **A customer on the FAQ page finds an answer** by typing plain words, or by choosing a category from a dropdown that has no built-in limit on how many categories exist.
3. **A customer submitting the website's Contact or Report form is shown matching published answers on Send**, matched by meaning rather than shared words. Demonstrated against the four phrases already measured as failing today:

   | Phrase | Today (real `scoreEntry` output) | Required |
   |---|---|---|
   | `how do i delete an alert` | 3 — works | still works |
   | `how do i delete` | 1.5 — nothing | finds the delete-an-alert answer |
   | `my alarm didn't go off this morning` | 1.5 — nothing | finds the report-a-problem answer ⭐ |
   | `I want to add my daughter to my community` | **0** — nothing | finds the Community answer |

   ⭐ **Success Criterion corrected in Phase 4, 2026-09-02, on Wael's ruling.** This row originally required the phrase to find *"Why is the morning brief showing tomorrow's events?"* **That expectation was wrong, and the matcher was right.** The two were paired on the word "morning": the brief question is about the brief showing the wrong *day*, and has nothing to do with an alert failing to fire. A customer whose alarm did not go off is describing a bug, and *"Something's broken. How do I report it?"* is where they should land. Recorded rather than quietly edited, because "the test was wrong" is the easiest thing in this process to say and the hardest to check.

4. **All 23 existing answers are live, unchanged word for word**, at their existing web addresses.
5. **A question with no matching answer returns nothing** and the ticket goes through. The matcher is never forced to produce a result.

---

## In Scope

**Database**
- `faq_items` table — question, answer, slug, categories (many per item), search terms, content fingerprint, active flag, timestamps
- **Requirement, not mechanism:** published answers must be readable **without authentication**; all writes must be restricted to authorised staff. **How that is enforced — RLS with a public read policy, a read-only Edge Function, a generated public file, or something else — is a Phase 1 / 1A decision, deliberately not fixed here.**
- A category list held as data, extensible without a code change

**Edge Functions**
- `manage-faq` — staff-authenticated via the existing `check-staff`; create / update / deactivate; classifies on save and re-classifies whenever the question or answer text changes (fingerprint comparison)
- `match-faq` — the single shared matching module. AI matching over published answers. Returns matching published answers or an empty result. **Never composes an answer.**

**Staff portal (`munk2207/naavi-staff`)**
- FAQ section: list, create, edit, deactivate
- "Create an FAQ from this ticket" action in `support.html`, pre-filling from the ticket's question and the reply that was sent

**Website (`munk2207/mynaavi-website`)**
- `faq.html` rebuilt: reads from the database, live search, category dropdown
- `report.html` and `contact.html`: call `match-faq` on Send and show matches before filing
- One-time migration of the 23 existing questions and answers, preserving all 23 slugs

**Tests**
- Auto-tester coverage per CLAUDE.md Rule 15a, including the four phrases above as regression cases

---

## Out of Scope

- **Any mobile app change.** `lib/faq.ts` is untouched; the app's support forms keep their current 12 keyword entries. No AAB, no Play release, no gates.
- **The voice surface.** No change to the voice server or to `get-naavi-prompt`.
- **AI composing answers.** The matcher selects from published answers only.
- **Stage-two AI** — reading answers aloud, generating summaries.
- **Creating a holding-list item.** Requires Wael's separate approval (Rule 1b).
- **Production deployment.** Requires Wael's explicit instruction (CLAUDE.md staging-first).

---

## Constraints

- **Staging first.** Migrations and Edge Functions deploy to `xugvnfudofuskxoknhve`. Production (`hhgyppbxgmjrwdpdubcx`) only on Wael's explicit say-so.
- **The website has no staging environment.** Pages are live on push. Web pages must therefore not be pushed until the functions they call exist in the environment those pages point at.
- **The 23 answers must not change wording.** Not rewritten, not summarised, not improved in passing. Verified by before-and-after comparison, question by question.
- **All 23 web addresses must keep working.** The mobile app deep-links 12 of them (`lib/faq.ts` → `mynaavi.com/faq#<slug>`) and `sitemap.xml` lists the page.
- **The FAQ page must degrade readably** if the database is slow or unreachable — not a blank screen.
- **`match-faq`'s response shape must be designed to allow later mobile reuse without requiring an API redesign.** This is the one decision that is expensive to get wrong.
- **Categories are data, not code.** Staff own the list; the AI assigns from it and does not invent new ones.
- **Matching runs on Send**, not per keystroke, in the support forms.

---

## Completion Criteria

1. A question created in the staff portal appears on `mynaavi.com/faq` with no file edit, command, or push — demonstrated live.
2. An answer edited in the staff portal re-classifies itself, demonstrated by a category changing after a content change.
3. The four phrases in Success Criteria #3 each return the required result from `match-faq`, shown as actual function output.
4. A phrase describing a genuine bug returns no match and the ticket proceeds.
5. All 23 answers verified identical before and after migration, by text comparison, with the comparison shown rather than asserted.
6. All 23 anchors verified live.
7. `npm run test:auto` green, including new regression tests.
8. The Architecture Reference is updated in this same work item (governance Phase 8).

---

## Decisions — answered by Wael, 2026-09-02

1. **Who can publish** — **any staffer publishes directly.** The roles exist to add a draft-and-approve step later; there is one staffer today.
2. **Entry points for stage one** — **the FAQ page, plus `report.html` and `contact.html` on the website.** Nothing else.
3. **The FAQ page's own search** — **filters live as the customer types.** It is a local filter over already-loaded content, not a call.
4. **Starting categories** — **kept as proposed:** Getting started · Talking to MyNaavi · Alerts & reminders · Messages & lists · Calls & briefings · Privacy & help. Extensible without a code change.
5. **Holding-list ID** — **approved to create one.** The specific row and its FOR WAEL'S EYES line are shown to Wael for approval before being written (Rule 1b).

---

## Phase 0 approval

**APPROVED WITH 2 CORRECTIONS — Wael, 2026-09-02.** Both applied above:

1. **Phase 0 no longer specifies a read mechanism.** It states the requirement — unauthenticated access to published FAQs, writes restricted to staff — and leaves RLS-versus-alternative to Phase 1 / 1A. *Rationale: fixing the mechanism in the intent contract would pre-decide an architecture question before the architecture phase examined it.*
2. **"later mobile use without an app release" → "later mobile reuse without requiring an API redesign."** *Rationale: the guarantee that matters is contract stability, not release avoidance — an app release may be needed for other reasons, and the constraint should not appear to promise otherwise.*

Proceed to Phase 1.
