# MyNaavi AI Development Governance — Release Gate Workflow

Version 3.6 — 2026-07-21. See §13 Changelog for the full version history.

## Purpose

This document defines the mandatory engineering process for all AI-assisted development of MyNaavi.

The objective is not to prevent AI from making mistakes.

The objective is to build a development process where mistakes are detected before they become expensive.

This document applies to every contributor, including AI coding assistants.

**Companion document:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` (or its successor, if superseded) is the project's authoritative Architecture Reference — where each capability's real implementation lives, which are Shared Core vs. Duplicated vs. Platform-specific, and the Protected Core file mapping. This governance document defines *the process*; the Architecture Reference defines *the terrain the process operates on*. Neither replaces the other — a process followed against a wrong or stale map of the codebase is exactly the failure mode both documents exist to prevent. See Phase 1A and Phase 2's Change Impact Matrix for where the Architecture Reference is used directly.

**Three coordinated layers, not one document doing everything:**
1. **Development Governance** (this document) — how changes are allowed to happen.
2. **Architecture Reference** — what the system actually is, right now, verified.
3. **Architecture Integrity Audit** (T1a, triggered per §5) — verifies reality still matches the Architecture Reference, and catches the two from drifting apart from each other.

---

## 1. Team Roles

### Product Owner — Wael

Responsible for:
- Product vision
- Requirements
- Final approval
- Release approval

---

### Implementation Engineer — Claude Code

Responsible for:
- Investigation
- Writing code
- Running automated tests
- Producing evidence
- Explaining implementation decisions

Claude Code is not the final authority on:
- Architecture
- Production readiness
- Release approval
- Risk acceptance

---

### External Technical Reviewer — ChatGPT

Responsible for:
- Challenging assumptions
- Reviewing architecture
- Evaluating implementation plans
- Reviewing code changes
- Identifying regression risks
- Reviewing Claude's recommendations
- Recommending approval, revision, or rejection

The reviewer does not replace Claude. The reviewer provides an independent engineering opinion.

---

## 2. Development Philosophy

Every change follows one principle:

> **Protect stability before adding functionality.**

A feature that breaks an existing feature is considered incomplete.

---

## 3. Development Workflow

### ⭐ Phase-Gate Approval Rule (added 2026-07-17, Wael, explicit — in all cases)

**Moving from one phase to the next always requires Wael's own explicit, separate approval — given directly to Claude, for that specific phase transition. In all cases. No exceptions.**

**A reviewer's verdict of "Approved" is never, by itself, authorization to proceed.** ChatGPT's review is one input Wael weighs — it is not a substitute for Wael's own decision, and it does not carry implied authorization with it. When a phase document comes back "Approved," Claude must stop, present that verdict to Wael, and wait for Wael's own separate, explicit go-ahead before starting the next phase's work — including drafting the next phase's document. Silence, a prior general instruction, or the reviewer's approval are all insufficient; only Wael's own word for that specific transition counts.

This applies to every phase transition without exception: Phase 1→1A, 1A→2, 2→3, 3→4, 4→5, 5→6, 6→7, 7→8, and promotion to production after Phase 8. It also applies to closing a phase on alternative evidence instead of a live test that proved impractical (e.g. accepting simulation + automated tests in place of an unreproducible manual test) — that is itself a phase-gate decision and needs Wael's explicit sign-off, not Claude's own judgment call.

**Why this rule exists:** violated twice in the same session (2026-07-17, F5c) before being made explicit here — Claude opened the next phase's document on the strength of the reviewer's "Approved" verdict alone, without first getting Wael's own separate word. Reviewer approval answers "is this technically sound?" — only Wael answers "do we proceed?" Conflating the two lets review quality substitute for product ownership, which defeats the entire purpose of Section 1's role split. See `feedback_governance_phase_gate_wait` in memory for the incident record.

---

### Phase 1 — Problem Definition

Before any code is written Claude must answer:

- What exactly is broken?
- What evidence proves the problem?
- What is the root cause?
- What alternatives were considered?
- **Which capability in the Architecture Reference** (`docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`) **owns this behavior, and what is its classification — Shared Core, Mobile-only, Voice-only, Duplicated, or Protected Core?** Name the owning component per the Reference's Ownership Model (§0a), not just the classification label. If this cannot be answered with a citation into the Architecture Reference (or a fresh grep if the Reference doesn't yet cover it), state **"Architecture location not proven"** and resolve that before continuing — this is a first-pass check, refined and made mandatory at Phase 1A below.

**No Assumptions Rule**

Claude must not use the words "probably" or "likely" without direct evidence.

Every root cause statement must include at least one of: file path, function name, log line, database row, screenshot, or test result.

If direct evidence is missing, Claude must state: **"Root cause not proven."** No fix is proposed until the root cause is proven.

No code is written during this phase.

---

### Phase 1A — Architecture Completeness Review (Mandatory)

This phase is performed **after the technical investigation of Phase 1 and before Phase 2 begins.**

Its purpose is to verify that the problem definition is complete **with respect to the Architecture Reference**, not merely internally consistent.

This review is mandatory for every change affecting the Protected Core.

**The Architecture Reference is `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`** (or its successor, if superseded — the most recently dated file of this name is authoritative). This document must be updated whenever a capability's Shared Core / Duplicated / Platform-specific status changes, in the same commit or session as the change that caused it. An out-of-date Architecture Reference is worse than none, because it creates false confidence that a check happened when it didn't.

**Architecture Reference Version Verification.** The Architecture Reference's version and date (per its own version metadata block) used for this Phase 1A review must be recorded in the Phase 1A document. Before Phase 8 merge, confirm no newer Architecture Reference has superseded it. If a newer version exists, evaluate explicitly whether it changes any assumption this implementation relied on — do not assume "probably not" without checking. This guards against the case where the Architecture Reference is updated by other work mid-implementation and the change silently proceeds against a map that's since changed.

The reviewer must answer each of the following explicitly:

- What is the architectural owner of the affected capability?
- Is the capability Shared Core, Duplicated, or Platform-specific?
- If duplicated, were **all documented implementations** investigated?
- If not, which implementations were investigated and which were not?
- Does the documented problem scope match the Architecture Reference?
- Is any documented implementation excluded from the investigation?

**Architecture Scope Rule** (also known as the **Cross-Repository Verification Rule** — same rule, named both ways so it's found under either)

No reviewer may assume that one implementation represents another.

Before any implementation is approved, Claude must verify whether equivalent logic exists in Mobile, Voice, and Shared Core. When the Architecture Reference documents multiple implementations, each one must be either:

- Verified by evidence; or
- Explicitly declared out of scope with justification.

If duplicated implementations exist: identify them, state whether they require matching changes, and if not, state why not. Silence is not acceptable, in either direction.

**Independent Review Rule**

Phase 1 now has two independent reviews:

1. Technical Investigation Review
2. Architecture Completeness Review

Passing one review does not imply passing the other.

A Phase 1 document cannot receive an overall approval recommendation until both reviews pass.

**Known limitation, accepted rather than solved:** ChatGPT has no direct access to the codebase and reviews only what Claude presents. This phase raises the bar on what Claude must explicitly report — silence about an unchecked implementation is itself a violation — but it cannot force the underlying verification to have actually happened. The remaining safeguards are Wael's own spot-checks, the working trust between Product Owner and Implementation Engineer, and — at a longer time horizon — the Architecture Audit Trigger (§5): a periodic, forced re-validation of the Architecture Reference against the real codebase is the actual mechanism that compensates for this limitation over time, rather than trusting per-change self-reports indefinitely. This is accepted as a structural limit of the current process, not something this rule is believed to fully close on its own.

---

### Phase 2 — Change Planning

Claude provides:

- Files that will change
- Classification of every file: UI / Shared Logic / Backend / Configuration / Dependency / Database
- Explanation for every modification
- Risk classification: Low / Medium / High

**Change Impact Matrix**

Every Protected Core change must explicitly state which architectural layers are affected, using the Architecture Reference (Phase 1A) as the source of truth for what "affected" means for the capability in question:

| Layer | Affected? | Details |
|---|---|---|
| Mobile |  |  |
| Voice |  |  |
| Shared Core |  |  |
| Database |  |  |
| Cron |  |  |
| API contracts |  |  |
| Tests |  |  |

"No" must be stated explicitly for every row — an omitted row is not the same as "not affected," and is not acceptable. If the Architecture Reference marks the affected capability as Duplicated (Mobile and Voice each have their own implementation), both rows must be addressed individually — a plan that changes only one side of a duplicated capability must say so, not leave the other side's row blank on the assumption it's out of scope.

**If duplicated, state explicitly: will both implementations change, or only one — and why?** "Only one, because the other surface can never reach this code path" is an acceptable answer. "Only one, unaddressed" is not.

**Mandatory Architecture Impact Checklist** — every plan must answer each of the following explicitly, citing the Architecture Reference:

- Does this change modify Shared Core?
- Does this change modify an Entry Point (mobile or voice translating logic, rather than Shared Core)?
- Does this change introduce new duplication?
- Does this change eliminate existing duplication?
- Does this change modify Protected Core?

"No" must be stated for each, the same as the Change Impact Matrix above — this checklist exists to standardize the questions a reviewer would naturally ask anyway, so no plan skips one by omission.

**Regression Impact**

Every plan must explicitly answer: *What existing working functions could be affected by this change?*

Claude must evaluate impact on each of the following for every plan:

- Voice commands
- Geofencing
- Gmail integration
- Calendar integration
- Reminders
- SMS / call alerts
- Onboarding
- Staging build

If a function is not affected, Claude must state that explicitly. Silence is not acceptable.

**Regression Matrix (per-change consumer trace)**

The fixed checklist above is a floor, not a substitute for tracing the specific function being changed. For any shared function or module being modified, Claude must list every actual caller/consumer of it — found by searching the codebase, not recalled from memory — and confirm each one still behaves correctly. Example: a change to `resolve-recipient` must be traced against every consumer that calls it (which may include Voice, Mobile, SMS, Email, Calendar, Geofence, Lists, Global Search, Action Rules, and background jobs — the actual list depends on what's really found, not this example list). Reviews that depend on reviewer memory of "everything that probably calls this" are not acceptable — the consumer list must be produced by searching, and cited.

No code yet.

---

### Phase 3 — Technical Review (Before Coding)

For **Medium** and **High Risk** changes:

The implementation plan is reviewed by ChatGPT before coding begins.

The reviewer evaluates:
- Assumptions
- Architecture
- Isolation
- Hidden coupling
- Implementation strategy

The objective is to prevent incorrect solutions before code exists.

**Implementation Boundaries Confirmed**

Every Phase 3 review must close with an explicit statement of what is authorized, so Phase 4 has a boundary to implement against and Phase 6 has a boundary to audit against — not an inference from the surrounding discussion. State plainly:

- Which files are authorized, and what change in each (not "the general area," the specific file and the specific change).
- That no additional files are approved beyond those listed.
- That no opportunistic refactoring is approved.
- That no architectural changes are approved beyond what the plan describes.
- Which parts of the reviewed plan (if any) are explicitly excluded from this authorization — e.g. a sibling item deferred to a future decision point, or a sub-plan that is investigation-only and not yet cleared for implementation.

Added 2026-07-15, per F19 Track B's Phase 3 review — see `docs/F19_TRACKB_PHASE3_TECHNICAL_REVIEW_2026-07-15.md` for the originating example.

**Deferred Architectural Decisions**

Any architectural idea a reviewer or Claude raises during Phase 3 but explicitly does not approve for the current implementation must be recorded in its own short subsection, separate from the Implementation Boundaries list above — not left implied in the surrounding review prose. State plainly, for each deferred idea:

- What the idea is (one line).
- That it is not approved for this implementation, and why (usually: broader blast radius, premature given current scope, or a generalization not yet justified by enough concrete cases).
- What condition, if any, would make it worth reconsidering later (e.g., "if a third confirmation-gated action type appears").

The purpose is to keep deferred ideas visible without letting them expand the current implementation's scope: a future reviewer or session should immediately recognize a deferred idea as *already considered and intentionally set aside*, not rediscover it as a fresh suggestion and re-litigate it from scratch.

Added 2026-07-15, per F19 Track B's Round 5→6 Phase 3 review — see `docs/F19_TRACKB_PHASE3_TECHNICAL_REVIEW_2026-07-15.md` Round 5/6 for the originating example (the deferred generic `pendingConfirmation` framework).

**Non-Determinism Rule (Prompt / Classifier Changes)**

Live LLM classifier calls are not guaranteed to produce the same routing decision on repeated identical calls, even at temperature 0 — confirmed empirically during B10j (2026-07-17): the identical compound test phrase produced different Layer-2 routing across two live calls with zero code changes in between.

Any change to a Claude/Haiku classifier prompt or Claude system prompt must be validated with a minimum of **3 independent trials** for each positive-control (behavior-changing) test case — never a single call. Phase 5's Evidence Package must report the full distribution of outcomes across all trials, not just a pass/fail summary. A single successful trial is not sufficient evidence that a prompt change works; a single failed trial is not sufficient evidence that it doesn't.

Added 2026-07-18, per B10j's Phase 3 review — see `docs/B10J_PHASE3_TECHNICAL_REVIEW_2026-07-17.md` §1 for the originating empirical finding.

---

### Phase 4 — Implementation

Claude implements only the approved plan.

**No Extra Changes Rule**

Implementation is limited strictly to the approved files and approved behavior.

The following are forbidden unless separately approved:
- Refactoring
- Cleanup
- Renaming
- Optimization
- Unrelated bug fixes
- Style changes

If Claude identifies something worth improving nearby, it must be reported in the Evidence Package as a separate item — never implemented silently.

---

### Phase 5 — Evidence Package

Every completed task includes:

- Summary
- Files changed
- Git Diff
- Tests executed (for prompt/classifier changes, report the full trial distribution per the Non-Determinism Rule in Phase 3 — not a single outcome)
- Manual tests required
- Rollback instructions
- Known risks

If this package is missing, the task is incomplete.

---

### Phase 6 — Technical Review (After Coding)

ChatGPT reviews:
- The Git Diff
- Changed files
- Architecture impact
- Regression risk
- Isolation
- Test coverage

The reviewer must issue four independent verdicts:

- Technical Review: PASS / FAIL
- **Architecture Completeness: PASS / FAIL** — did the implementation increase duplication, reduce duplication, bypass Shared Core, introduce another independent implementation, violate entry-point responsibilities (an entry point implementing business logic instead of translating), change an API contract, change a capability's ownership (per the Ownership Change Rule, §4), or expand what counts as Protected Core? Any of these must be named explicitly, not left for the reviewer to infer from the diff.
- Governance Compliance: PASS / FAIL
- Overall Recommendation: APPROVE / REVISE / REJECT

Numeric scores (for example 9.8/10 or 10/10) are not used because they can hide failures in individual review dimensions.

**Architecture Drift Rule.** As part of the Architecture Completeness verdict, also verify: does the implementation still match what the Architecture Reference claims? Three distinct outcomes, handled differently:
1. **Matches.** Proceed normally.
2. **Diverges because of an intentional, approved architectural change made during this work item.** Not a FAIL — but the Architecture Reference update (Phase 8) becomes a hard precondition for merge, not an optional follow-up.
3. **Diverges for any other reason** — an unapproved change slipped in, or the Reference was already stale before this work started. **Implementation stops.** The discrepancy must be resolved and the Architecture Reference reconciled *before* Phase 6 review is repeated — this is not something to note and continue past. An architecture document that's already known to be wrong is worse than no document, and proceeding on top of a known-wrong map is exactly the failure this entire framework exists to prevent.

**Invalidated Planning Assumption Rule.** When implementation (Phase 4) finds that a Phase 2 plan cannot be carried out exactly as written — without that finding also being an implementation error — Phase 6 shall explicitly record it as a **planning assumption invalidated during implementation**, distinct from an omitted feature or a deliberate scope cut. State what Phase 2 assumed, what Phase 4 discovered instead, and why the assumption didn't hold. This distinction is not cosmetic: a planning error, an implementation error, and a deliberate scope-control decision each point future Phase 2 work toward a different improvement, and collapsing all three into "wasn't done" loses that signal. Added 2026-07-21, per B10o's Phase 6 review — see `docs/B10O_PHASE6_TECHNICAL_REVIEW_2026-07-21.md` §2 for the originating example (Phase 2 planned to extend two merge-path call sites to cover `task_actions` merging; Phase 4 found this required genuine new merge/business logic beyond the fix's stated "readback-text-only" scope).

---

### Phase 7 — Testing

Existing automated testing continues unchanged.

Manual validation remains mandatory for features such as:
- Voice
- Phone
- Geofencing
- Notifications
- Screen behavior
- Permissions
- Background execution
- End-to-end integrations

Passing automated tests alone is not sufficient.

---

### Phase 8 — Merge

A change enters Staging only after:

- ✓ Automated tests pass
- ✓ Manual validation passes
- ✓ External review completed (when required)
- ✓ **Any intentional architectural change has updated the Architecture Reference** (`docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`) **in this same work item** — not deferred to a later cleanup pass. A change that alters what the Architecture Reference claims is not complete until the Reference says so too; otherwise the document goes stale exactly the way it exists to prevent.
- ✓ **No newer Architecture Reference has superseded the version recorded at Phase 1A** (per that phase's Version Verification requirement) without this implementation re-evaluating its assumptions against it.

Production follows the existing release process.

---

## 4. Protected Core

The following areas are considered MyNaavi's Protected Core:

- Voice orchestration
- Action Rules
- Reminder Engine
- Geofencing
- Calendar integration
- Gmail integration
- Authentication
- Permissions
- Background scheduling
- Notification routing
- Database schema
- API contracts

Any modification touching the Protected Core automatically requires technical review before coding and after implementation.

**This governance defines the process. The Architecture Reference (`docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`) defines the implementation boundaries** — the specific files, the ownership, and which capabilities are Shared Core vs. Duplicated vs. Platform-specific. Neither is complete without the other.

**Ownership Change Rule.** A capability's owner (per the Architecture Reference's Ownership Model, §0a) is not changed by implication — moving a capability from one owning component to another (e.g., Shared Core to Voice-only) requires explicit architectural approval from Wael, separate from ordinary Phase-Gate approval for the work item itself, and the Architecture Reference must be updated in the same work item. Silent ownership drift — a capability's real owner changing because of where new code happened to be added, without anyone deciding it should — is exactly the kind of change this rule exists to catch.

---

## 5. Architecture Audit Trigger

Feature development pauses and an Architecture Integrity Audit becomes the highest-priority work item when either condition is met:

- **Duplication threshold:** a fourth confirmed instance of the same "feature added to one of two independently-maintained implementations, never mirrored to the other" pattern is found (three such instances — recipient resolution, channel-preference handling, `task_actions` execution — already existed before the alert-creation classifier duplication became the fourth, per the Architecture Reference's Appendix). A fifth or further instance found after the audit starts does not reset the trigger — the audit, once triggered, runs to completion.
- **Drift-caused regressions:** two or more regressions in the same session or the same week are traced back to an architecture-drift cause (an out-of-date Architecture Reference, or an assumption about sharing that turned out to be false).

When triggered: new feature work stops. The Architecture Integrity Audit (tracked as **T1a** in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`) is scoped and run before any other Protected Core work resumes. This exists so architecture debt is dealt with on a forcing function, not on however much anyone happens to notice it — debt that isn't forced into view stops being tracked and becomes permanent.

