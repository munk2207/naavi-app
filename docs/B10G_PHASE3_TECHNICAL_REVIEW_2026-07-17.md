# B10g — Phase 3: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3. Subject: `docs/B10G_PHASE2_CHANGE_PLAN_2026-07-17.md`, reviewed and revised per that document's own §7. This document does not repeat that review — it resolves the one implementation-strategy question Phase 2 explicitly left open for Phase 3 (§2 below), then formalizes the two elements governance requires specifically of Phase 3: an explicit Implementation Boundaries statement (§3) and a record of deferred architectural ideas (§4), ahead of Phase 4.

Required because the plan touches Protected Core (Action Rules, Notification routing, Geofencing) and is classified Medium-High Risk.

---

## 1. Basis for this review

Phase 2 (`docs/B10G_PHASE2_CHANGE_PLAN_2026-07-17.md`) §7 records reviewer feedback (wording precision, an interface question flagged for Phase 3, the duplicated-fan-out pattern made explicit) and a verdict: "stays within approved Phase 1 scope, answers Phase 1's posed architectural question, minimizes blast radius, improves maintainability, provides a clear regression strategy, avoids opportunistic refactoring, technically well justified. No substantive issues identified."

Nothing in this document reopens that assessment. §2 resolves the one question Phase 2 deliberately did not decide. §3-4 are the formal artifacts governance's Phase 3 requires in addition to review.

---

## 2. Implementation strategy decision: shared module interface

Phase 2 §2/§5 flagged, without deciding, whether `executeTaskActions` should take six positional parameters or a single context object. Phase 3's charter explicitly includes evaluating "Implementation strategy" — this is decided here, not deferred further.

**Decision: adopt a context object, with one adjustment to the reviewer's illustrative example.**

```ts
export async function executeTaskActions(ctx: {
  config: Record<string, unknown>;
  rule: { id: string; user_id: string };
  userName: string | null;
  supabaseUrl: string;
  interFnKey: string;
}): Promise<void> {
  const { config, rule, userName, supabaseUrl, interFnKey } = ctx;
  ...
}
```

Called identically at both sites:
```ts
await executeTaskActions({ config, rule, userName, supabaseUrl, interFnKey });
```

**Why the object form, concretely (not just "generally good practice"):** the positional form's original sketch had `ruleId: string, userId: string` back-to-back — two same-typed strings with no type-system distinction between them. A transposed argument at either call site would compile cleanly and fail silently or misattribute a send to the wrong user, a failure mode this exact document's own family of bugs (F5c, B10a) has already demonstrated is real for string-identity mixups. Passing the whole `rule` object (already a local variable at both call sites — `rule` in `evaluate-rules`' loop, the `rule` parameter in `report-location-event`'s `fireLocationAction`) removes the transposition risk entirely rather than just organizing around it. The reviewer's stated advantages (future-proof against new parameters, easier testing/mocking, cleaner call sites) also apply and are not disputed.

**Deviation from the reviewer's illustrative example: `admin` is dropped.** The reviewer's sketch included an `admin` (Supabase service-role client) field. Checked directly against the actual logic being extracted (`evaluate-rules/index.ts` current lines 1077-1158): it makes zero Supabase client calls — every operation is a `fetch()` to `lookup-contact`/`send-sms`/`send-user-email`. Adding an unused `admin` parameter would be a speculative field with no current consumer, which `CLAUDE.md`'s AI Coding Discipline (Rule 19, "new abstractions must justify their existence... if the justification is 'cleaner code' without a concrete problem it solves, the abstraction is not justified") and Rule 20 ("remove dead code... unused fields... must be deleted, not left 'just in case'") both weigh against. If a future change genuinely needs DB access inside this function, add the field then, with a real caller.

**No other change to the extracted logic's behavior** — this decision is about the function's call signature only; §2(a) of Phase 2 (the fail-closed resolution logic itself) is unaffected.

---

## 3. Implementation Boundaries Confirmed

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3's Implementation Boundaries requirement:

- **Authorized files, exactly:**
  - `supabase/functions/_shared/task_actions.ts` (**new file**) — the extracted `executeTaskActions` function, using the context-object signature decided in §2 above, containing the fail-closed resolution + send logic lifted from `evaluate-rules/index.ts`'s current F5c block (lines 1064-1159), logic unchanged apart from adapting variable access to the new context-object signature (destructuring `ctx` in place of the six former positional parameters — not a literal copy-paste, since the parameter shape itself changed per §2).
  - `supabase/functions/evaluate-rules/index.ts` — replace the inline F5c block (current lines 1064-1159) with a single call: `await executeTaskActions({ config, rule, userName, supabaseUrl, interFnKey });`. Nothing else in this file changes.
  - `supabase/functions/report-location-event/index.ts` — inside `fireLocationAction`, add the identical call immediately after the existing fan-out summary log (current line 923) and before `return successCount > 0` (current line 925). Nothing else in this file changes.
