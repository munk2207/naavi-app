# FAQ Rebuild — Phase 1A: Architecture Completeness Review

**Date:** 2026-09-02
**Item:** F25 (proposed — row awaiting Wael's approval per Rule 1b)
**Phase 0:** approved with 2 corrections, 2026-09-02
**Phase 1:** approved by Wael, 2026-09-02
**Governance:** v4.3, Phase 1A. Mandatory — this change affects the Protected Core.

**Architecture Reference version used for this review: `2026.09.01.16`** — revision 16, dated 2026-09-01, landed at [[B11l]] Phase 8. Per the Version Verification requirement, this must be re-confirmed as current before Phase 8 merge; if a newer revision exists by then, its effect on the assumptions below must be evaluated explicitly rather than assumed absent.

---

## 1. The required answers

### What is the architectural owner of the affected capability?

**Not documented. The Architecture Reference does not describe this capability at all.**

Freshly verified this session — a case-insensitive search of the entire Reference for `faq`, `staff portal`, `staff.mynaavi` and `ticket` returns **one** hit: line 160, where "ticket" appears as a *document type* in the attachment-classification list. Unrelated.

There is no §2 capability row, no §5a duplication row, and no mention in the Ownership Model.

**This omission is broader than the FAQ.** The staff portal is a shipped capability — holding-list `F6a`, closed 2026-06-12, with its own repository (`munk2207/naavi-staff`), its own Vercel deployment, an OTP login and a three-tier role system — and it appears nowhere in the document CLAUDE.md designates as the only architecture reference. Nor does the ticket system it hosts.

### Is the capability Shared Core, Duplicated, or Platform-specific?

**Cannot be read from the Reference. Determined by fresh investigation:**

**Today it is Duplicated — three independent implementations of the same content:**

| Implementation | Evidence | Holds |
|---|---|---|
| Website page | `mynaavi-website/faq.html`, 23 `<details>` blocks | all 23, as HTML |
| Hidden search-engine copy | same file, lines 17–208, 23 `"@type": "Question"` entries | all 23, as flat text |
| Mobile keyword table | `lib/faq.ts`, 12 `slug:` entries | 12, as TypeScript |

**After this work it becomes Shared Core** — one stored record, one matcher, consumed by the website now and available to the app later without an API redesign.

### ⚠️ This is an ownership change, and §4's Ownership Change Rule applies

Governance §4: *"moving a capability from one owning component to another requires explicit architectural approval from Wael, separate from ordinary Phase-Gate approval for the work item itself, and the Architecture Reference must be updated in the same work item."*

**Duplicated → Shared Core is exactly that move.** It therefore needs Wael's explicit architectural approval as a distinct decision, not as a by-product of approving F25. Recorded here as an open approval item (§4 below).

### If duplicated, were all documented implementations investigated?

**No implementations are *documented*, so the question cannot be answered from the Reference.** All implementations found by fresh investigation were investigated — enumerated in §2 below, each with a provenance tag.

### Does the documented problem scope match the Architecture Reference?

**No — the Reference is silent on this capability.** Handled as an Architecture Drift Rule outcome in §3.

### Is any documented implementation excluded from the investigation?

**None is excluded from investigation.** Two are investigated and then explicitly excluded from *this stage's scope*, with justification, in §2.

---

## 2. Cross-Repository Verification

Every bullet carries a provenance tag, per the Verification Provenance Rule. **No bullet below relies on the Architecture Reference, because the Reference documents none of this.**

**Mobile — `munk2207/naavi-app`**
- **Freshly verified this session — evidence:** `app/help.tsx:21` (`FAQ_URL = 'https://mynaavi.com/faq'`) and `:50` (`onPress: () => openUrl(FAQ_URL)`). Help → Frequently asked opens the live website, so the app already reads all 23 and inherits the rebuilt page with no app change.
- **Freshly verified this session — evidence:** `app/contact.tsx:31,50,181` and `app/report.tsx:32,66,201` import and call `suggestFaq` / `faqUrl` from `lib/faq.ts`. These are the only two consumers of the mobile keyword table; nothing else in the app imports it.
- **Explicitly declared out of scope for this stage, with justification:** Wael's decision, 2026-09-02 — *"we will wait until finish this build and test on the web forms before we establish what exactly the scope on mobile."* `lib/faq.ts` is unchanged; the app's two forms keep their present 12-entry keyword behaviour and keep working. **This is a deferral, not a claim that no change is needed** — Phase 1 records the 11 questions the app cannot suggest.

**Voice — `munk2207/naavi-voice-server`**
- **Freshly verified this session — evidence:** `rg -i "faq|help article|knowledge base"` across `naavi-voice-server/src/*.js` returns two hits, `index.js:3309` and `:3337`. Both are comments about searching the **user's own** `knowledge_fragments` for a person or thing they asked about — *"the user asks 'tell me about X' / 'who is X'"* — not FAQ content. **There is no FAQ logic in the voice server, on either branch.**
- **Out of scope, and nothing to change.** No equivalent implementation exists, so there is no parallel change to make or to justify omitting.

**Shared Core — `supabase/functions/`**
- **Freshly verified this session — evidence:** no function directory matches FAQ; the enumeration in §2's table below found no server-side FAQ implementation of any kind.
- **Freshly verified this session — evidence:** `supabase/functions/check-staff/index.ts:11-28` authenticates a bearer token, looks up `support_staff` by email where `active`, and returns `{authorized, email, role}` with `role` ∈ superadmin / admin / staff. **Reused unchanged** — no modification to an existing Protected Core auth path.

**Staff portal — `munk2207/naavi-staff`**
- **Freshly verified this session — evidence:** `rg -i "faq"` across `index.html`, `support.html`, `admin.html` returns nothing. No FAQ logic exists there today; the FAQ section is new.

**Website — `munk2207/mynaavi-website`**
- **Freshly verified this session — evidence:** `faq.html` (the page) and `sitemap.xml` (lists `/faq`) are the only files referencing FAQ content.
- **Freshly verified this session — evidence:** `rg -i "faq" report.html contact.html` returns only a severity tile named "Suggestion" and a dropdown option "Feedback or a suggestion". **Neither support form contains any FAQ logic.** Adding matching there is new capability, not a modification.

**Complete consumer enumeration** — `rg -l "mynaavi.com/faq|faq\.html|FAQ_ITEMS|suggestFaq"` across all four repositories, excluding `node_modules` and `.git`, returns exactly: `app/contact.tsx`, `app/help.tsx`, `app/report.tsx`, `lib/faq.ts`, `mynaavi-website/faq.html`, `mynaavi-website/sitemap.xml`, and session-handoff documents. **No consumer was found that is not listed above.**

---

## 3. Architecture Drift Rule verdict

**Outcome 3 — the Reference was already stale before this work began.** It is not merely imprecise about the FAQ; it is silent on the FAQ, the staff portal and the ticket system.

**Under Governance v4.3's amendment (2026-09-01), implementation does not stop.** The finding is recorded here in full and reconciled at Phase 8 with Wael's explicit approval.

**Continuing is neither unsafe nor impossible to define**, which is the v4.3 test. The map that was missing has been produced by the fresh investigation in §2, and every consumer is enumerated. The risk the original Outcome 3 guarded against — proceeding on a map known to be wrong — does not apply to a map known to be *absent* and replaced this session by direct evidence.

**What Phase 8 must add to the Architecture Reference** — this is a hard merge precondition, and it is larger than F25 itself:

1. The **FAQ capability** — its record, its matcher, its consumers, and its Shared Core classification
2. The **staff portal** (`munk2207/naavi-staff`) — fourth repository, its own deployment, `check-staff` as its gate, the role model
3. The **ticket system** it hosts, to the extent needed for the portal row to make sense

**Item 2 is worth Wael's attention independently.** A shipped capability with its own repository has been invisible to the project's only architecture document since June. F25 is the occasion that surfaced it, not its cause.

---

## 4. The mechanism Phase 0 deferred — unauthenticated read

Phase 0 states the requirement (published answers readable without authentication; writes restricted to staff) and, on Wael's correction, deliberately left the mechanism to this phase.

| Option | What it means | Assessment |
|---|---|---|
| **A — RLS public-read policy** | The anon key reads `faq_items` directly where `active` | Fewest moving parts. **But what is public becomes a property of a policy rather than of an explicit response shape** — any column added later is public by default, and the table will hold drafts, fingerprints and classification metadata. The failure mode is silent over-exposure. |
| **B — read-only Edge Function** | A function returns an explicit list of published fields | One more function, but **what is public is stated in code and cannot drift by adding a column.** Matches the pattern `match-faq` needs anyway, so the FAQ has one access shape rather than two. |
| **C — generated public file** | The function writes a static JSON file on save | Reintroduces a second source of truth — the thing this item exists to remove. |

**Recommendation: B.** It is the tighter contract on a Protected Core boundary (Permissions), and it keeps CLAUDE.md's DATA INTEGRITY Layer 2 shape — one entry point owning access — rather than splitting reads and writes across two mechanisms. **Decision required from Wael**; Phase 2 cannot plan the schema's exposure without it.

---

## 5. Verdict

**PASS**, with three items requiring Wael's explicit decision before Phase 2:

1. **Ownership change approval** — Duplicated → Shared Core, per §4's Ownership Change Rule. Separate from approving F25 itself.
2. **The unauthenticated-read mechanism** — §4 above. Recommendation: B, a read-only Edge Function.
3. **Confirmation that the Phase 8 Reference reconciliation includes the staff portal and ticket system**, not only the FAQ.

No implementation may begin. Phase 2 is not authorized by this document.