### 5a. Architecture Exception

Sometimes duplication (or another architecture-principle deviation) is genuinely the right call for now. That must be recorded as a formal, time-bound exception, not left as an implicit justification buried in a Phase 2 document:

```
Architecture Exception
Capability:
Reason:
Owner approval: (Wael, by name, with date)
Expiration date:
Review date:
```

An exception with no expiration/review date is not an exception — it's an unmanaged, permanent architecture decision wearing an exception's name. When an exception's review date arrives, it must be explicitly renewed (with a new review date) or resolved — it does not silently continue. This is what keeps the Architecture Debt priorities (Architecture Reference §5) from quietly becoming "just how the system works" without anyone deciding that on purpose.

---

## 6. Architectural Decision Records (ADRs)

Many architecture decisions are long-lived and easy to forget the reasoning behind — why Voice has independent reminders, why calendar reads remain duplicated, why classifier duplication is currently accepted. Today that reasoning lives in conversations and governance-phase documents, which is a hard way to answer "why did we do it this way?" six months later.

**Location:** `docs/adr/` — one file per decision, numbered sequentially (`0001-<short-title>.md`, `0002-...`).

**Each ADR must answer:**
- Problem
- Decision
- Alternatives considered
- Why alternatives were rejected
- Consequences (including what this makes harder, not only what it enables)

