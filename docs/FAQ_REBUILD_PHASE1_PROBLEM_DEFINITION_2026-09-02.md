# FAQ Rebuild — Phase 1: Problem Definition

**Date:** 2026-09-02
**Item:** F25 (proposed — row awaiting Wael's approval per Rule 1b)
**Phase 0:** `docs/FAQ_REBUILD_PHASE0_INTENT_2026-09-02.md` — approved with 2 corrections, 2026-09-02
**Governance:** v4.3, Phase 1. No code written during this phase.

Every claim below is a direct observation with its source. Where something is not proven, it says so.

---

## 1. What exactly is broken

Three separate defects, all in the same content.

**A — The FAQ cannot grow into a usable page.** 23 questions in one flat scroll with no way to narrow it.

**B — The same content is stored in three places, and one is stale.** The mobile app's copy lists 12 of the 23 published questions.

**C — Finding an answer requires the customer to use MyNaavi's vocabulary.** Matching is literal keyword overlap, and only exists on one of the four surfaces at all.

---

## 2. Evidence

### A — the page

| Observation | Source |
|---|---|
| 555 lines, 23 `<details>` blocks | `mynaavi-website/faq.html`, `wc -l`, `rg -c '<summary>'` |
| **0** `<h2>` headings — no categories of any kind | `rg -c '<h2'` returned no match |
| **No search input anywhere** | `rg -i 'input.*search\|filter'` returned no match |
| A hidden duplicate of all 23 Q&A, lines 17–208 | `rg -n 'application/ld\+json'` → line 17; `</script>` → line 208; 23 `"@type": "Question"` entries |

**The two halves of `faq.html` are currently identical in content.** All 23 questions and all 23 answers compared after normalisation: **0 question mismatches, 0 answer mismatches.** No drift exists there today. This is stated because it contradicts the natural assumption and must not be overstated in later phases.

### B — the third copy

| Observation | Source |
|---|---|
| The app's copy holds **12** entries | `lib/faq.ts`, 12 `slug:` occurrences |
| Its own header states it *"mirrors the 12 questions live at mynaavi.com/faq"* and *"When the canonical FAQ on mynaavi.com changes, update this file"* | `lib/faq.ts:6-12` |
| **23** are live | `faq.html`, 23 `<details id="...">` |
| **11 questions have no entry in the app at all** | set difference — what-is-mynaavi, mynaavi-community, community-add, phone-number, someone-set-up, every-time-confirm, mishear-correction, reactivate-alert, send-draft, manage-lists, choose-channels |
| **All 12 app slugs still resolve to a live anchor** — no dead deep links | set intersection against `faq.html` anchor ids |

### C — matching

Four phrases run through the **real `scoreEntry` function** copied verbatim from `lib/faq.ts:88-104`, against the real `FAQ_ITEMS` parsed from the file. Threshold is 2 (`lib/faq.ts:116`).

| Phrase typed | Score | Result |
|---|---|---|
| `how do i delete an alert` | 3.0 | works — 2 keyword hits + 2 title bonuses |
| `how do i delete` | 1.5 | **nothing** — 1 keyword hit + 1 title bonus |
| `my alarm didn't go off this morning` | 1.5 | **nothing** |
| `I want to add my daughter to my community` | **0** | **nothing**, against a published answer titled *"How do I add someone to my MyNaavi Community?"* |

Confirmed on device by Wael, 2026-09-02: typing `How do i delete` produced no suggestion; adding the word `alert` produced one.

**The four surfaces behave differently:**

| Surface | Knows | Matching | Source |
|---|---|---|---|
| Website FAQ page | all 23 | none | `faq.html` |
| App → Help → Frequently asked | all 23 | none — opens the website | `app/help.tsx:21,50` |
| App → Contact / Report | **12** | keyword | `app/contact.tsx:50`, `app/report.tsx:66` |
| Website → Contact / Report | **none** | **none** | `rg -i 'faq' report.html contact.html` — the only hits are a severity tile named "Suggestion" and a dropdown option "Feedback or a suggestion" |

---

## 3. Root cause

**Proven. Two causes, one structural and one algorithmic.**

**Cause 1 — there is no source of record. The FAQ is authored as markup.**

The content exists only inside presentation files: `faq.html` holds it as HTML, again as a JSON string, and `lib/faq.ts` holds a third derivative as TypeScript. There is no data layer any consumer can read.

The consequence is forced, not accidental: **any surface that wants the FAQ must keep its own copy**, because there is nothing to read from. `lib/faq.ts:6-12` documents the resulting obligation in prose — *"update this file to keep keywords in sync"* — and **nothing enforces it**. Eleven questions were added to the website after that file was written and none reached it.

This is the same failure CLAUDE.md names about architecture documents: *a document stays current only if something mechanically forces it to.*

**Cause 2 — the matcher compares words, not meaning.**

`lib/faq.ts:88-104` iterates an entry's literal keywords, scoring 1 per word-boundary regex hit, plus 0.5 per title word appearing in the text. `lib/faq.ts:116` requires ≥ 2 to show anything.

Two consequences follow arithmetically, both measured above:
- **One matching word is never enough.** `delete` scores 1 + 0.5 = 1.5, below threshold, however unambiguous it is to a reader.
- **A question with no keyword list can never score.** The 11 missing entries return 0 for every possible input.

**Not proven, and not claimed:** that customers are currently filing tickets they would not have filed had matching worked. No ticket-deflection data was examined.

---

## 4. Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Zendesk / Freshdesk** | Wael, 2026-09-02: support and ticketing are already built. Buying a support-desk product to solve a page-structure problem adds a subscription, a second home for the content, and an external domain. |
| **Markdown source file + local build command** | Proposed by Claude and rejected by Wael, 2026-09-02: *"push or save is the same, it has the same effect, no one will do it."* Requires a human technical step, which is the exact failure mode that left `lib/faq.ts` eleven questions behind. |
| **Keep `faq.html` hand-edited; add only search + categories** | Fixes defect A on one surface. Leaves three copies, leaves the app's forms at 12, leaves the website's forms with nothing, and still requires editing code to add a question. |
| **Lower the keyword threshold from 2 to 1** | Measured, not assumed: `delete` alone would then match multiple unrelated entries, and the 11 questions with no keyword list still score 0. Does not address defect B at all. |
| **Generate everything from one file at build time** | Same defeat as the Markdown option — depends on someone running a command. Considered and rejected for the same reason. |
| **Chosen: one database record, staff authoring in the existing portal, one shared matcher** | Removes the human step entirely, collapses three copies to one, and replaces literal matching with meaning. |

---

## 5. Architecture location

**⚠️ Architecture location not proven from the Reference.**

`docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` **does not cover the FAQ, the staff portal, or the ticket system.** Verified: a case-insensitive search for `faq`, `staff portal`, `staff.mynaavi` and `ticket` across the whole Reference returns **one** hit — line 160, and that is the word "ticket" used as a document *type* in the attachment-classification list, unrelated.

**Resolved by fresh grep, as Phase 1 permits.** Recorded here so Phase 1A has a starting map:

| Component | Repo / path | Note |
|---|---|---|
| Customer FAQ page | `munk2207/mynaavi-website` → `faq.html` | static, hand-authored |
| App entry to it | `munk2207/naavi-app` → `app/help.tsx:21,50` | opens the website |
| App's keyword copy | `naavi-app` → `lib/faq.ts` | consumed by `app/contact.tsx`, `app/report.tsx` |
| Staff portal | **`munk2207/naavi-staff`** → `index.html`, `support.html`, `admin.html` | fourth repo, at `Desktop/naavi-staff` |
| Staff auth | `naavi-app` → `supabase/functions/check-staff` | returns `{authorized, email, role}`; reads `support_staff` |

**This is a finding in its own right.** The staff portal is a shipped capability — holding-list `F6a`, closed 2026-06-12, its own repo and Vercel deployment — and it is **absent from the document CLAUDE.md designates as the only architecture reference.** Governance Phase 8 requires the Reference to be updated within this work item; that update must add the staff portal and the ticket system, not only the FAQ.

**Proposed classification for the new capability: Shared Core.** `match-faq` is to be consumed by the website today and the mobile app later; a capability with more than one consumer is Shared Core by the Reference's own Ownership Model. **This is a proposal for Phase 1A to confirm or reject**, not a decision taken here.

---

## 6. What Phase 1A must settle

1. **How unauthenticated read is served** — Phase 0 deliberately left the mechanism open (Wael's correction 1). Options include an RLS public-read policy, a read-only Edge Function, or a generated public file. Each has a different blast radius on the Protected Core.
2. **Whether `match-faq` is genuinely Shared Core**, and what that obliges.
3. **The response contract for `match-faq`** — the one decision Phase 0 names as expensive to get wrong, required to allow later mobile reuse without an API redesign.
4. **Whether adding a fourth repo to the build changes the Cross-Repository Verification obligation.**
