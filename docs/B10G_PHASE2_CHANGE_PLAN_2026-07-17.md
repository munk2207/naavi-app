# B10g — Phase 2: Change Planning

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. Builds on `docs/B10G_PHASE1_PROBLEM_DEFINITION_2026-07-17.md` (reviewed, revisions adopted). Touches Protected Core (Action Rules, Notification routing, Geofencing) — automatically requires Phase 3 technical review before coding, per governance §4.

Scope is bounded by Phase 1 §5: closing the execution gap for `task_actions` on `trigger_type: 'location'` rows. Phase 1 §6 item 5 posed an explicit architectural question this Phase 2 must answer, not defer: *should `report-location-event` remain an independent fan-out implementation, or share a common execution module with `evaluate-rules`?* §2 below answers it directly — share only the one well-isolated, already-hardened piece (`task_actions` resolution + execution), not the two functions' entire fan-out logic.

**Supporting evidence gathered before choosing an approach (per Phase 1 §6's explicit recommendation):** checked both staging and production `action_rules` for any row with `trigger_type='location'` and a non-empty `task_actions` array (`scripts/diag-b10g-location-taskactions-exposure.js`, 2026-07-17). **Result: zero rows in either environment** (staging: 0 of 11 location rules; production: 0 of 19). This gap has no current real-world blast radius — no user has yet created this combination — which shapes the risk classification in §4 but does not change whether the fix is worth doing (F5c's own incident is a standing reminder that "not yet observed" is not the same as "won't happen").

---

## 1. Files that will change

| File | Classification | Change | Risk |
|---|---|---|---|
| `supabase/functions/_shared/task_actions.ts` (**new file**) | Backend (Protected Core — Shared Logic; Action Rules + Notification routing) | New shared module. Extracts the `task_actions` resolution-and-send logic **verbatim** from `evaluate-rules/index.ts`'s existing F5c block (current lines 1064-1159) into one exported function both `evaluate-rules` and `report-location-event` can call. No behavior change to the extracted logic itself — same fail-closed resolution (exactly one `lookup-contact` match required), same four named skip reasons (`name_too_short`/`zero_matches`/`ambiguous_multiple_matches`/`no_resolved_destination`), same send execution. | Medium (new file, but its content is a logic-preserving extraction of already-shipped, already-tested code — imports/exports/parameter names necessarily change, the resolution/send behavior does not) |
| `supabase/functions/evaluate-rules/index.ts` | Backend (Protected Core) | Replace the inline F5c block (current lines 1064-1159) with a single call to the new shared function, passing `config`, `rule.id`, `rule.user_id`, `userName`, `supabaseUrl`, `interFnKey`. **Pure extraction — no logic change, no behavior change for this function.** | Low — the 8 existing F5c automated tests (`tests/catalogue/session-2026-07-17-f5c-taskactions-resolution.ts`) become the acceptance gate proving the extraction didn't alter behavior |
| `supabase/functions/report-location-event/index.ts` | Backend (Protected Core — Geofencing, Notification routing) | Inside `fireLocationAction` (function body lines 713-926), add one call to the new shared function immediately after the existing fan-out's own summary log (current line 923, `console.log(... fan-out (${mode}) ...)`) and before the function's `return successCount > 0` (current line 925) — the exact same position F5c's block occupies in `evaluate-rules` relative to its own equivalent fan-out log, so the primary alert always fires first regardless of task-action outcome, identically to the existing documented ordering guarantee. **This is the actual bug fix** — the first time this function will ever read `config.task_actions`. | Medium-High — new capability on a live Protected Core path; see §4 |

**No change to `supabase/functions/fire-pending-dwells/index.ts`.** Confirmed by direct code read (`report-location-event/index.ts:435` and `:659`) that both the real-time enter/exit path and the dwell-timer-completion path (`from_pending_dwell: true`, POSTed back by `fire-pending-dwells`) call the exact same `fireLocationAction` function. Fixing that one function covers both firing paths with zero changes to `fire-pending-dwells` itself — stated explicitly per governance's "if a function is not affected, state that explicitly" requirement.

**No change to `hooks/useOrchestrator.ts`.** Whether the write-time path should warn the user or block the combination until this fix ships is a product/UX decision, explicitly deferred to Wael per Phase 1 §5 — not part of this implementation (§5 below).

No schema change, no new table, no new Edge Function beyond the shared module (which is a library file, not a deployed function in its own right — same category as the existing `_shared/alert_body.ts`).

---

