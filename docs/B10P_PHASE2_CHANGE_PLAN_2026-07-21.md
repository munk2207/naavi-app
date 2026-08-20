# B10p — Phase 2: Change Planning

**Date:** 2026-07-21
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.6, Phase 2

No code written in producing this document.

---

## Design decision: presentation by fact count, stated per tier (per Phase 1A review's explicit requirement)

"Facts" = the distinct pieces of information a location-alert confirmation can carry: a self-task clause, a third-party clause. (`list_name` is intentionally excluded from the fact count for this work item — see Interaction with the list-attachment bug, below.)

| Fact count | Presentation | Rationale |
|---|---|---|
| **0** | Plain headline sentence only, unchanged from today (e.g., "Alert set — one time you arrive at Home.") | Nothing to separate. |
| **1** | Headline + single trailing clause, unchanged from today's B10o behavior (e.g., "Alert set — one time you arrive at Home. Note: feed the cat.") | A single fact reads fine as continuous prose — numbering one item adds visual noise with no comprehension benefit. Matches the existing precedent that compound-plan itself doesn't trigger for a single item either. |
| **2** | Headline becomes a colon-terminated intro, followed by a 2-item numbered list (e.g., "Here's what happens when you arrive at Home:\n1. Note: feed the cat.\n2. Bob will get \"I'm home\".") | This is the core case B10p addresses — two categorically different facts (something for you, something for someone else) benefit from visual separation even though compound-plan's own threshold is 3+; a location alert's 2-fact case is common enough and different enough in kind (not just quantity) to warrant its own threshold, per Phase 1's UX rationale (this is a design choice, not code reuse). |
| **3+** | Same numbered-list treatment as 2 | No reason to have a third distinct format — once the list format engages, it should stay consistent regardless of exactly how many facts follow. (3+ isn't currently reachable with today's two possible fact types, but the mechanism is built to not silently break if a third fact type — e.g. `list_name` — is added later.) |

**All counts use one consistent underlying mechanism** (a single combine function, see below), not four different code paths — the branching is on *how many facts to show*, not on duplicated formatting logic per count.

## Interaction with the list-attachment bug (explicitly not folded in)

`list_name` is not counted as a "fact" in this work item, even though Phase 1A's inventory flagged it as a plausible third fact type. Reason: the list-attachment mechanism itself has a known, separate, not-yet-scoped bug (a real list can exist and never get attached to the rule at all) — B10p would be numbering a fact that may not even be reliably present. The fact-counting mechanism is built generically enough (an array of fact strings) that adding `list_name` as a third input later, once that bug is fixed, requires no restructuring — but that's explicitly future work, not this item.

## Files that will change

| File | Classification | Change |
|---|---|---|
| `lib/alertReadback.ts` | Shared Logic | Add a new function, `combineHeadlineAndFacts(headline: string, facts: string[]): string`, implementing the table above. **Same functional contract as B10o's helpers: pure, deterministic, no side effects — responsible only for presentation formatting, not for deciding what the facts are or resolving any business logic.** `buildAlertReadbackSuffix`/`formatThirdPartyClause` (B10o) stay as-is internally, but each of the 4 call sites switches from string-concatenation (`headline + suffix`) to building a `facts` array and calling this new combiner. |
| `hooks/useOrchestrator.ts` | Shared Logic (mobile write paths, Action Rules) | Same 4 sites B10o converted (`hooks/useOrchestrator.ts:449, 1671-1672, 1802, 3978`), updated to build a `facts: string[]` array (self-task clause if present, third-party clause if present) and call `combineHeadlineAndFacts(headline, facts)` instead of string-concatenating a suffix. The 2 merge-into-existing-alert sites (still using their own inline `addedDesc` pattern, unchanged by B10o) are **not** touched here either — same reasoning as B10o's Deviation #2, kept consistent. |
| `tests/catalogue/session-2026-07-21-b10p-...ts` (new) | Test infra | Regression tests per Rule 15a — one test per count tier (0/1/2/3+), plus the exact live-reproduced compound scenario from B10p's Phase 1. |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | Docs | Close-out entry once shipped. |

## Risk classification: Medium

Same reasoning as B10o: Protected Core, multiple call sites, but no data/write changes — this only changes what's displayed/spoken, not what's stored or when it fires.

## Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | Yes | `lib/alertReadback.ts`, `hooks/useOrchestrator.ts` (same 4 sites B10o converted, not the 2 merge sites) |
| Voice | **No** | Re-confirmed in Phase 1A — structurally cannot construct the multi-fact scenario this reformats |
| Shared Core | **No** | Same as B10o — `naavi-chat` never builds a post-confirmation location message |
| Database | **No** | Presentation-only change |
| Cron | **No** | No fire-time logic touched |
| API contracts | **No** | No Edge Function changes |
| Tests | Yes | New regression tests required |

## Mandatory Architecture Impact Checklist

- Does this change modify Shared Core? No.
- Does this change modify an Entry Point? Yes — same as B10o, stays within translating stored data into user-facing text.
- Does this change introduce new duplication? No — one combiner function, all applicable sites route through it.
- Does this change eliminate existing duplication? Marginally — replaces 4 sites' individual string-concatenation with one shared combiner, same consolidation principle as B10o.
- Does this change modify Protected Core? Yes — same files as B10o, already under Full Phase 1-8.

## Regression Impact

Same table as B10o's Phase 2 — Voice/Geofencing/Gmail/Calendar/Reminders/SMS-at-fire-time/Onboarding/Staging all **not affected**, for the same reasons (creation-time confirmation text only, fire-time behavior untouched).

**One new regression concern specific to this change:** TTS behavior for a numbered, multi-line confirmation has not been previously validated for *this specific* confirmation type (only for compound-plan, a different trigger). Per Phase 1's evidence, `sanitiseForSpeech` doesn't strip numbering, and Wael has confirmed sound/text stay in sync for compound-plan — but this must be re-confirmed by ear for the location-alert case specifically during Phase 7, not assumed to transfer automatically.

## Regression Matrix (per-change consumer trace)

`combineHeadlineAndFacts` is a new function — no pre-existing consumers. Its consumer list going forward is exactly the same 4 sites already using `buildAlertReadbackSuffix`/`formatThirdPartyClause` (`hooks/useOrchestrator.ts:449, 1671-1672, 1802, 3978`, per B10o's Phase 6 verification) — no other file constructs this class of text.

---

## Status and next steps

Phase 2 complete. Risk is Medium, requiring Phase 3 review before coding. Per the Phase-Gate Approval Rule, your own explicit go-ahead is required before Phase 3 begins.
