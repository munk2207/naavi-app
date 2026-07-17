# MyNaavi AI Development Governance — Release Gate Workflow

Version 2.2

## Purpose

This document defines the mandatory engineering process for all AI-assisted development of MyNaavi.

The objective is not to prevent AI from making mistakes.

The objective is to build a development process where mistakes are detected before they become expensive.

This document applies to every contributor, including AI coding assistants.

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

This applies to every phase transition without exception: Phase 1→2, 2→3, 3→4, 4→5, 5→6, 6→7, 7→8, and promotion to production after Phase 8. It also applies to closing a phase on alternative evidence instead of a live test that proved impractical (e.g. accepting simulation + automated tests in place of an unreproducible manual test) — that is itself a phase-gate decision and needs Wael's explicit sign-off, not Claude's own judgment call.

**Why this rule exists:** violated twice in the same session (2026-07-17, F5c) before being made explicit here — Claude opened the next phase's document on the strength of the reviewer's "Approved" verdict alone, without first getting Wael's own separate word. Reviewer approval answers "is this technically sound?" — only Wael answers "do we proceed?" Conflating the two lets review quality substitute for product ownership, which defeats the entire purpose of Section 1's role split. See `feedback_governance_phase_gate_wait` in memory for the incident record.

---

### Phase 1 — Problem Definition

Before any code is written Claude must answer:

- What exactly is broken?
- What evidence proves the problem?
- What is the root cause?
- What alternatives were considered?

**No Assumptions Rule**

Claude must not use the words "probably" or "likely" without direct evidence.

Every root cause statement must include at least one of: file path, function name, log line, database row, screenshot, or test result.

If direct evidence is missing, Claude must state: **"Root cause not proven."** No fix is proposed until the root cause is proven.

No code is written during this phase.

---

### Phase 2 — Change Planning

Claude provides:

- Files that will change
- Classification of every file: UI / Shared Logic / Backend / Configuration / Dependency / Database
- Explanation for every modification
- Risk classification: Low / Medium / High

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
- Tests executed
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

Possible outcomes: **APPROVE** / **REVISE** / **REJECT**

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

---

## 5. Cosmetic Change Policy

There is no such thing as a "safe cosmetic change."

A cosmetic change is considered cosmetic only if:
- Only UI files change
- No shared logic changes
- No dependencies change
- No configuration changes
- No backend changes

If any non-UI component changes, the task is reclassified according to its actual risk.

---

## 6. Evidence Before Assumptions

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

## 7. Continuous Improvement

This governance document is expected to evolve.

When Claude identifies weaknesses in this process, its recommendations should be documented.

ChatGPT independently reviews those recommendations.

Wael decides whether to adopt them.

---

## 8. Approval Philosophy

Neither Claude nor ChatGPT approves code.

Both provide engineering recommendations.

The Product Owner makes the final decision.

**This includes every phase transition, not just the final release decision.** See Section 3's Phase-Gate Approval Rule — a reviewer's "Approved" verdict is a recommendation Wael considers, never authorization Claude acts on directly.

---

## 9. Golden Rules

- Small branches
- Small commits
- Evidence before coding
- Review before implementation for important changes
- Review after implementation
- Protect the Protected Core
- Never approve a change because the explanation sounds convincing
- Approve only after reviewing the evidence

---

## 10. Long-Term Objective

The purpose of this process is to build an engineering culture where:

- AI generates code
- AI challenges AI
- Evidence outweighs assumptions
- Stable software becomes more valuable than rapid software
- Every release increases confidence rather than increasing uncertainty