- **No additional files are approved.** Not `fire-pending-dwells/index.ts` (confirmed unaffected — it calls back into `report-location-event`'s same function, per Phase 1 §2.4/Phase 2 §1). Not `hooks/useOrchestrator.ts` (the write-time warn/gate question is Wael's product decision, Phase 1 §5 item 4, explicitly out of scope). Not `lookup-contact/index.ts`, not `_shared/alert_body.ts`.
- **No opportunistic refactoring is approved.** Neither `evaluate-rules`' nor `report-location-event`'s existing fan-out/channel-selection/self-alert-detection logic is touched, renamed, or reorganized while these files are open for this change — the new call is additive only, at the exact position specified above.
- **No architectural changes are approved beyond what Phase 2 + §2 above describe.** No unification of the two functions' full fan-out logic (Phase 1 §7 / Phase 2 §5 both hold this premature). No new table, no schema/migration change. No confirmation/interactive path added at fire time (same reasoning as F5c: an unattended cron/event handler has no user present to confirm with).
- **Explicitly excluded from this authorization** — each would need its own Phase 1/2/3, not implied by this approval:
  - Whether `useOrchestrator.ts` should warn or block a location alert's task strings ahead of/regardless of this fix (Phase 1 §5 item 4).
  - B10d's fix, even though it's a natural candidate for the same extraction pattern established here (Phase 2 §5).
  - T1a, the broader architecture integrity audit this document's §4 (below) and Phase 2 §7's review both point to.

---

## 4. Deferred Architectural Decisions

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3's Deferred Architectural Decisions requirement:

**Idea:** unify `evaluate-rules`' and `report-location-event`'s entire fan-out implementations (channel selection, self-alert detection, self-overrides — not just `task_actions`) into one shared execution path, eliminating the cron-vs-event duplication at its root rather than sharing one extracted piece at a time.

**Not approved for this implementation.** First raised in B10g Phase 1 §7 and reaffirmed in Phase 2's implementation philosophy (§2): broader blast radius than this specific gap requires, touches logic that currently works correctly in both functions, and premature to design before confirming the narrower shared-module pattern (this fix) actually holds up in practice.

**This document records the pattern as sufficient evidence to justify evaluating full fan-out unification under a separate project (for example, T1a) — it explicitly does not authorize that work here.** Per Phase 2 §7's review, this is the third documented instance of the same duplicated-implementation-drift pattern (F5c's three-way recipient-resolution drift, B10d's channel-preference drift, this document's `task_actions` drift), which is the explicit threshold Phase 1 §7 set for reconsidering full unification. Recognizing the pattern is not the same as approving the redesign: the decision to actually scope a unification (or to scope T1a first, which might reach the same conclusion more systematically) is Wael's, not something this implementation-level document authorizes on its own.

---

## 5. Phase 3 review record (2026-07-17)

Reviewer feedback received via Wael. Two wording refinements, both adopted:

1. **§3's "logic unchanged" qualified** — added "apart from adapting variable access to the new context-object signature," so the extraction isn't read as a literal copy-paste, since the parameter shape itself necessarily changed per §2's decision.
2. **§4's "condition for reconsidering" sharpened** — reworded to state plainly that this document records the three-instance pattern as sufficient evidence to justify *evaluating* full fan-out unification under a separate project (e.g. T1a), while explicitly not authorizing that work here. Makes explicit what was previously only implied: recognizing a pattern is not the same act as approving a redesign built on it.

Reviewer's stated assessment: the document keeps Phase 1/2/3's boundaries distinct (prove the defect / choose the solution / constrain the implementation) without blurring them; no substantive technical issues; implementation strategy sound; blast radius tightly controlled; implementation boundaries explicit.

**This is the reviewer's assessment of the document's quality — it is not, by itself, authorization to begin Phase 4.** The reviewer's own wording ("assuming external review does not uncover a new issue... ready for Phase 4 once you give explicit authorization") already anticipates this. Per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3): Phase 4 begins only when Wael says so explicitly, in a separate instruction, regardless of this or any review verdict.

---

## 6. Outcome

**Implementation is authorized only within the boundaries defined in §3, using the interface decided in §2, with the §5 wording refinements incorporated.** Any change outside those boundaries requires returning to Phase 2 (or Phase 1, if new evidence changes scope). No code has been written under this document. Phase 4 (Implementation), Phase 5 (Evidence Package), and Phase 6 (Technical Review After Coding) follow, per governance — none have started.
