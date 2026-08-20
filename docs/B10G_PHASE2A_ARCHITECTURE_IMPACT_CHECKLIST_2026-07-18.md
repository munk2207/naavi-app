# B10g — Phase 2A: Mandatory Architecture Impact Checklist (retroactive, Governance v3.5 compliance)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` §Phase 2. This document does not revise or reopen `docs/B10G_PHASE2_CHANGE_PLAN_2026-07-17.md` (Approved, reviewed, 2026-07-17) — the chosen approach (extract `task_actions` execution into `_shared/task_actions.ts`, call from both `evaluate-rules` and `report-location-event`) stands unchanged. This document supplies the Mandatory Architecture Impact Checklist and the duplicated-capability Change Impact Matrix rows Governance v3.5 requires of Phase 2, neither of which existed on 2026-07-17.

Builds on `docs/B10G_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-07-18.md` (Approved) — same Architecture Reference version (v2026.07.18.4), same ownership/classification findings (Shared Core, intra-Shared-Core Duplicated per ADR 0005).

---

## 1. Mandatory Architecture Impact Checklist

Per governance, every plan must answer each of the following explicitly, citing the Architecture Reference — "No" stated for each where applicable, not left blank:

- **Does this change modify Shared Core?** **Yes.** `supabase/functions/evaluate-rules/index.ts`, `supabase/functions/report-location-event/index.ts`, and the new `supabase/functions/_shared/task_actions.ts` are all Shared Core (Architecture Reference §0a Ownership Model).
- **Does this change modify an Entry Point (mobile or voice translating logic, rather than Shared Core)?** **No.** `hooks/useOrchestrator.ts` (mobile's write path) and `naavi-voice-server/src/index.js` (voice) are both explicitly unmodified — confirmed by B10g's original Phase 3 §3 Implementation Boundaries and re-confirmed by fresh grep for this document: neither file references `_shared/task_actions.ts` or `executeTaskActions`.
- **Does this change introduce new duplication?** **No.** The opposite — it reduces duplication that already existed (the `task_actions` resolution/send logic previously lived only inline in `evaluate-rules`; it's now a single shared module both callers use, rather than `report-location-event` gaining its own independent copy).
- **Does this change eliminate existing duplication?** **Partially, by design, not fully — stated explicitly per governance's "no" must be as explicit as "yes."** It eliminates duplication for the one piece that had already drifted (`task_actions` execution). It does **not** eliminate the broader `evaluate-rules`/`report-location-event` fan-out duplication (channel selection, self-alert detection remain independently implemented in each function) — this is the accepted scope per ADR 0005 and Architecture Reference §5 Priority 1b, not an oversight. Full unification was explicitly considered and declined (B10g Phase 1 §7, Phase 2 §2, reaffirmed by T1a Phase 2 Q2) as broader-blast-radius work than this fix requires.
- **Does this change modify Protected Core?** **Yes.** Action Rules and Notification routing are both named Protected Core areas (Architecture Reference §4) — this is why B10g carries Full Phase 1-8 governance, unchanged from its original classification. **The change remains permissible because it follows the previously approved governance path (Phase 1-6, all Approved 2026-07-17) and does not expand Protected Core scope beyond the approved implementation** — this Phase 2A retroactively documents architectural impact that was already true of the approved plan, it does not authorize any new scope.

---

## 2. Change Impact Matrix — duplicated-capability rows addressed individually

Per governance: *"If the Architecture Reference marks the affected capability as Duplicated... both rows must be addressed individually — a plan that changes only one side of a duplicated capability must say so, not leave the other side's row blank on the assumption it's out of scope."* B10g's duplication is intra-Shared-Core (`evaluate-rules` vs. `report-location-event`), not mobile-vs-voice — the same principle applies to both sides of that pair:

| Side of the duplicated pair | Changes? | Why |
|---|---|---|
| `evaluate-rules` (cron-bound) | **Yes — pure refactor.** Inline `task_actions` block replaced with a call to the new shared module. No behavior change (confirmed by B10g's original Phase 5: 8 pre-existing F5c/B10g tests continue passing unchanged). | Already had `task_actions` execution (F5c); this change only relocates the logic, doesn't alter it. |
| `report-location-event` (event-bound) | **Yes — the actual fix.** First time this function reads `task_actions` at all, via the same shared call. | This is the side that had zero `task_actions` execution — the defect B10g exists to close. |

**Both sides of the duplicated pair change — stated explicitly, not left as an assumption.** This satisfies governance's requirement directly: it is not a case of "only one side, because the other can't reach this code path" (the alternative acceptable answer) — both genuinely change, for different reasons (refactor vs. fix).

Standard Change Impact Matrix rows, for completeness:

| Layer | Affected? | Details |
|---|---|---|
| Mobile | No | `hooks/useOrchestrator.ts` unmodified (§1 above) |
| Voice | No | `naavi-voice-server/src/index.js` unmodified (§1 above) |
| Shared Core | Yes | See §1 and the table above |
| Database | No | No schema/migration change |
| Cron | No | `evaluate-rules`'s existing cron schedule unchanged; `report-location-event` remains event-triggered, not cron |
| API contracts | No | No Edge Function's public request/response shape changes — `_shared/task_actions.ts` is an internal library module, not its own deployed function |
| Tests | Yes | 10 new/retargeted tests, per B10g's original Phase 5 |
| Architecture Reference | Yes | Remains consistent with ADR 0005 — B10g's implementation is the reference case that Exception was modeled on, not a deviation from it (per Phase 1A §4's Architecture Drift Rule finding) |

---

## 3. Regression Matrix — fresh consumer verification, not recalled from memory

Per governance: *"the consumer list must be produced by searching, and cited"* — re-verified for this document (2026-07-18), not trusted from the original Phase 2's 2026-07-17 citation:

```
grep -rl "task_actions.ts\|executeTaskActions" supabase/functions
→ supabase/functions/evaluate-rules/index.ts
→ supabase/functions/report-location-event/index.ts
→ supabase/functions/_shared/task_actions.ts (the module's own definition)
```

**Exactly two callers, nothing else — confirmed fresh, matching the original Phase 2's claim exactly.** No new consumer has been added to `_shared/task_actions.ts` since 2026-07-17 (unsurprising, since the module hasn't been committed to git or promoted beyond staging — no other work has had the opportunity to adopt it yet). `fire-pending-dwells/index.ts` — confirmed, per B10g's original Phase 1-2, to require no change since it calls back into `report-location-event`'s same `fireLocationAction` function rather than needing its own `task_actions` handling.

**No undocumented consumers discovered.** The search covered the full `supabase/functions` tree, not a targeted subset — closing the verification loop explicitly rather than leaving "exactly two callers" as an implicitly-complete claim.

---

## 4. Phase 2A review record (2026-07-18)

Reviewer feedback received via Wael, evaluated against Governance v3.5 and the Phase 1A/Phase 2A separation of concerns ("did we investigate the complete architecture" vs. "what architectural impact will the approved implementation have"). Three minor additions adopted, no substantive gaps found:

1. **§1's Protected Core answer** gained an explicit sentence on why the change remains permissible despite touching Protected Core — it follows the already-approved governance path and doesn't expand scope, rather than leaving that reasoning implicit in a bare "Yes."
2. **§2's standard Change Impact Matrix** gained an explicit "Architecture Reference" row, confirming consistency with ADR 0005 and cross-referencing Phase 1A's Architecture Drift Rule finding — makes architectural consistency visible in the matrix itself, not just discoverable by reading Phase 1A separately.
3. **§3's Regression Matrix** gained an explicit closing statement — "No undocumented consumers discovered" — naming the full search scope (all of `supabase/functions`, not a subset) so the verification loop reads as closed rather than implied.

Reviewer's stated assessment: does not reopen or modify the approved Phase 2 plan, correctly builds on Phase 1A rather than duplicating it; checklist answers are explicit with nothing implied; the "partially, not fully" duplication-elimination framing specifically praised as more honest than typical change plans that overclaim full removal; Change Impact Matrix evaluates each side of the duplicated pair independently, aligning with the Architecture Scope Rule; cross-layer matrix covers every architectural layer for easier future audits; fresh regression verification (re-searching rather than trusting yesterday's citation) specifically called out as the discipline Governance v3.5 was designed to introduce. Nine-point compliance table (Architecture Impact Checklist, Shared Core/Entry Point/Duplication/Protected Core assessments, duplicated capability evaluated independently, layer impact matrix, fresh consumer verification, builds on Phase 1A) — all ✅.

**Decision: Approved.** Reviewer noted this document, together with Phase 1A, provides a strong template for bringing other pre-v3.5 work into compliance.

**This is the reviewer's assessment of the document's quality — it is not, by itself, authorization to proceed to the next step.** Per the Phase-Gate Approval Rule, that requires Wael's own separate, explicit go-ahead.

---

## 5. Status

**Phase 2A drafted and reviewed 2026-07-18, Approved, three minor additions adopted.** Per the plan confirmed before Phase 1A, Phase 6's four-verdict structure (the last remaining v3.5 compliance item) follows next. Phase 7 (manual test) does not proceed until the full compliance pass is complete.