## 2. Proposed change (for Phase 3 review — not yet applied)

**Implementation philosophy — directly answers Phase 1 §6 item 5's architectural question.** `report-location-event` does **not** become architecturally unified with `evaluate-rules` — their cron-vs-event timing models are genuinely different (Phase 1 §6 option 2 was already informally ruled out: routing real-time geofence crossings through a cron poller would break the responsiveness a geofence alert needs), and Phase 1 §7 explicitly held that fully merging both functions' channel-selection/self-alert-detection logic is premature, broader-blast-radius work. Instead, only the one piece of logic that has now drifted twice (`task_actions` execution, following the same already-shared pattern as `buildAlertBody` in `_shared/alert_body.ts`) becomes a shared module both functions call. This is a deliberate middle ground: it closes this specific defect and removes one future drift vector, without attempting the larger unification Phase 1 declined to approve.

**(a) New shared module** — `supabase/functions/_shared/task_actions.ts`:
```ts
// Extracted from evaluate-rules/index.ts's F5c block (2026-06-15 original ship,
// 2026-07-17 fail-closed fix) — shared so report-location-event can execute
// task_actions too (B10g). Logic is unchanged from the existing, already-
// tested F5c behavior; only the call site changes.
export async function executeTaskActions(
  config: Record<string, unknown>,
  ruleId: string,
  userId: string,
  userName: string | null,
  supabaseUrl: string,
  interFnKey: string,
): Promise<void> {
  // NOTE (flagged for Phase 3, per Phase 2 review — not decided here): this
  // six-positional-parameter signature is a plausible candidate for a single
  // context-object parameter instead, e.g. executeTaskActions({ config, rule,
  // userName, admin, supabaseUrl, interFnKey }) — future parameters wouldn't
  // require signature changes, call sites read more clearly, and testing/
  // mocking is easier. Phase 2 is not changing the signature shown here;
  // Phase 3 should explicitly evaluate whether to adopt the object form
  // before this ships, since it's cheap to change now and expensive later
  // once both call sites depend on positional order.
  const taskActions = Array.isArray((config as any).task_actions)
    ? ((config as any).task_actions as Array<Record<string, string>>)
    : Array.isArray((config as any).tasks)
      ? ((config as any).tasks as Array<Record<string, string>>)
      : [];
  if (taskActions.length === 0) return;

  // ... exactly the existing resolvedActions / taskSends logic, verbatim,
  // from evaluate-rules/index.ts current lines 1077-1158 — fail-closed on
  // name_too_short / zero_matches / ambiguous_multiple_matches, logs
  // no_resolved_destination for anything still unresolved, sends via
  // send-sms / send-user-email exactly as today.
}
```
**No change to the extracted logic's behavior** — this is a lift, not a rewrite. Phase 3 should specifically verify this via diff comparison against the current F5c block, not just a description.

**(b) `evaluate-rules/index.ts` — replace the inline block with a call:**
```ts
// F5c block (current lines 1064-1159) replaced with:
await executeTaskActions(config, rule.id, rule.user_id, userName, supabaseUrl, interFnKey);
```
`userName` is already computed earlier in the same function (existing code, unchanged).

**(c) `report-location-event/index.ts` — add the call inside `fireLocationAction`, after the existing fan-out:**
```ts
// after the existing line: console.log(`[report-location-event] Rule ${rule.id} fan-out (${mode}): ${parts.join(' ')} — ${successCount}/${sends.length} ok`);
await executeTaskActions(config, rule.id, rule.user_id, userName, supabaseUrl, interFnKey);
return successCount > 0; // existing return, unchanged
```
`config` and `rule.user_id` are already in scope (existing code, lines 719 and the function signature). `userName` is already computed at lines 743-746 (`const { data: settings } = await admin.from('user_settings')...; const userName = settings?.name ?? null;`) — no new query needed.

### Acceptance criteria — what Phase 5 must verify

