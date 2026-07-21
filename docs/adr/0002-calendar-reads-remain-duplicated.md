# ADR 0002 — Calendar live-reads remain duplicated between mobile and voice

**Status:** Accepted (as an Architecture Exception, lower priority than ADR-0001)
**Date:** 2026-07-18
**Related:** Architecture Reference §2 (Calendar — reads), §5 Priority 2

## Problem

Both `naavi-chat` and `naavi-voice-server` independently call the Google Calendar API directly to answer "what's on my calendar" style questions, rather than sharing one fetch. Calendar *writes* (create/delete event) already go through shared Edge Functions (`create-calendar-event`, `delete-calendar-event`) — only the live-read path is duplicated.

## Decision

**No deliberate decision record exists for this either.** Both read implementations most likely grew independently because each surface needed calendar data at a different point in its own development, and nobody revisited to unify them once both existed. This is documented here as an honest acknowledgment of drift, not a rationalized design choice.

```
Architecture Exception
Capability: Calendar live reads
Reason: Lower severity than the classifier duplication (ADR-0001) — a stale or slightly-different read doesn't misdirect a message to a real person, it at worst shows slightly different calendar data on the two surfaces. Not yet prioritized above Priority 1.
Owner approval: Wael, 2026-07-18 (T1a Phase 4 execution, per his explicit "Go - Phase 4")
Expiration date: 2027-07-18
Review date: 2027-07-18, or the next Architecture Audit Trigger (Governance §6 ADR Lifecycle), whichever comes first
```

## Alternatives Considered

1. Extract a shared "get live calendar events" Edge Function or shared module both sides call.
2. Leave as-is, since calendar writes are already correctly shared and the read-path risk is lower.

## Why Rejected

Neither alternative has actually been evaluated in depth — this item has not received the same investigation ADR-0001 got. It's listed as Priority 2 in the Architecture Debt table specifically because it's real but less urgent, not because unification was considered and found not worth it.

## Consequences

- A future fix to one side's calendar-read logic (e.g., timezone handling, a Google API rate-limit workaround) will not automatically reach the other side — the same Cross-Repository Verification discipline from ADR-0001 applies here too.
- Lower real-world severity than ADR-0001's classifier duplication, which is why it's ranked below it, not why it's ignored.
