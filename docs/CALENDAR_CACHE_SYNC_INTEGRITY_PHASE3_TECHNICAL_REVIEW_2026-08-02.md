# Calendar Cache Synchronization Integrity (Ticket C) — Phase 3 — External Technical Review

**Date:** 2026-08-02
**Governance version:** v4.0
**Reviewed:** `docs/CALENDAR_CACHE_SYNC_INTEGRITY_PHASE2_CHANGE_PLAN_2026-08-02.md`

## Decision: APPROVED WITH MANDATORY CHANGES

Once the success criterion, abort behavior, logging requirements, and regression expectations below are incorporated, the implementation is appropriately scoped and addresses the proven defect without altering the normal user experience.

## Mandatory Changes

1. **Define "successful writes" precisely.** "Every event write succeeded" is not yet operationally defined — does it mean every upsert returned success? What about one event legitimately failing validation, being malformed in Google, or Google returning partial data? Phase 4 must pin this down explicitly so two implementations can't diverge on interpretation.

2. **Reframe the gate as overall-sync-success, not literal every-write-succeeded.** Change the wording to: *"The prune step may execute only if the synchronization run completed successfully for that user without unrecovered write errors."* Preserves the safety guarantee while giving implementation room to define what "unrecovered" means (per #1).

3. **Logging must include the abort reason, not just counts.** Current proposal (fetched/written/deleted/IDs) is missing *why* a prune was skipped. Add an explicit reason field, e.g.:
   ```
   User: Fetched: 84, Written: 83, Failed: 1, Prune: skipped
   Reason: column attendees missing
   ```
   Without this, operators still have to reconstruct why pruning didn't happen.

4. **Clarify the API contract for failure.** The new implementation should return failure for that user, log it, and skip prune — but Phase 2 doesn't yet say whether the overall function returns HTTP 200 with per-user failure info, or fails the whole request. Document the intended behavior before implementation, not after.

5. **Expand regression tests.** Beyond "prune blocked after failed write" / "prune runs after successful write," also cover: write failure is logged; abort reason is logged; no rows deleted after a failed write; normal delete still occurs after a fully successful sync. Confirms safety didn't break the normal case.

6. **Soften one claim.** "The dangerous state becomes structurally impossible" overstates the evidence. More accurate: *"This implementation prevents pruning after synchronization write failures, eliminating the specific asymmetric failure mode identified in Ticket C"* — avoids implying all future synchronization failures are impossible.

## Assessments

- **Risk:** Fix 1 = Low, Fix 2/3 = Medium — agreed, no change.
- **Hidden coupling:** None additional identified; Phase 1A's dependency mapping is complete.
- **Architecture:** Agreed this belongs in Shared Core. The architecture-documentation update (voice's newly-found direct table dependency, the 3-implementation count) stays a separate governance task, not folded into this ticket.

## Implementation Boundaries Confirmed

Authorized only for:
1. One version-controlled migration adding `attendees` to `public.calendar_events`, matching the verified production schema.
2. `sync-google-calendar` modifications to: prevent pruning after unsuccessful synchronization, report synchronization failure, emit structured synchronization logs.
3. Regression tests covering the approved synchronization behavior.

**No changes authorized to:** mobile application logic, voice server, `naavi-chat`, travel-time routing, calendar-selection semantics, `global-search`, production database schema, unrelated synchronization features.

---

**Status:** Review received and recorded. Per governance §3's Phase-Gate Approval Rule, this reviewer verdict is not itself authorization to begin Phase 4 — Wael's own separate, explicit go-ahead is required next.
