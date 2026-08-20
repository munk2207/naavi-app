# ADR 0005 — Action Rules execution (fan-out) duplicated between `evaluate-rules` and `report-location-event`, accepted for now

**Status:** Accepted (as an Architecture Exception, not a permanent design)
**Date:** 2026-07-18
**Related:** [[F5c]], [[B10d]], [[B10g]], [[T1a]] in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`; `docs/T1A_PHASE1_PROBLEM_DEFINITION_2026-07-18.md` §2.1-2.5; `docs/T1A_PHASE2_CHANGE_PLAN_2026-07-18.md` §0 Finding C

## Problem

`evaluate-rules` (cron-bound, handles `email`/`time`/`calendar`/`weather`/`contact_silence` triggers) and `report-location-event` (event-bound, handles `location` triggers) are two independently-maintained Shared-Core Edge Functions that both fire an alert's notification fan-out — channel selection, self-alert detection, recipient resolution, and (as of B10g) `task_actions` execution. `report-location-event`'s own docstring documents this was a deliberate choice ("does not re-use evaluate-rules/fireAction because that function is cron-bound... Keep both in sync when changing the fan-out policy") — but that "keep both in sync" instruction has never been backed by anything enforceable, and has already failed three separate times:

1. **F5c** (2026-06-15/2026-07-17) — recipient-resolution fail-closed logic was hardened in `evaluate-rules`' fire-time resolver; `report-location-event` was not part of that fix's scope (a different call site in the same broader recipient-resolution drift, per Phase 1 §2.1).
2. **B10d** — the F2g per-user channel-preference opt-out (`user_settings.alert_channels_enabled`) is read and honored by `evaluate-rules` (`index.ts:765,780-781,1011`) but never referenced anywhere in `report-location-event` (confirmed by direct grep, zero matches) — a user who opts out of WhatsApp still receives it on location-triggered alerts.
3. **B10g** — `task_actions` execution was added to `evaluate-rules`' fan-out (F5c, 2026-06-15) but never ported to `report-location-event` (nor `fire-pending-dwells`, which calls back into it) — confirmed by exhaustive grep, zero references in either file. A location alert's third-party task actions are written successfully and never executed.

The Architecture Reference's own §2 table previously labeled "Action Rules — execution/firing" as "Genuinely shared — single non-duplicated functions, confirmed by exhaustive grep of the voice codebase." That characterization is accurate for the mobile-vs-voice axis (voice has no separate copy of this logic) and misleading for the intra-Shared-Core axis — these are two independently-drifting functions, not one. This ADR exists to correct that and formalize the actual state, per T1a (Architecture Integrity Audit).

## Decision

**No deliberate decision record existed for this duplication before today, the same gap ADR 0001 named for the classifier split.** The most likely explanation, based on the system's structure: `report-location-event` needs sub-second responsiveness to a real-time geofence crossing, while `evaluate-rules` is a cron poller design not built for that latency profile — a genuine runtime-constraint difference, not an oversight in the original split. But the *scope* of what's duplicated (the entire fan-out, not just the cron-vs-event dispatch mechanism) was never re-examined once both functions existed, which is how three features drifted apart independently.

**What is being decided here, explicitly, for the first time:** the duplication is accepted for now as a tracked Architecture Exception. B10g's Phase 2 (Approved, staging-deployed) already took the first concrete step toward narrowing it — extracting the one already-drifted, already-hardened `task_actions` piece into a shared module (`supabase/functions/_shared/task_actions.ts`) both functions call, rather than either leaving it unfixed or attempting a full merge. This ADR formalizes that "extract the specific drifted piece, don't merge the whole thing" as the accepted pattern going forward, not just this one instance's fix.

```
Architecture Exception
Capability: Action Rules execution (fan-out) — evaluate-rules vs. report-location-event
Reason: Full unification would require either merging a cron-bound and an event-bound execution model (unevaluated latency/architecture risk to the real-time geofence path) or accepting the ongoing drift risk this ADR documents. B10g's narrower "extract the specific drifted piece" pattern is the accepted middle ground for now — it closes each confirmed drift instance without redesigning either function's core dispatch model.
Owner approval: Wael, 2026-07-18 (T1a Phase 4 execution, per his explicit "Go - Phase 4")
Expiration date: 2027-07-18
Review date: 2027-07-18, or the next Architecture Audit Trigger (Governance §6 ADR Lifecycle), whichever comes first
```

## Alternatives Considered

1. **Fully unify `evaluate-rules` and `report-location-event` into one execution path.** Rejected for now — `report-location-event`'s real-time responsiveness requirement (a geofence crossing needs an immediate handler, not a cron-poll delay) is a genuine constraint, and no measurement has been done on whether a unified design could meet it. B10g Phase 1 §7 and Phase 2 §2 both held this premature; T1a's own Phase 2 (Q2) reaffirmed the same conclusion after reviewing all three drift instances together.
2. **Extract only the specific piece that has drifted each time it's found (the B10g pattern), leave the rest duplicated.** **Chosen.** Lower blast radius than option 1, directly addresses the actual failure mode (a feature added to one copy, forgotten in the other) without requiring a redesign of either function's dispatch model. `_shared/task_actions.ts` (B10g) is the first instance of this pattern; `_shared/alert_body.ts` (pre-existing, F15-era) is an earlier one that already worked this way before the pattern was named.
3. **Leave fully duplicated, no shared extraction of any kind, patch each drift instance independently forever.** Rejected — this is the status quo that produced three confirmed instances with no mechanism to prevent a fourth. Explicitly worse than option 2 for no offsetting benefit.

## Why Rejected

Option 1 isn't rejected on principle the way B10k's classifier-duplication (ADR 0001) partially is — it's rejected for lack of evidence (the latency question is real and unmeasured), leaving the door open to revisit if that measurement is ever done. Option 3 is rejected because it's already been tried, by default, for three feature additions running into 2026-07-17, and produced three separate incidents. Option 2 is the pattern B10g already validated in practice (Phase 1-6 all Approved) before this ADR formalized it as the standing approach.

## Consequences

- Any future feature added to either function's fan-out (a new channel, a new notification type, a new resolution rule) must be evaluated against **both** `evaluate-rules` and `report-location-event` explicitly, per Governance's Cross-Repository Verification Rule — extended here from its original mobile-vs-voice framing to also cover this intra-Shared-Core pair.
- B10d's own eventual fix (not yet started, sequenced after B10g's Phase 7 + commit per `docs/T1A_PHASE2_CHANGE_PLAN_2026-07-18.md` §2 Q5) should follow the same extraction pattern (`_shared/task_actions.ts`'s shape) rather than a fresh independent fix in `report-location-event` alone — consistent with this ADR, not just convenient precedent.
- This is Priority 1-adjacent debt in the Architecture Reference's Current Architecture Debt (§5) — distinct from ADR 0001's Priority 1 classifier duplication, but the same class of risk (Protected Core, Notification routing) and the pattern that (together with the classifier duplication) satisfied the Architecture Audit Trigger that produced T1a.