**When an ADR is required:** any decision to accept duplication instead of unifying it, any decision that a capability is intentionally platform-specific rather than Shared Core, and any decision the Architecture Audit Trigger (§5) surfaces and resolves without full unification.

**ADR Lifecycle.** Every ADR is reviewed annually (or at the next Architecture Audit Trigger, whichever comes first) — confirm the decision, and the reasons behind it, still hold. A temporary decision that is never revisited becomes a permanent one by default, which is exactly the failure mode ADRs exist to prevent. Update the ADR's Status field to note the review date and outcome; if the reasoning no longer holds, mark it Superseded and write a new ADR rather than editing history.

The Architecture Reference should link to ADR numbers for its documented decisions rather than embedding the historical rationale inline — the Reference describes *current state*, the ADR preserves *why it became the current state*.

---

## 7. Cosmetic Change Policy

There is no such thing as a "safe cosmetic change."

A cosmetic change is considered cosmetic only if:
- Only UI files change
- No shared logic changes
- No dependencies change
- No configuration changes
- No backend changes

If any non-UI component changes, the task is reclassified according to its actual risk.

---

## 8. Evidence Before Assumptions

Engineering decisions are based on evidence.

Examples of acceptable evidence:
- Log files
- Error messages
- Git Diff
- Test results
- Official documentation
- Source code references

