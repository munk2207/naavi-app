# T1a — Phase 2: Change Planning (Architecture Integrity Audit)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. Builds on `docs/T1A_PHASE1_PROBLEM_DEFINITION_2026-07-18.md` (reviewed, revisions adopted — Audit Success Criteria added). Subject matter is Protected Core (Action Rules, Notification routing, Reminder Engine) — but, unlike a typical Phase 2, this plan produces **zero application code changes**. See §10 for the resulting Phase 3 question this raises.

Scope is bounded by Phase 1 §5's five open questions and §6's Audit Success Criteria. This document resolves all five questions with a recommendation (Wael's approval still required, same as every other governed decision), and turns §6's five completion conditions into a concrete, checkable deliverable list for Phase 4.

---

## 0. Scoping findings gathered before proposing a plan

Per Phase 1 §5 item 1's recommendation, the cheapest next step was reading what already exists before proposing new investigation. Reading ADRs 0002-0004 (not examined in Phase 1, which only cited ADR 0001) surfaced two findings that materially change this plan:

**Finding A — ADR 0002 (Calendar reads) has the identical blank-dates gap as ADR 0001.** Its Exception block reads "Expiration date: none set — tied to whichever session picks up T1a" and "Review date: at T1a's next scoping session, same as ADR-0001." That session is this one. Calendar reads was not named in Phase 1 as one of the "four confirmed instances" (it has no incident behind it, unlike F5c/B10d/B10g/B10k), but it is already a formally-opened Exception waiting on the exact same T1a deliverable ADR 0001 is. Phase 2 must resolve both, not just ADR 0001.

**Finding B — ADR 0003 (Reminders write-path divergence) is a different shape entirely, and reveals a Reference-accuracy gap.** Unlike ADR 0001/0002, ADR 0003 is not framed as "accepted debt, revisit later" — it documents a one-sided *known-correct* answer (mobile's redirect into `action_rules` for Alerts-screen visibility is real, current, sound reasoning) sitting next to a *no-reasoning-found* answer (voice's direct `reminders` table write, most likely never updated when mobile's redirect was added). ADR 0003's own Consequences section states this "should be re-evaluated as a candidate fix... rather than left as a permanent Architecture Exception" — i.e., ADR 0003 itself recommends a fix, not indefinite acceptance. **This was never opened as its own holding-list item.** Separately: Architecture Reference §2's "Reminders" row classifies this as "Voice-only in current practice," with no cross-reference to ADR 0003 — underselling that this is a documented, actionable divergence rather than a settled state.

**Finding C — the Architecture Reference's own "Action Rules — execution/firing" row is imprecisely worded, and this project's own recent incidents prove it.** Architecture Reference §2 lists `evaluate-rules`, `report-location-event` as "Genuinely shared — single non-duplicated functions, confirmed by exhaustive grep of the voice codebase." That grep proved voice has no independent copy of this logic — true, and worth keeping. But it does not capture that `evaluate-rules` and `report-location-event` are **two independently-maintained Shared-Core functions**, each with a documented "keep both in sync" contract (`report-location-event`'s own docstring) that has already failed to hold three separate times (Phase 1 §2.1-2.3: F5c's partial fix, B10d's channel-preference gap, B10g's `task_actions` gap). The word "shared" in this row is accurate for the mobile-vs-voice axis and misleading for the intra-Shared-Core axis — exactly the kind of claim Governance §7a prohibits ("declare functionality shared without verification") if left uncorrected now that the verification has actually been done.

These three findings expand Phase 1's scope slightly but are within Phase 1's own explicit invitation (§5 item 1: audit depth includes checking Duplicated-row claims, not just the four named incidents) — not scope creep, direct execution of what Phase 1 asked Phase 2 to determine.

---

## 1. Files that will change

**(A) Documentation/tracking files — Phase 4's actual output:**

| File | Change |
|---|---|
| `docs/adr/0001-action-rules-classifier-duplication-accepted.md` | Fill in Expiration date, Review date, Owner approval (per §2 Q4 below) |
| `docs/adr/0002-calendar-reads-remain-duplicated.md` | Same — currently blank, same resolution |
| `docs/adr/0005-action-rules-execution-fanout-duplication-accepted.md` (**new**) | Formalizes the `evaluate-rules`/`report-location-event` intra-Shared-Core duplication (Finding C) as its own Exception, modeled on ADR 0001's format |
| Additional new ADRs, count and numbers **not predetermined** | Create one **only** for a finding that remains justified after Phase 4's verification (Gmail live reads, List reads, Conversation/turn state are candidates, not commitments — §2 Q1 below). Phase 4 may confirm zero, one, two, or all three; the number assigned at creation follows whatever the next unused ADR number is at that time, not a number reserved here in advance. Evidence drives the ADR, not the other way around. |
| `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` | New Architecture Version. §2's "Action Rules — execution/firing" row reworded per Finding C. §2's "Reminders" row gains a cross-reference to ADR 0003. §5a's Duplication Inventory table gains a "Reminders write-path divergence" row (currently missing despite having its own ADR) and an "Action Rules execution (fan-out) — intra-Shared-Core" row (currently folded incorrectly into the "genuinely shared" section). §5's Current Architecture Debt priorities updated to reflect new/resolved dispositions. |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | New item opened for ADR 0003's reminders fix (next unused ID — confirmed `B10l` is free as of this session, per the doc's own "grep first" rule; re-confirm at actual creation time in Phase 4 in case another item was opened between now and then). T1a's own entry updated to reflect Phase 2 completion and link this document. B10d/B10g's entries annotated with the sequencing recommendation from §2 Q5. |

**(B) Application/production code files: none.** This is deliberate, not an oversight — per Phase 1 §6's Audit Success Criteria, T1a's own deliverable is disposition (Fixed / Accepted / Deferred), not execution. Every disposition that resolves to "Fixed" becomes its own separately-governed holding-list item with its own Phase 1-8 cycle. Bundling code changes into T1a's own cycle would violate Governance's Golden Rules ("small branches, small commits") and would make T1a's own scope unboundedly large — exactly what §6's "objective, stated explicitly" paragraph was written to prevent.

---

## 2. Proposed change — audit execution plan, resolving Phase 1 §5's five open questions

### Q1 — Audit depth

**Recommendation: disposition all seven items below, not just the four named in Phase 1.** Four already have direct incident evidence (Phase 1 §2.1-2.4); three more are surfaced by Finding A/B/C above without requiring a fresh incident investigation — reading existing documentation and one already-proven grep pattern (Phase 1 §2.2's method) is enough to disposition them.

| # | Item | Existing evidence | Phase 4 action |
|---|---|---|---|
| 1 | Action Rules creation (classifier) | B10k, ADR 0001 (Approved-pending-dates) | Fill ADR 0001 dates (Q4) |
| 2 | Action Rules execution/firing — intra-Shared-Core (`evaluate-rules` vs `report-location-event`) | F5c (partial), B10d, B10g — 3 confirmed drift incidents on this exact pair (Finding C) | Draft ADR 0005 (Q2); correct Architecture Reference row |
| 3 | Calendar reads | ADR 0002 (Accepted-pending-dates, no incident) | Fill ADR 0002 dates (Q4) |
| 4 | Gmail live reads | Architecture Reference Priority 3, no ADR, no incident | Shallow check: grep both `naavi-chat` and `naavi-voice-server` for their respective Gmail live-fetch calls, confirm the "duplicated, not shared" claim still holds. Create an ADR only if that verification still justifies one — not assumed here |
| 5 | List reads | Architecture Reference §2 (Duplicated, no priority rank), no ADR, no incident | Same shallow-check treatment; ADR creation contingent on what Phase 4 actually finds |
| 6 | Conversation/turn state | Architecture Reference Priority 4, "architecturally difficult to unify," no ADR | Same shallow-check treatment — likely **Deferred** rather than Accepted, since the Reference already states this is harder than a simple accept/reject (different runtimes, different session models); an ADR is created only if Phase 4's verification still supports one after that check |
| 7 | Reminders write-path divergence | ADR 0003 (already recommends a fix, not acceptance) | Open as new holding-list item (`B10l`, pending re-confirmation); disposition **Deferred**, not Accepted — ADR 0003 itself says this shouldn't be left as a permanent Exception |

Items 4-6's "shallow check" is explicitly **not** a full B10-style Phase 1 investigation — no incident is claimed or assumed. It is verification that the Architecture Reference's existing "Duplicated" label is still accurate (per Governance §7a's "never declare — or leave undeclared — without verification"), same rigor as Phase 1 §2.2's fresh B10d check, bounded to: does each side's code still independently implement this, and is there a "keep in sync" style comment or contract analogous to `report-location-event`'s that isn't backed by any enforcement.

### Q2 — Structural unification of `evaluate-rules`/`report-location-event`?

**Recommendation: do not unify now — formalize as Exception instead (new ADR 0005).** Same reasoning already given and accepted in B10g Phase 1 §7 and B10g Phase 2 §2 (cron-vs-event timing models are genuinely different; full merge is broader-blast-radius work not yet justified by a real measurement). What changes here is not the decision but its **status**: this duplication was previously an implicit, unstated assumption baked into the Architecture Reference's "genuinely shared" wording (Finding C) — after T1a, it becomes an explicit, dated, Wael-approved Exception like ADR 0001/0002, with the same review trigger (next Architecture Audit Trigger, per Governance §6's ADR Lifecycle rule). The Architecture Reference's row is corrected in the same work item (§1 above), satisfying Governance §8's Architecture Change Procedure.

### Q3 — B10k's own resolution path

**Recommendation: split the disposition.** The classifier-duplication *architecture decision itself* (ADR 0001) is dispositioned **Accepted** here, with dates set (Q4) — this is a legitimate, already-reasoned Exception (ADR 0001's own Alternatives Considered section shows real trade-off analysis, unlike ADR 0002/0003's "no decision record exists" admission). The *practical, urgent* problem underneath it — B10j's `get-naavi-prompt` fix sitting on staging while voice runs against production exclusively, with zero voice staging environment to test against — is dispositioned **Deferred**, remaining B10k in the holding list at its existing Tier 1 priority. T1a does not choose among ADR 0001's three candidate resolution paths (voice calls `naavi-chat` directly / voice re-implements a matched copy / leave as tracked debt) or among B10k's three candidate paths (promote to production / build voice staging / use `/test/ask` carefully) — those are product/infra decisions requiring their own dedicated scoping session, per Wael's original 2026-07-17 instruction that explicitly deferred this. An architecture audit's job is to make sure the decision is tracked and dated, not to make the decision itself.

### Q4 — ADR expiration/review dates

**Recommendation: apply Governance §6's own ADR Lifecycle rule uniformly** — "reviewed annually (or at the next Architecture Audit Trigger, whichever comes first)." Concretely, for every Accepted-status ADR — 0001, 0002, 0005, plus any additional ADR Phase 4's verification confirms is justified for items 4-5 (§2 Q1) — none presumed in advance:
- **Owner approval:** Wael, dated at whatever point he signs off this Phase 2 (or T1a's eventual closure — whichever Wael prefers to treat as the operative date; flagging this as a small open choice rather than assuming one).
- **Expiration date:** 2027-07-18 (12 months from today).
- **Review date:** 2027-07-18, or the next Architecture Audit Trigger event, whichever comes first — matching the ADR Lifecycle rule's own wording exactly rather than inventing a different cadence.

Item 6 (Conversation/turn state) likely does not get "Accepted" status at all — see Q1's table, "likely Deferred" — so no expiration date applies to it the same way; Phase 4 confirms.

### Q5 — B10d/B10g bundling

**Recommendation: keep separately governed, but sequence deliberately.** B10d does not get folded into T1a's own cycle (§1(B) above), and does not get bundled into B10g's still-open Phase 7. Instead: recommend B10d becomes the **next** holding-list item opened after B10g's Phase 7 (manual test) completes and B10g is committed — because B10d can directly reuse the shared-module extraction pattern B10g's Phase 2-6 already designed and got Approved (a `_shared/channel_preferences.ts`-style module, same shape as `_shared/task_actions.ts`), which should make B10d's own Phase 1-3 faster and lower-risk than starting from nothing. This is a sequencing recommendation for the holding list, not a T1a deliverable.

---

## 3. Regression impact

| Area | Impact | Why |
|---|---|---|
| Voice commands | Not affected | No code touched — documentation only |
| Geofencing | Not affected | Same |
| Gmail integration | Not affected | Same |
| Calendar integration | Not affected | Same |
| Reminders | Not affected *by this Phase 2 itself* | Opening `B10l` (§1) creates a new tracked item but writes no code; the eventual fix (voice's `SET_REMINDER` path) is out of scope here |
| SMS / call alerts | Not affected | Same |
| Onboarding | Not affected | Same |
| Staging build | N/A | No Edge Function, no AAB — documentation-only change, nothing to deploy |

---

## 4. Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | No | Zero files touched |
| Voice | No | Zero files touched |
| Shared Core | No | Zero Edge Function code touched — read/grepped for verification only |
| Database | No | |
| Cron | No | |
| API contracts | No | |
| Tests | No | T1a itself adds none; disposition items that become "Fixed" will add their own per Rule 15a, in their own Phase 5 |
| Documentation (not a standard matrix row, called out explicitly) | **Yes** | Architecture Reference, ADR 0001/0002 + up to 4 new ADRs, holding list — this phase's actual work product |

---

## 5. Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** No.
- **Does this change modify an Entry Point?** No.
- **Does this change introduce new duplication?** No.
- **Does this change eliminate existing duplication?** Not directly. It produces dispositions (§2) that will, in separately-governed follow-on items, either eliminate duplication (Fixed dispositions) or formally accept it (Accepted dispositions, now dated and reviewable instead of indefinite). T1a itself changes zero duplicated code.
- **Does this change modify Protected Core?** No code within Protected Core is modified. Its *subject matter* is Protected Core (Action Rules, Notification routing, Reminder Engine) — flagged explicitly per Governance §7a rather than glossed over, and is the reason §10 raises the Phase 3 question rather than assuming it's waived.

---

## 6. Regression Matrix (per-change consumer trace)

**N/A.** No shared function or module is modified by this phase — nothing to trace consumers for. Stated explicitly per Governance's requirement that silence is not an acceptable substitute for this section.

---

## 7. Risk classification

**Low, for this Phase 2-8 cycle specifically.** Zero code changes; the artifacts produced (ADR dates, a new ADR, Reference corrections, one new holding-list item) are all reversible, reviewable text changes with no runtime effect. This is a materially different risk shape than every other Phase 1-8 item referenced in this document (F5c/B10d/B10g/B10k), which each carry Medium-High risk because they touch live Protected Core code paths.

**Downstream risk is explicitly not zero** — each disposition that later becomes a "Fixed" item (B10d, B10l/reminders, F5c's remaining call sites, B10k's production-promotion decision) inherits its own full Protected-Core risk classification independently, per Governance §4, unaffected by T1a's own Low rating here.

---

## 8. Deliverables — Phase 4's Definition of Done

Directly operationalizes Phase 1 §6's Audit Success Criteria:

1. **Coverage check complete** for all seven items in §2 Q1's table — each with either "confirmed duplicated, disposition below" or "no drift found, no action needed."
2. **Disposition recorded for every item**, no silence:
   - Accepted: #1 (classifier), #3 (Calendar reads), #2 (execution/firing fan-out) — dated per Q4, plus #4/#5 (Gmail/List reads) if Phase 4's shallow check confirms them and finds no reason to deviate from the ADR 0001/0002 pattern.
   - Deferred: #7 (Reminders write-path — new `B10l`), B10k's production-promotion problem (remains open, Tier 1), #6 (Conversation/turn state, likely) if Phase 4 confirms it's harder than a simple accept.
   - Fixed: none directly by T1a — B10g (already Phase 1-6 Approved, needs Phase 7 + commit) and any newly-opened items reach "Fixed" through their own separate cycles, outside T1a's own scope.
3. **ADR 0001 and ADR 0002's blank fields filled.** New ADR 0005 drafted (execution/firing fan-out — this one is decided in this Phase 2, not conditional). Beyond that, additional ADRs are created strictly per Phase 4's evidence — for a finding that verification still justifies, not as a predetermined set; Phase 4 may produce zero, one, or more.
4. **Architecture Reference updated**: new version number, corrected "Action Rules execution/firing" row (Finding C), corrected "Reminders" row cross-reference (Finding B), §5a Duplication Inventory table gains the two currently-missing rows, §5's Current Architecture Debt priorities reflect the final state.
5. **Holding list updated**: `B10l` opened (reminders fix), T1a's own entry marked with a link to this document and (once Phase 4 completes) a closure note, B10d/B10g annotated with the §2 Q5 sequencing note.
6. **Wael's explicit closure confirmation** — per Phase 1 §6 item 5, none of items 1-5 above self-close T1a; Wael's own separate word does.

---

## 9. Explicitly deferred (not part of this Phase or T1a itself)

- Actual code fixes for B10d, F5c's two remaining recipient-resolution call sites + mobile's first-entry-only gap, voice's `SET_REMINDER`/`reminders`-table path (ADR 0003 / new `B10l`), and B10k's production-promotion decision — each its own separately-governed holding-list item.
- Full structural unification of `evaluate-rules`/`report-location-event`'s entire fan-out logic — formalized as an Exception (ADR 0005), not implemented.
- Whether Gmail live reads / List reads / Conversation-turn-state actually warrant unification — Phase 4's shallow check may surface a need for a full B10-style Phase 1 investigation for any of these; not pre-judged here one way or the other.
- Choosing among ADR 0001's or B10k's named candidate resolution paths — both require their own dedicated decision sessions, per Q3.

---

## 10. Next step — the Phase 3 question

Every other Protected-Core item in this project's history has gone through full Phase 3 external review before "coding." This phase produces no code — its "coding" is Phase 4's documentation execution. Two options, not decided here:

1. **Run Phase 3 anyway**, reviewing this plan (methodology, the seven-item disposition list, the two Reference corrections, the new-ADR proposals) before Phase 4 executes it — consistent with treating Protected-Core-adjacent subject matter uniformly regardless of code-touch, and fitting since T1a itself exists to enforce exactly this kind of rigor.
2. **Ask Wael whether this qualifies for a waiver**, the same way B9b/B9d/B9s were flagged as "candidates for waiver, ask Wael" — this phase's Low risk classification (§7) and zero-code-touch nature resemble those precedents more than a typical Medium/High-risk Protected Core change.

**Recommendation: run Phase 3.** The precedent-based waiver cases (B9b/B9d/B9s) are narrow UI/read-only items with no architectural consequence; this document proposes correcting the Architecture Reference itself and formally accepting a Protected Core duplication (ADR 0005) — exactly the class of decision Governance §4's Ownership Change Rule and §9's Governance Change Approval Process both require external review for. Skipping review here would be inconsistent with the rigor this whole audit exists to enforce. This is a recommendation, not a decision — Wael's call, same as always.

Not started, and will not start without Wael's own separate, explicit go-ahead per the Phase-Gate Approval Rule.

---

## 11. Phase 2 review record (2026-07-18)

Reviewer feedback received via Wael, evaluated against Governance v3.5 specifically (not prior-governance expectations). One substantive wording issue identified, adopted:

1. **Future ADRs were presented as anticipated/numbered outputs (0006, 0007, 0008) rather than conditional ones.** Reviewer's point: Phase 4 itself is what determines whether these ADRs are actually needed — pre-naming and pre-numbering them, even with "conditional" noted alongside, frames them as expected outputs and risks documentation driving conclusions rather than evidence driving documentation, the opposite of what this plan otherwise gets right.
2. **Resolution adopted throughout the document** (§1 file table, §2 Q1's table, §2 Q4, §8 Deliverables): removed all pre-assigned ADR numbers for the Gmail-reads/List-reads/Conversation-state candidates. Reworded consistently to "create an ADR only for a finding that remains justified after Phase 4's verification," with the actual number (if any) assigned at creation time from whatever is next-unused then. ADR 0005 (execution/firing fan-out) is unaffected by this change — it is a firm Phase 2 decision (Q2), not conditional on further verification, so it keeps its number.

Reviewer's stated assessment (per governance section, all PASS): builds directly from Phase 1's five deferred questions without inventing new work; complete file inventory including explicit no-production-code statement; Architecture Impact section walks through every governance category rather than shortcutting because the work is documentation; scope control cleanly separates T1a from future B10 items from future implementation; Definition of Done resolves Phase 1's own review gap with measurable Phase 4 completion criteria. Technical agreement on all five resolved questions (Q1-Q5), specifically praising the Architecture-Decision-vs-Implementation-Decision split in Q3 and the dated-Exception approach in Q2/Q4. Broader observation: this is the first Governance v3.5 item to demonstrate the process works for architecture investigation, not just software change — audit produces governance artifacts (Reference → ADRs → Holding List → future implementation), not code.

**This is the reviewer's assessment of the plan's quality — it is not, by itself, authorization to begin Phase 3 (or to grant the waiver §10 raised as an open question).** Per the Phase-Gate Approval Rule, that transition requires Wael's own separate, explicit go-ahead. That has not yet been given, and §10's Phase 3-vs-waiver question is also still open.

---

## 12. Status

**Phase 2 drafted and reviewed 2026-07-18, revision above adopted. Phase 3 (or a waiver decision, per §10) has NOT started and will not start until Wael gives explicit, separate approval for this specific transition.**
