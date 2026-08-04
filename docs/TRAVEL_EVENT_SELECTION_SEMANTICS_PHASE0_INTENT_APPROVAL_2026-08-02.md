# Travel Event Selection Semantics (Ticket B) — Phase 0 — Intent Approval

**Date:** 2026-08-02
**Governance version:** v4.0
**Origin:** Split from `docs/CALENDAR_CONTEXT_RELIABILITY_*` per Wael's mandatory scoping change, 2026-08-02 — kept separate so the proven client-brief/schema-drift defect (Ticket A) and this open reasoning question (Ticket B) don't become intertwined in one implementation plan.

## Background (supporting record — not a governance field)

With the client-brief defect isolated (Ticket A), a distinct question remains, proven NOT to be a data-availability problem (Phase 1A, `docs/CALENDAR_CONTEXT_RELIABILITY_PHASE1A_LIVE_CONTEXT_TRACE_2026-08-02.md`):

- "Drive me to my next event" correctly selected Gym class (chronologically earliest, correctly fetched).
- "Drive me to my next meeting" and "Drive me to my next appointment" consistently did **not** select Gym class, even when it was proven present and correctly ordered in the same underlying fetched data.
- "Drive me to my next appointment," asked twice on a live phone call, selected two different events across the two attempts.

This is Claude's own reasoning behavior over an already-correct event list — not a fetch, filter, or serialization defect.

## User Intent

Determine why Claude's event selection for travel-time requests is inconsistent and appears to apply an undocumented semantic filter (treating "meeting" and "appointment" as excluding some real calendar events, like a personal recurring "Gym class"), and why identical repeated requests can select different events.

## Success Criteria

Each answered with direct evidence (multiple live trials, not single-call inference):

1. Does "next meeting" reliably exclude non-work/personal events (e.g., Gym class) across many trials, or was the 3/3 consistency observed so far coincidental?
2. Does "next appointment" reliably select a different event than "next meeting" for the same calendar state, and is that distinction intentional/desirable or an artifact?
3. What specifically caused two consecutive identical "next appointment" asks (on the live phone call) to select different events — is conversation history the mechanism, as it was proven to be for the named-event false-negative in Ticket A, or something else?
4. Is there a documented or undocumented ranking/filter Claude appears to be applying beyond RULE 7's literal instruction ("pick the one with the earliest future start")? RULE 7's actual text (`get-naavi-prompt/index.ts:699`) does not mention event-type filtering — if Claude is doing this anyway, is it desirable product behavior worth documenting and locking in, or an inconsistency worth prompting away?
5. Does conversation history state (proven as a contributing factor in Ticket A) also explain event-selection inconsistency, not just data-availability false negatives?

## In Scope

- Live, multi-trial investigation of RULE 7's event-selection behavior (`get-naavi-prompt/index.ts`), using calendar data confirmed correct and complete (i.e., after Ticket A's schema fix lands, so this investigation isn't confounded by the already-proven separate defect).
- Determining whether this is a prompt-clarity gap (RULE 7 doesn't specify what "meeting" means, so Claude improvises) versus genuine non-determinism.

## Out of Scope

- The client-brief / staging-schema-drift defect — closed as Ticket A, not reopened here.
- Any change to `fetchLiveCalendarEvents`, `resolve-place`, or `get-travel-time` — all already proven correct in prior work.
- The three-independent-calendar-implementations architecture finding — flagged separately as its own Architecture Governance item, not part of either ticket.
- Voice — this behavior has not been observed or reproduced on voice; out of scope unless this investigation finds a shared cause.

## Constraints

- This investigation should run **after** Ticket A's schema fix is live on staging, so results aren't confounded by the already-diagnosed data-availability defect.
- Multiple live trials required per the Non-Determinism Rule (governance §3) — no conclusion from a single call.
- No code changes in this phase.

## Completion Criteria

All 5 Success Criteria items answered with direct, multi-trial evidence. A clear statement of whether the observed behavior is prompt-following inconsistency (fixable) or a genuine gap in RULE 7's instructions (needs a prompt change) — root cause not assumed, proven per this project's standing discipline.

---

**Status:** Awaiting Wael's explicit approval to proceed to Phase 1.
