# ADR 0007 — List reads remain duplicated between mobile and voice

**Status:** Accepted (as an Architecture Exception, lower priority than ADR-0001/0005)
**Date:** 2026-07-18
**Related:** Architecture Reference §2 (List reading); `docs/T1A_PHASE3_TECHNICAL_REVIEW_2026-07-18.md` §2a

## Problem

List *writes* go through the genuinely-shared `manage-list` Edge Function (both mobile-backend and voice call it — not duplicated). List *reads* do not: both sides independently query the `lists` table directly, using different client mechanisms for the same underlying pattern. Confirmed directly during T1a Phase 3's implementation-strategy verification (`docs/T1A_PHASE3_TECHNICAL_REVIEW_2026-07-18.md` §2a):

- `supabase/functions/naavi-chat/index.ts:1328` — Supabase JS client, `.from('lists')`.
- `naavi-voice-server/src/index.js:322,428,476,2117` — raw REST fetch, `${SUPABASE_URL}/rest/v1/lists?...` (voice's runtime uses direct REST rather than the Supabase JS client; functionally the same direct-table-read pattern, four separate call sites of its own).

No confirmed drift incident exists for this capability — recorded here as verified-duplicated, not incident-tested, the same category as ADR 0002/0006.

## Decision

**No deliberate decision record exists for this either.** Each surface most likely queries `lists` directly at the specific point it needs list data (voice: for read-aloud/lookup during a call; mobile: for the various list-display and orchestration paths in `naavi-chat`), with no revisit once both patterns existed independently, matching the same drift shape ADR 0002/0006 already describe for their own capabilities.

```
Architecture Exception
Capability: List reads
Reason: Lower severity than ADR-0001/0005 — a stale or slightly-different list-contents read doesn't misdirect a message or drop a promised send, it at worst shows outdated list contents on one surface. Not yet prioritized above Priority 1/1-adjacent. Voice's four independent call sites (not unified even with each other) are noted as a smaller, related risk for a future investigation, not resolved here.
Owner approval: Wael, 2026-07-18 (T1a Phase 4 execution, per his explicit "Go - Phase 4")
Expiration date: 2027-07-18
Review date: 2027-07-18, or the next Architecture Audit Trigger (Governance §6 ADR Lifecycle), whichever comes first
```

## Alternatives Considered

1. Extract a shared "read list contents" Edge Function or shared module both sides call, mirroring `manage-list`'s existing role for writes.
2. Leave as-is, since list writes are already correctly shared and the read-path risk is lower.

## Why Rejected

Neither alternative has been evaluated in depth — this item has not received the same investigation ADR-0001/0005 got, consistent with T1a Phase 2's audit-depth decision (§2 Q1): items without a confirmed incident get a shallow verification-of-duplication check, not a full incident-style Phase 1.

## Consequences

- A future fix to one side's list-read logic (formatting, filtering, a new list-metadata field) will not automatically reach the other side, or voice's own additional internal call sites — the same Cross-Repository Verification discipline from ADR-0001/0005 applies here too.
- Lower real-world severity than ADR-0001/0005, which is why it's ranked below them, not why it's ignored.