Statements beginning with *"I think…"*, *"It probably…"*, *"This should…"* are not considered sufficient evidence.

---

## 9. Continuous Improvement

This governance document is expected to evolve.

When Claude identifies weaknesses in this process, its recommendations should be documented.

ChatGPT independently reviews those recommendations.

Wael decides whether to adopt them.

**Governance Change Approval Process.** Any modification to this document requires:

1. A stated problem (what failure mode or gap this addresses).
2. A stated benefit (what it prevents or improves).
3. A concrete example (ideally a real incident, not a hypothetical).
4. External review (ChatGPT).
5. Wael's explicit approval — the same Phase-Gate discipline this document requires of code applies to changing the document itself.
6. A version increment.
7. A changelog entry (§13).

This exists so the document itself doesn't accumulate contradictory or redundant rules the way any of the systems it governs could — the same discipline, turned on itself.

---

## 10. Approval Philosophy

Neither Claude nor ChatGPT approves code.

Both provide engineering recommendations.

The Product Owner makes the final decision.

**This includes every phase transition, not just the final release decision.** See Section 3's Phase-Gate Approval Rule — a reviewer's "Approved" verdict is a recommendation Wael considers, never authorization Claude acts on directly.

---

## 11. Golden Rules

- Small branches
- Small commits
- Evidence before coding
- Review before implementation for important changes
- Review after implementation
- Protect the Protected Core
- Never approve a change because the explanation sounds convincing
- Approve only after reviewing the evidence
- Never assume a capability is shared
- Verify every shared implementation against the current Architecture Reference
- Every duplicated capability must be evaluated on every change, not just the side you're already looking at
- Architecture evidence overrides assumptions

