# B10r — Phase 3 (Addendum 2 scope): Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.7, Phase 3. Filed retroactively per `feedback_governance_every_phase_needs_its_document` — the review below was delivered directly via chat (Wael relaying ChatGPT's verdict) without a corresponding doc file at the time; this file makes it a real record, closing the gap identified during this session's own audit of B10r's phase trail.

**Subject:** `docs/B10R_PHASE2_ADDENDUM2_CALENDAR_CHANGE_PLAN_2026-07-22.md`. Reviewer's own scope statement: *"My review is limited to the new calendar.ts work and its proposed implementation strategy."* Does not reopen or revise the original scope's Phase 3 (`docs/B10R_PHASE3_TECHNICAL_REVIEW_2026-07-22.md`).

---

## 1. Review (2026-07-22) — for the record

**Executive summary:**

| Review Area | Verdict |
|---|---|
| Assumptions | PASS |
| Architecture | PASS |
| Isolation | PASS |
| Hidden Coupling | PASS |
| Implementation Strategy | PASS |

**Overall Recommendation: APPROVE.**

**What the plan does particularly well, per the reviewer:**

1. **Fixes the problem at the correct architectural boundary.** The change lives in the Shared Core Calendar adapter itself, rather than in any downstream consumer (Claude prompt logic, mobile deterministic handler, voice deterministic handler) — *"That is the cleanest architectural boundary."*
2. **The gating logic is well chosen.** Endorsed rejecting a title-only match: a genuine one-time event like "Sarah's 50th Birthday Party" is fundamentally different from Google's auto-generated recurring birthday calendar. Requiring both `recurringEventId` presence and birthday/anniversary title wording "substantially reduces false positives while still targeting the actual defect."
3. **Scope control remains excellent.** The implementation deliberately avoids touching `intentHandlers.ts`, the voice deterministic handler, prompt logic, or the Contacts implementation — those components simply consume improved Shared Core data, keeping the change aligned with Phase 1A's architectural decision.
4. **Regression strategy is appropriate.** Positive cases (recurring birthday, recurring anniversary) and negative cases (ordinary recurring event, one-time birthday party, ordinary event) together give good confidence the gating logic behaves as intended.

**Hidden coupling review:** the reviewer specifically checked for new hidden dependencies. The implementation depends on Google's `recurringEventId`, the existing `singleEvents=true` expansion, and title text containing birthday/anniversary wording — all explicitly documented in the design rationale rather than implicit. **Classified as documented and acceptable coupling**, not a rejection reason.

**Risk assessment:** agreed with the **Medium** classification — Protected Core Calendar integration, Shared Core modification, multiple downstream consumers, but no API contract change, no database/schema change, no write-path change, no consumer change.

---

## 2. Implementation Boundaries Confirmed

**Authorized:**

| File | Authorized change |
|---|---|
| `supabase/functions/global-search/adapters/calendar.ts` | Add `recurringEventId`; implement gated year suppression for recurring birthday/anniversary events. |
| `tests/catalogue/session-2026-07-22-b10r-contact-birthdays.ts` | Extend with Calendar-adapter regression tests. |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | Update after successful completion. |

**Not authorized:** `intentHandlers.ts`, `arch1HandlePersonLookup`, the Contacts adapter, prompt logic, architecture consolidation, ARCH-1 duplication cleanup — per the reviewer, these exclusions are appropriate and preserve the narrow scope of this change.

- No additional files are approved beyond the table above.
- No opportunistic refactoring, renaming, or cleanup is approved.
- No architectural changes beyond the gated year-suppression logic described in Phase 2 (Addendum 2) are approved.

---

## 3. Deferred Architectural Decisions

- **Idea:** the recurring-birthday/anniversary detection relies on English keywords (`birthday`, `anniversary`, `bday`) matched against the event title.
- **Not approved for expansion now** — the reviewer's own framing: *"reasonable for the documented defect, but it implicitly assumes those recurring event titles use recognizable English terms... this is simply a future consideration rather than a flaw in the current plan."* Not a blocker to this implementation.
- **Reconsider if:** localized Google Calendar titles or non-English naming conventions for auto-generated birthday/anniversary entries become a live requirement.

---

## 4. Status

Review received 2026-07-22 — **APPROVE** across all five review areas (Assumptions, Architecture, Isolation, Hidden Coupling, Implementation Strategy). No revisions requested; one non-blocking observation recorded in §3. Phase 4 proceeded on this authorization — the `calendar.ts` diff and test additions in `docs/B10R_PHASE5_EVIDENCE_2026-07-22.md` implement exactly the boundaries in §2 above, confirmed by direct code read (no file outside this scope was touched by the Addendum 2 change).

Per the Phase-Gate Approval Rule, this reviewer verdict is a recommendation, not authorization — Wael's own separate, explicit go-ahead was the actual authorization for Phase 4 to proceed, consistent with how this addendum was actually carried out.