1. A location-triggered rule with a `task_actions` entry resolving to exactly one real contact now actually sends when the geofence fires — the fix's core purpose, and the first time this will be observably true for any real alert.
2. A location-triggered rule with an ambiguous or unresolvable `task_actions` name fails closed, logging the same four named reasons F5c already established (`name_too_short`/`zero_matches`/`ambiguous_multiple_matches`/`no_resolved_destination`) — now visible in `report-location-event`'s logs.
3. **Regression guard, time-triggered path:** all 8 existing F5c automated tests continue to pass unchanged after the extraction — proves the refactor in `evaluate-rules` altered nothing about currently-working time-trigger `task_actions` behavior.
4. **Regression guard, location-alert path:** the existing, already-working location-alert fan-out (self-alerts, third-party `to_phone`/`to_email`, self-overrides, all four/five channels — confirmed working per B10g Phase 1 §2.2) is completely unaffected. The new call is strictly additive, placed after the existing fan-out returns its result.
5. A dwell-based location alert (`fire-pending-dwells` → `report-location-event` with `from_pending_dwell: true`) with a `task_actions` entry also correctly executes it, confirming the shared function covers both the real-time and dwell-completion paths without any change to `fire-pending-dwells` itself.
6. New regression tests added to `tests/catalogue/*.ts` and registered in `tests/runner.ts`, per `CLAUDE.md` Rule 15a — at minimum: source-assertion tests confirming `report-location-event` now calls `executeTaskActions`, and that `evaluate-rules`'s call site matches (both call the same shared function, not two independently-drifted copies).

---

## 3. Regression impact

