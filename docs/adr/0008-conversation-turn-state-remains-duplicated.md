# ADR 0008 — Conversation/turn state (pending confirmations) remains duplicated between mobile and voice

**Status:** Accepted (as an Architecture Exception — technical constraint, not just unprioritized debt)
**Date:** 2026-07-18
**Related:** Architecture Reference §2 (Conversation/turn state); `docs/T1A_PHASE2_CHANGE_PLAN_2026-07-18.md` §2 Q1 (flagged "likely Deferred rather than Accepted," resolved below); `docs/T1A_PHASE3_TECHNICAL_REVIEW_2026-07-18.md` §2a

## Problem

Mobile and voice each track "what are we in the middle of confirming" independently, using structurally different mechanisms. Confirmed directly during T1a Phase 3's verification (`docs/T1A_PHASE3_TECHNICAL_REVIEW_2026-07-18.md` §2a):

- Mobile: a `PendingAction` type (`lib/voice-confirm.ts`, consumed by `hooks/useOrchestrator.ts:43`) — client-side React Native state, alive only as long as the app's in-memory session persists.
- Voice: a `pending_confirm` state value (`naavi-voice-server/src/index.js:254`) plus its own surrounding pending-action tracking logic (documented in-file comments, e.g. a 2026-05-06 incident note about pending-location state surviving 31 minutes) — server-side state tied to a live Twilio WebSocket call session.

Neither reads the other's state. A pending confirmation started on one surface is invisible to the other.

## Decision

**Unlike ADR 0002/0006/0007 (duplication that's simply gone unexamined) and closer to ADR 0004's shape (a real technical constraint), this one has a substantive reason to remain duplicated, not just unprioritized debt.** Mobile's `PendingAction` is scoped to a React Native app session with no persistent server-side call; voice's `pending_confirm` is scoped to a live phone call's WebSocket session with real-time turn-taking and no equivalent client state to read from. There is no shared "session" concept between the two runtimes today for a unified state store to live in — unifying this would require either a new persistent server-side session layer neither surface currently has, or accepting cross-surface confirmation hand-off (a phone call resuming a confirmation started in the app, or vice versa) as an explicit product feature, which has not been requested or scoped.

This resolves the "likely Deferred rather than Accepted" hedge Phase 2 §2 Q1 left open: given the technical reasoning above is concrete and available now (not merely "we haven't looked"), **Accepted** is the more accurate disposition than Deferred — the difference matters per T1a's own Audit Success Criteria (`docs/T1A_PHASE1_PROBLEM_DEFINITION_2026-07-18.md` §6): Accepted means "we're choosing to keep this, for a stated reason," Deferred means "not yet decided." This capability has a reason; it does not merely lack a decision.

```
Architecture Exception
Capability: Conversation/turn state (pending confirmations)
Reason: Mobile and voice have no shared session-state layer to unify into — mobile's PendingAction is React Native in-memory app state; voice's pending_confirm is a live Twilio WebSocket call's server-side state. Unifying would require a new persistent cross-runtime session store (not currently justified by any requested cross-surface confirmation-handoff feature) rather than a simple shared-module extraction, unlike ADR 0005's fan-out pattern.
Owner approval: Wael, 2026-07-18 (T1a Phase 4 execution, per his explicit "Go - Phase 4")
Expiration date: 2027-07-18
Review date: 2027-07-18, or the next Architecture Audit Trigger (Governance §6 ADR Lifecycle), whichever comes first
```

## Alternatives Considered

1. **Build a shared, persistent cross-runtime session-state store** (e.g., a `pending_confirmations` table both surfaces read/write, keyed by user) that either surface could resume from. Not evaluated in depth — no product requirement currently calls for a user to start a confirmation on one surface and finish it on another; this would be new capability, not just deduplication.
2. **Leave as-is**, since each surface's confirmation flow works correctly in isolation today, and cross-surface hand-off has never been requested. **Chosen.**

## Why Rejected

Option 1 isn't rejected on cost grounds alone — it would introduce genuinely new product behavior (cross-surface confirmation resumption) that hasn't been scoped, requested, or evaluated for whether it's even desirable (a confirmation started mid-phone-call resuming silently in the app could itself be confusing). This is different from ADR 0001/0005/0006/0007, where the rejected alternative was "unify existing, already-equivalent logic" — here, "unifying" would mean building something that doesn't exist on either side today.

## Consequences

- A confirmation flow bug fixed in one surface's turn-state handling (e.g., the 2026-05-06 pending-location-state-survived-31-minutes incident referenced in voice's own code comments) does not automatically reveal whether an equivalent bug exists in mobile's `PendingAction` handling, or vice versa — Cross-Repository Verification still applies to *bug-fixing* this logic even though *unifying* it is not currently in scope.
- If a future product decision calls for cross-surface confirmation hand-off, this ADR's "no shared session layer" reasoning becomes the starting point for that design, not a blocker — Alternative 1 above is the concrete shape that decision would need to evaluate.
