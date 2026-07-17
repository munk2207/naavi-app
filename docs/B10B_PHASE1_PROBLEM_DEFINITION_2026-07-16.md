# B10b — Phase 1: Problem Definition

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1. No code is written in this document. Touches Protected Core (Action Rules).

**Origin:** spun out of `docs/B10A_PHASE2_CHANGE_PLAN_2026-07-16.md` §2, per Wael's Phase 2 review (2026-07-16) — a genuine, separate user-facing defect found while tracing B10a's failure path, kept as its own governance item per one-defect-per-ticket discipline (same precedent as B9z's spin-out from F19 Track B-1e).

---

## 1. What exactly is broken

`naavi-voice-server/src/action_rule_confirm_gate.js`'s `failSpeechForAction` helper always speaks one hardcoded message on any post-confirmation `SET_ACTION_RULE` (time-trigger) failure — regardless of the actual reason for the failure.

---

## 2. Evidence

`action_rule_confirm_gate.js:73-75`:

```js
function failSpeechForAction(action, result) {
  return "I couldn't set that up — you may already have an identical alert. Say what you'd like to change.";
}
```

Its own comment (`:63-67`) states why it's this general: *"executeAction()'s SET_ACTION_RULE branch only returns `{ success: boolean }`... no granular error code... The only failure mode proven so far (Phase 1 §2g) is a duplicate-timestamp conflict, so the message names that as the likely cause without asserting it as the only one."* — written 2026-07-15, true at the time.

That premise changes once B10a ships. `executeAction`'s `SET_ACTION_RULE` case already returns a granular reason on the F12 resolution-failure path — `return { success: false, error: resolved?.kind || 'resolve_failed' }` (`index.js:4782`) and `return { success: false, error: 'resolve_failed' }` (`index.js:4786`) — but today this path is unreachable from a real call, because B4y's block (see B10a) always runs first and satisfies F12's guard condition before F12 ever executes. Once B10a's reorder ships, this path becomes reachable in production for the first time.

The call site that invokes `failSpeechForAction` already has the full result object available:

```js
// index.js:9941-9944
const result = await executeAction(saved, userId);
const speechOut = result?.success
  ? 'Done.'
  : actionRuleGate.failSpeechForAction(saved, result || {});
```

`result.error` is passed in (as part of `result`) but never read inside `failSpeechForAction` — the function ignores its second argument's `error` field entirely and always returns the same string.

---

## 3. Root cause statement

| Finding | Root cause | Confidence |
|---|---|---|
| A resolution failure (unresolvable/ambiguous contact name) would be spoken to the user as "you may already have an identical alert" — an inaccurate explanation despite the actual failure reason already being available | `action_rule_confirm_gate.js:73-75` hardcodes its failure message and never inspects `result.error`, which is already passed in at the only call site (`index.js:9941-9944`). Written when duplicate-timestamp conflict was the only provably-reachable failure mode; that assumption is invalidated once B10a's reorder makes F12's fail-closed path reachable from this call site. | **Proven** — direct file:line citation of the hardcoded string, the unread `result.error` parameter, and the call site that already has the data available |

**Root cause not yet proven for:** whether any *other* failure mode besides duplicate-timestamp-conflict and resolve-recipient-failure can reach this function. Not asserted; out of scope below.

---

## 4. What alternatives were considered

- **"Just let B10a ship without this fix — is the message really a big deal?"** Rejected — presenting an irrelevant likely cause when the actual cause is already known and available is exactly the class of problem Rule 18 exists to prevent (Naavi must not misrepresent facts to fit her own constraints/limitations). The message is not vague-and-safe ("something went wrong"); it names a specific, often-irrelevant cause while the real one sits unused in `result.error`.
- **"Fold this into B10a instead of a separate ticket."** Rejected per Wael's explicit Phase 2 review — different user-facing defect (spoken explanation vs. recipient resolution), kept separate for one-defect-per-ticket discipline and unambiguous "what was B10a" answerability later.
- **"Extend `executeAction`'s SET_ACTION_RULE return value to a richer error taxonomy across all failure modes, not just resolution failures."** Not proposed here — broader than the demonstrated defect (only the resolution-failure path is proven reachable and provably wrong today); would need its own justification per governance's Complexity Tax (AI CODING DISCIPLINE #23) if raised later.

---

## 5. Scope boundary

Covers only: `failSpeechForAction`'s failure to branch on `result.error` for the resolution-failure case that B10a's reorder will make reachable. Does not cover: `executeAction`'s error taxonomy more broadly, the duplicate-timestamp-conflict message itself (unchanged, still valid for that case), or any other confirm-gate (`list_confirm_gate.js` is a separate, unrelated file).

---

## 6. Sequencing dependency on B10a

This defect is currently **not user-reachable** — F12's fail-closed return path exists in code but B4y's block (unreordered) always runs first, so `failSpeechForAction` never actually receives a resolution-failure `result.error` in production today. B10b's fix can be designed and reviewed independently of B10a, but should not be deployed ahead of B10a, or the new branch is dead code and untestable against a real call.

---

## 7. Next step

Phase 2 — Change Planning, per governance. The fix is narrow: branch on `result.error` inside `failSpeechForAction`, speaking a message naming the contact-resolution problem when `error` is one of `not_found`/`ambiguous`/`resolve_failed`, and falling back to the existing duplicate-alert message otherwise (preserving its still-valid original case). One candidate approach is to mirror the location handler's existing spoken behavior for the same failure kinds (`index.js:11433`/`:11439`) — not pre-selected here, so Phase 2 remains free to evaluate that or alternatives. Not yet designed in detail — that's Phase 2's job, not this document's.

---

## 8. Phase 1 review record (2026-07-16)

Technical review based on ChatGPT's review, documented by Wael.

**Editorial refinements (adopted):**
1. "a specific, false reason" (§3 table) and "a specific, wrong stated reason" (§4) reworded to "an inaccurate explanation despite the actual failure reason already being available" / "presenting an irrelevant likely cause when the actual cause is already known and available" — the defect isn't that the message asserts something false (it's phrased as a possibility, "you may already have an identical alert"); it's that it names an irrelevant likely cause while the real, known cause goes unused.
2. §7's "mirroring the location handler's existing spoken pattern" reworded to "one candidate approach is to mirror..." — avoids anchoring Phase 1 to a specific implementation choice, leaving Phase 2 free to evaluate alternatives.

**Governance compliance checklist (all ✅):** single defect, evidence-based, root cause identified, scope bounded, alternatives considered, no implementation, sequencing documented.

**On the B10a relationship:** the review noted this document makes the dependency clear without merging the two items — B10a restores correct recipient resolution; B10b improves the spoken explanation when recipient resolution fails.

**Verdict: Approved for Phase 2.** "The document clearly identifies a separate user-facing defect, demonstrates the root cause with direct evidence, and maintains appropriate scope by limiting itself to the failure-message behavior. It also correctly documents the implementation dependency on B10a while avoiding unnecessary expansion into broader error-handling redesign. From a governance perspective, keeping this as a standalone item strengthens the audit trail and preserves the one-defect-per-ticket discipline."
