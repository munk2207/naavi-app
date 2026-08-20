# ADR 0006 — Gmail live reads remain duplicated between mobile and voice

**Status:** Accepted (as an Architecture Exception, lower priority than ADR-0001/0005)
**Date:** 2026-07-18
**Related:** Architecture Reference §2 (Gmail — live/recent read), §5 Priority 3; `docs/T1A_PHASE3_TECHNICAL_REVIEW_2026-07-18.md` §2a

## Problem

Both `naavi-chat` and `naavi-voice-server` independently call the Gmail API directly to answer "what's new in my inbox" style requests, separate from the genuinely-shared `sync-gmail` background cron (which writes to `gmail_messages` and is not duplicated). Confirmed directly, not assumed, during T1a Phase 3's implementation-strategy verification (`docs/T1A_PHASE3_TECHNICAL_REVIEW_2026-07-18.md` §2a):

- `supabase/functions/naavi-chat/index.ts:1126,1176` — direct `gmail.googleapis.com/gmail/v1/users/me/messages` fetch calls.
- `naavi-voice-server/src/index.js:730,748` **and**, separately, `:1467,1484` — voice has **two** independent live-fetch call sites of its own (not one), neither routed through `sync-gmail`.

No confirmed drift incident exists for this capability (unlike ADR 0001/0005, which both formalize duplication that has already produced real, documented incidents) — this ADR records a verified-duplicated, not-yet-incident-tested capability, the same category ADR 0002 (Calendar reads) already occupies.

## Decision

**No deliberate decision record exists for this either**, matching ADR 0002's own honest admission for Calendar reads. Both read implementations most likely grew independently because each surface needed live Gmail data at a different point in its own development, with no revisit once both existed.

```
Architecture Exception
Capability: Gmail live reads
Reason: Lower severity than ADR-0001/0005 — a stale or slightly-different "what's new" read doesn't misdirect a message to a real person or drop a promised send, it at worst shows slightly different inbox data on the two surfaces. Not yet prioritized above Priority 1/1-adjacent. Additionally, voice's own two independent call sites (not unified even with each other) suggest the risk, if any, may be as much intra-voice as mobile-vs-voice — noted for a future investigation, not resolved here.
Owner approval: Wael, 2026-07-18 (T1a Phase 4 execution, per his explicit "Go - Phase 4")
Expiration date: 2027-07-18
Review date: 2027-07-18, or the next Architecture Audit Trigger (Governance §6 ADR Lifecycle), whichever comes first
```

## Alternatives Considered

1. Extract a shared "get live Gmail messages" Edge Function or shared module both sides call.
2. Leave as-is, since `sync-gmail`'s background sync path is already correctly shared and the live-read path's risk is lower.

## Why Rejected

Neither alternative has been evaluated in depth — this item has not received the same investigation ADR-0001/0005 got, and per T1a Phase 2's own audit-depth decision (§2 Q1), items without a confirmed incident get a shallow verification-of-duplication check, not a full incident-style Phase 1. It's ranked below Priority 1/1-adjacent specifically because it's real but less urgent, not because unification was considered and found not worth it.

## Consequences

- A future fix to one side's Gmail-read logic (a rate-limit workaround, a formatting change, a new signal-strength rule) will not automatically reach the other side, or voice's own second internal call site — the same Cross-Repository Verification discipline from ADR-0001/0005 applies here too.
- Lower real-world severity than ADR-0001/0005, which is why it's ranked below them, not why it's ignored.
