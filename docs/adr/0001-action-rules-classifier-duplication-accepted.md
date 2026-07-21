# ADR 0001 — Action Rules classifier duplication (mobile vs. voice) accepted for now

**Status:** Accepted (as an Architecture Exception, not a permanent design)
**Date:** 2026-07-18
**Related:** [[B10j]], [[B10k]], [[T1a]] in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`; Architecture Reference §2a, §5 Priority 1

## Problem

When a user asks to create an alert ("remind me when I arrive at Costco," "text Bob at 9am"), mobile and voice each need to turn that natural-language request into a structured `SET_ACTION_RULE`. Today they do this with two completely independent implementations: mobile's `naavi-chat` classifier (`classifyIntent` + `buildActionConfirm`), and voice's own "ARCH-1" classifier plus full Claude reasoning loop inside `naavi-voice-server/src/index.js`. A fix to one does not reach the other — confirmed directly by B10j, where a classifier fix shipped to mobile had zero effect on voice callers, discovered only after a direct question ("will we test voice platform?") rather than by any process step.

## Decision

**No deliberate decision record exists for why these are separate implementations.** This ADR exists specifically to stop pretending otherwise. Based on the system's structure, the most likely explanation is that voice's classifier was built to fit its own runtime constraints (a persistent Twilio WebSocket session with real-time turn-taking latency requirements, versus mobile's per-request HTTP call to a Supabase Edge Function) — but this is inference, not a confirmed fact, and has not been independently verified against any historical record of the decision actually being evaluated this way.

What *is* being decided here, explicitly, for the first time: **the duplication is accepted for now as a tracked Architecture Exception, not silently continued as an unexamined default.**

```
Architecture Exception
Capability: Action Rules creation (classifier)
Reason: Unifying requires either (a) voice calling mobile's naavi-chat Edge Function for every classification decision (latency impact on a live phone call unverified), or (b) voice re-implementing mobile's full classifier logic in a second, still-independently-maintained copy (the same failure mode this exception is about, just moved). Neither has been evaluated with real data yet.
Owner approval: Wael, 2026-07-18 (T1a Phase 4 execution, per his explicit "Go - Phase 4")
Expiration date: 2027-07-18
Review date: 2027-07-18, or the next Architecture Audit Trigger (Governance §6 ADR Lifecycle), whichever comes first
```

## Alternatives Considered

1. **Voice calls mobile's `naavi-chat` Edge Function for classification.** Removes the duplication entirely. Risk: added network round-trip latency during a live phone call, unmeasured. Not yet prototyped or measured.
2. **Voice re-implements mobile's classifier logic as a second, matched copy.** Does not remove duplication — it's the exact pattern that caused B10j/B10k. Rejected on principle (Architecture Reference §7, Decision Rule 1: shared logic belongs in Shared Core, not two maintained copies).
3. **Leave as-is, track as debt.** Chosen for now, formalized as the Architecture Exception above — not because it's the right end state, but because a real latency measurement is needed before choosing between options 1 and 2, and that measurement hasn't been done.

## Why Rejected

Option 2 is rejected on architectural principle, not just practicality — it doesn't solve the problem, it relocates it. Option 1 isn't rejected, it's simply unevaluated — no one has measured whether calling a Supabase Edge Function mid-call is fast enough for voice's UX. That measurement is the actual next step, not yet started.

## Consequences

- Any fix to alert-creation classification must be evaluated against **both** implementations separately, every time (Governance §1's Cross-Repository Verification Rule / Architecture Scope Rule exists specifically because of this).
- Voice callers do not benefit from mobile-side classifier fixes (and vice versa) until this is resolved.
- This is Priority 1 in the Architecture Reference's Current Architecture Debt (§5) and the condition that (partly) satisfies the Architecture Audit Trigger (§5) — it was the fourth confirmed instance of the duplicated-implementation pattern.