| Area | Impact | Why |
|---|---|---|
| Voice commands | Not affected. No `naavi-voice-server` file touched. Voice can already create a location alert with `task_actions` (write-time, unaffected by this fire-time-execution fix) exactly as any other surface can. | No overlap |
| Geofencing | **Affected — this is the exact function being modified** (`report-location-event`'s `fireLocationAction`, the real-time geofence-crossing handler). Must be strictly additive, placed after the existing fan-out completes, to avoid touching the working self/third-party alert delivery B10g Phase 1 §2.2 already confirmed works today. | Direct change, must not alter existing behavior above the new call |
| Gmail integration | Not affected. | No overlap |
| Calendar integration | Not affected. | No overlap |
| Reminders | Not affected. `reminders`/`check-reminders` are separate from `action_rules`/`evaluate-rules`/`report-location-event` (per `CLAUDE.md`'s Rule Store section). | No overlap |
| SMS / call alerts | **Affected — this is the fix's purpose** for the location-alert side (new sends that never happened before). Also affected on the time-trigger side in a pure-refactor sense — `evaluate-rules`'s existing SMS/email sends must be provably unchanged after extraction, verified by the 8 existing F5c tests continuing to pass. | Direct purpose (location side); regression-proof required (time-trigger side) |
| Onboarding | Not affected. | No overlap |
| Staging build | N/A in the app-build sense (Edge Function change only, no AAB). Per `CLAUDE.md`'s STAGING-FIRST rule: deploy `_shared/task_actions.ts` + both modified functions to the staging project (`xugvnfudofuskxoknhve`) first, verify there (including the exposure check confirming no staging user is unexpectedly affected — already checked as zero, §0 above, but re-verify no new rows appeared since), and only promote to production (`hhgyppbxgmjrwdpdubcx`) after Wael explicitly confirms. | Staging-first is mandatory for all Edge Function changes |

---

## 4. Risk classification

**Overall: Medium-High.** Protected Core (Action Rules + Notification routing + Geofencing) — automatically requires full Phase 1-8 per governance §4.

**The risk shape here is the mirror image of F5c's, not the same shape — this matters for how Phase 3/6 should evaluate it.** F5c was a strict *tightening*: its downside was bounded to "a send that used to happen might now fail closed" (fewer sends, never more). This fix's location-alert side (§1(c)) is the opposite direction — it is a strict *addition*: its downside is "a send that never happened before will now happen." That is a fundamentally different risk to reason about, because there is no existing behavior to regress against on that specific path — the question is not "did we break something that worked," it's "will this newly-enabled send ever misfire the way F5c's send did."

**This is why the shared module in §1(a)/§2(a) matters beyond code reuse:** the location-alert side reuses F5c's already-hardened, already-incident-tested fail-closed resolution logic exactly as-is, rather than a fresh, independently-written resolution implementation for `report-location-event`. The new capability is bounded by the same correctness guarantee (exactly one match required) that closed the F5c incident — it cannot reintroduce F5c's wrong-recipient failure mode, because it is the same code, not a re-derivation of it.

**Current blast radius is zero**, confirmed directly (§0 above: 0 of 11 staging location rules and 0 of 19 production location rules currently carry `task_actions`) — this fix has no effect on any alert that exists today. It only matters for location alerts with `task_actions` created after this ships, which lowers urgency (nothing is silently broken for a real user right now) without removing the reason to fix it (the write path already lets users create this combination with no warning, per Phase 1 §2.1 — the gap will start mattering the first time someone naturally does).

The `evaluate-rules` extraction (§1(b)) is **Low** risk in isolation — a pure lift-and-call with the 8 existing F5c tests as a direct, mechanical regression check.

---

## 5. Explicitly deferred (per Phase 1 §5/§6/§7 — not part of this Phase 2's implementation)

- **Whether `useOrchestrator.ts`'s write path should warn or block a location alert's task strings until this fix ships** — Wael's product/UX decision (Phase 1 §5 item 4), not a code question, not part of this implementation.
- **Full unification of `report-location-event` and `evaluate-rules`'s entire fan-out logic** (channel selection, self-alert detection, self-overrides) — Phase 1 §7 explicitly held this premature; only the `task_actions` piece is shared here, answering Phase 1 §6 item 5 with a deliberate middle ground rather than the full merge.
- **Whether B10d (WhatsApp channel-preference gap) should be fixed using this same "extract to a shared module" pattern** — a natural next candidate now that the pattern exists and has a precedent, but a separate ticket with its own Phase 1/2, not bundled into this fix.
- **T1a (architecture integrity audit)** — this fix and its extraction pattern are offered as one data point/precedent for that broader audit (per Phase 1 §7's three-instance count), not a substitute for it. **The recurring shape, made explicit per Phase 2 review:** duplicate implementation → feature added to one copy → the second copy is forgotten → silent regression → bug discovered (independently, later, by accident) — F5c, B10d, and B10g are three iterations of this exact loop on the same two functions. T1a is the mechanism that should catch this loop systematically rather than one incidental discovery at a time.
- **The shared module's parameter-passing style** (six positional parameters vs. a single context object) — flagged inline in §2's code sketch for Phase 3 to explicitly evaluate, not decided in this Phase 2.

---

## 6. Next step

Once this document carries a full approval verdict, it moves to Phase 3 — Technical Review (Before Coding), mandatory per governance §4 (Protected Core) and given the Medium-High risk classification in §4. **No code has been written.**

The eventual Phase 3 authorization should name exactly: the new `supabase/functions/_shared/task_actions.ts` file and its exact exported signature (including a decision on the positional-vs-context-object interface question above); the specific one-line replacement in `evaluate-rules/index.ts`; the specific one-line addition (plus its exact placement, after the fan-out log, before the return) in `report-location-event/index.ts`; and nothing else — no opportunistic changes to either function's existing fan-out/channel-selection logic, no schema changes, no change to `fire-pending-dwells/index.ts` or `hooks/useOrchestrator.ts`.

---

## 7. Phase 2 review record (2026-07-17)

Reviewer feedback received via Wael. Three items, all adopted:

1. **Wording softened in §1's file table** — "byte-for-byte-equivalent lift" replaced with "logic-preserving extraction," since imports/exports/parameter names necessarily change during extraction even though resolution/send behavior does not. More technically precise than the original claim.
2. **Shared-module interface flagged for Phase 3, not decided in Phase 2** — added an explicit code-level note in §2 (and a corresponding bullet in §5) recommending Phase 3 evaluate a single context-object parameter (`executeTaskActions({ config, rule, userName, admin, supabaseUrl, interFnKey })`) instead of six positional parameters, for easier future extension, testing, and call-site clarity. Phase 2's own signature is unchanged — this is explicitly a question for Phase 3 to resolve, not a Phase 2 decision.
3. **§5's T1a bullet made explicit** — spelled out the recurring failure loop this document (and F5c, and B10d) are all instances of: duplicate implementation → feature added to one copy → the second copy forgotten → silent regression → bug discovered by accident, later. Reviewer's assessment: this loop, not the missing `task_actions` call itself, is the most important thing this document and its predecessors demonstrate, and is exactly what T1a should be scoped to catch systematically.

Reviewer's stated assessment: stays within approved Phase 1 scope, answers Phase 1's posed architectural question, minimizes blast radius, improves maintainability, provides a clear regression strategy, avoids opportunistic refactoring, technically well justified. No substantive issues identified.

**This is the reviewer's assessment of the plan's quality — it is not, by itself, authorization to begin Phase 3.** Per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3): moving to Phase 3 requires Wael's own separate, explicit go-ahead for this specific transition, regardless of what this review verdict says. That has not yet been given.

---

## 8. Status

**Phase 2 drafted and reviewed 2026-07-17, revisions above adopted. Phase 3 has NOT started and will not start until Wael gives explicit, separate approval for this specific transition.**