---

## 12. Long-Term Objective

The purpose of this process is to build an engineering culture where:

- AI generates code
- AI challenges AI
- Evidence outweighs assumptions
- Stable software becomes more valuable than rapid software
- Every release increases confidence rather than increasing uncertainty

---

## 13. Changelog

Every governance change is recorded here, per §9's Governance Change Approval Process.

- **v2.2 → v3.0:** original Release Gate Workflow, predates this session's revisions.
- **v3.0 → v3.1 (2026-07-18):** merged two independently-evolved v3.0 drafts into one canonical file. Added: Architecture Reference companion-document link, Phase 1A Architecture Completeness Review with Architecture Scope Rule, Non-Determinism Rule (Phase 3), Phase 2 Change Impact Matrix, Phase 6 four-verdict structure (numeric scores removed).
- **v3.1 → v3.2 (2026-07-18):** capability-owner question in Phase 1, Mandatory Architecture Impact Checklist (Phase 2), Phase 6 architecture-drift check, Architecture Reference update as a Phase 8 merge precondition.
- **v3.2 → v3.3 (2026-07-18):** per-change Regression Matrix (Phase 2), Phase 6 drift check escalated to a three-outcome rule with a hard stop for unapproved drift, new §5 Architecture Audit Trigger, Cross-Repository Verification Rule named alongside the Architecture Scope Rule.
- **v3.3 → v3.4 (2026-07-18):** Architecture Reference Version Verification (Phase 1A + Phase 8), Ownership Change Rule (§4), Architecture Exception format (§5a), new §6 Architectural Decision Records (ADRs), explicit Governance Change Approval Process checklist (§9), this Changelog (§13).
- **v3.4 → v3.5 (2026-07-18):** Phase 6's Architecture Completeness checklist gained an explicit "ownership changed?" item; ADR Lifecycle rule added (annual review or next Audit Trigger, whichever first); the Phase 1A known-limitation note now explicitly names the Architecture Audit Trigger as the long-horizon compensating mechanism. Companion edits in the Architecture Reference: formal dated version identifier, Diagram Version label, explicit Architecture Owner statement, and four backfilled ADRs (`docs/adr/0001`-`0004`) linked from the Reference instead of embedding rationale inline.
- **v3.5 (2026-07-18):** finalized as the project's canonical governance document, replacing the prior `docs/AI_DEVELOPMENT_GOVERNANCE.md` (v2.2).
- **v3.5 → v3.6 (2026-07-21):** Phase 6 gained the Invalidated Planning Assumption Rule — when Phase 4 finds a Phase 2 plan can't be carried out exactly as written, without that being an implementation error, Phase 6 must record it as an invalidated planning assumption, distinct from an omitted feature or a deliberate scope cut. Per §9's Governance Change Approval Process: problem/benefit/example stated, external review done, Wael's explicit approval given, this changelog entry. Originating example: `docs/B10O_PHASE6_TECHNICAL_REVIEW_2026-07-21.md`.
