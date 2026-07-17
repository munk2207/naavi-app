# F5c — Phase 3: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3. Subject: `docs/F5C_PHASE2_CHANGE_PLAN_2026-07-17.md`, **Approved (Round 2)** per that document's own §7 — the substantive review (assumptions, architecture, isolation, implementation strategy) already ran there, across two rounds, before this document was opened, per Wael's explicit instruction not to open a Phase 3 document until Phase 2 itself carried a full approval verdict. This document does not repeat that review — it formalizes the two elements governance requires specifically of Phase 3: an explicit Implementation Boundaries statement and a record of any deferred architectural ideas, ahead of Phase 4.

Required because the plan touches Protected Core (Action Rules, Notification routing) and is classified High Risk.

---

## 1. Basis for this review

Phase 2 (`docs/F5C_PHASE2_CHANGE_PLAN_2026-07-17.md`) §7 records:
- Round 1 feedback (two required changes: reframe the length guard as defense-in-depth, not the correctness guarantee; split logging into distinct named reasons) — both adopted, changes itemized in §7.
- Round 2 confirmation of the revised text — "complete alignment with the approved Phase 1, clear implementation boundaries, no scope creep, proper distinction between correctness and defense-in-depth, measurable acceptance criteria, thorough regression analysis, clear audit trail."
- **Verdict: Approved (Round 2).**

Nothing in this document reopens that approval. §2-4 below are the formal artifacts governance's Phase 3 requires in addition to the review itself.

---

## 2. Implementation Boundaries Confirmed

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3's Implementation Boundaries requirement:

- **Authorized file:** `supabase/functions/evaluate-rules/index.ts` only.
- **Authorized change, exactly as specified in Phase 2 §2(a)/(b)/(c):**
  - (a) — defense-in-depth name-shape guard (`to_name.trim().length < 2` → skip lookup, log `name_too_short`).
  - (b) — the correctness guarantee: replace unconditional `data.contacts?.[0]` with an exact-count check (`matches.length === 1` → resolve; `0` → log `zero_matches`; `2+` → log `ambiguous_multiple_matches`).
  - (c) — add a `no_resolved_destination` log line to the existing `taskSends` filter step, closing the current silent-drop gap.
- **No additional files are approved.** Not `lookup-contact/index.ts`, not `naavi-chat/index.ts`, not `naavi-voice-server/src/index.js` — all three are explicitly out of scope per Phase 2 §5.
- **No opportunistic refactoring is approved.** The primary self/third-party alert fan-out logic in the same function (`evaluate-rules/index.ts`, ~lines 950-1063) is not touched, renamed, or reorganized while the file is open for this change.
- **No architectural changes are approved beyond what Phase 2 describes.** No new fields, no schema/migration, no new table, no confirmation/interactive path added at fire time (Phase 1 §6 and Phase 2 §2(b) both establish none is possible at fire time — an unattended process has no user to confirm with).
- **Explicitly excluded from this authorization** — each would need its own Phase 1/2/3, not implied by this approval:
  - Mobile's first-entry-only `task_actions` resolution gap (`naavi-chat/index.ts:4104-4169`, Phase 1 §2.5).
  - Voice gaining its own write-time recipient resolution/disambiguation (Phase 1 §6 item 4).
  - The upstream "why did 'abc' become three single-letter entries" investigation (Phase 1 §2.4, root cause not proven).

---

## 3. Deferred Architectural Decisions

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3's Deferred Architectural Decisions requirement:

**Idea:** treat recipient resolution as a single, authoritative Protected Core service — one decision path (one match → proceed, zero → fail, multiple → ambiguity/fail-closed, never guess) called by every surface and every execution point, replacing the current three independently-drifting implementations (mobile, fire-time, voice-absent).

**Not approved for this implementation.** First raised and explicitly deferred in Phase 1 §7 ("Deferred architectural recommendation") — broader blast radius than this incident requires; touches every existing caller of `lookup-contact` across both surfaces, not just the one proven-broken call site; premature to design before this narrower fix has shipped and been confirmed sufficient.

**Condition for reconsidering:** a third independent recipient-resolution call site is found to have drifted the same way (mobile's first-entry-only gap, §2 above, is arguably already the second), or the fail-closed fix from this Phase 2/3 ships and a subsequent incident shows call-site-by-call-site patching isn't holding up.

---

## 4. Outcome

**Implementation is authorized only within the boundaries defined in §2.** Any change outside those boundaries requires returning to Phase 2 (or Phase 1, if new evidence changes scope). No code has been written under this document. Phase 5 (Evidence Package) and Phase 6 (Technical Review After Coding) follow implementation, per governance.

**Review record:** reviewer confirmed this document satisfies Phase 3's responsibilities — confirming the approved technical basis, establishing explicit implementation boundaries, recording deferred architectural decisions, preventing opportunistic expansion during coding, and authorizing progression to Phase 4 without reopening previously approved decisions. **Verdict: Approved.** "The implementation may proceed to Phase 4 provided it remains strictly within the implementation boundaries documented in Section 2 of this Phase 3 review."

**Separate from document approval:** per this project's standing rule (`feedback_governance_phase_gate_wait`), reviewer/document approval of a phase is not the same as Wael's own go-ahead to start the *next* phase's work. This document being Approved authorizes its own content; it does not, by itself, start Phase 4. Phase 4 begins only when Wael says so explicitly, in a separate instruction.
