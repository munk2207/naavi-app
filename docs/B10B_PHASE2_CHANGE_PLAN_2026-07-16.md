# B10b — Phase 2: Change Planning

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. No code is written in this document. Touches Protected Core (Action Rules).

Builds on `docs/B10B_PHASE1_PROBLEM_DEFINITION_2026-07-16.md` (root cause proven: `action_rule_confirm_gate.js`'s `failSpeechForAction` always speaks a hardcoded duplicate-alert message on any post-confirmation failure, ignoring `result.error` even though it's already passed in). Unblocked now that B10a's reorder is live (`docs/B10A_PHASE6_TECHNICAL_REVIEW_2026-07-16.md` §9) — F12's fail-closed path in the general `SET_ACTION_RULE` handler is reachable in production for the first time, so this function can now actually receive a resolution-failure `result.error`.

---

## 1. The fix

`failSpeechForAction` branches on `result.error`, using wording consistent with the existing location-trigger handler (`index.js:11433`, `:11439`) rather than inventing new copy — per Rule 18 (present facts consistently, don't reformat), the same failure kind should sound the same to the user regardless of which handler produced it.

```js
function failSpeechForAction(action, result) {
  const toName = String(action?.action_config?.to ?? '').trim();
  switch (result?.error) {
    case 'ambiguous':
      return toName
        ? `You have more than one contact named ${toName} — say their full name and try again.`
        : "You have more than one contact with that name — say their full name and try again.";
    case 'not_found':
    case 'invalid':
    case 'resolve_failed':
      return toName
        ? `I don't have a contact named ${toName}. Tell me their email or phone number directly, or save them to your contacts first.`
        : "I couldn't find that contact. Tell me their email or phone number directly, or save them to your contacts first.";
    default:
      return "I couldn't set that up — you may already have an identical alert. Say what you'd like to change.";
  }
}
```

**Why the `default` branch keeps the original message:** the duplicate-timestamp-conflict failure (`executeAction`'s `return { success: res.ok }` when the INSERT is rejected, e.g. by a unique-constraint conflict) never sets `result.error` at all — only F12's three early returns do. So `result?.error` is `undefined` for that case, falling to `default`, preserving the original message exactly for the case it was originally written for. No existing behavior changes; only the previously-unreachable-in-production branches gain accurate wording.

**Where the contact name comes from:** `action.action_config.to` — the original name Claude emitted before resolution was attempted (confirmed present at this call site: `saved` in `index.js:9938-9944` is the pre-execution action object, same shape verified in B10a Phase 1's evidence, e.g. `"action_config":{"to":"Bob",...}`).

---

## 2. Files that will change

| File | Classification | Change | Explanation |
|---|---|---|---|
| `naavi-voice-server/src/action_rule_confirm_gate.js` | Backend / Shared Logic — **Protected Core** (Action Rules) | `failSpeechForAction` (currently `:73-75`) rewritten to branch on `result.error`, per §1 above. | Prevents a newly-reachable failure mode (unresolvable/ambiguous contact name) from giving the user an inaccurate explanation despite the actual failure reason already being available (Rule 18). |
| `tests/catalogue/*.ts` (new or extended, per Rule 15a) | Configuration / Test | Regression tests: (1) `ambiguous` error speaks the multi-contact message; (2) `not_found`/`resolve_failed` speaks the no-contact message; (3) no `error` field (duplicate-conflict case) still speaks the original message unchanged. | Locks in the fix and guards the still-valid original case from regressing. |

No other files. `naavi-voice-server/src/index.js` is not touched — B10a already wired `result.error` through to this call site; nothing upstream needs to change.

---

## 3. Risk classification

| Dimension | Rating | Reasoning |
|---|---|---|
| Implementation risk | **Low** | Single pure function, no I/O, no new dependencies — a `switch` on an already-available field. |
| Regression risk | **Low** | Only one call site invokes this function (`index.js:9944`); the previously-only-reachable case (`undefined` error) is explicitly preserved as the `default` branch, verified by test (3) above. |
| Architecture risk | **Low** | No new architecture; reuses wording already approved and live elsewhere in the same file. |

Lower across the board than B10a — the function is smaller, has exactly one caller, and the fix reuses existing, already-approved copy rather than writing new user-facing language from scratch. Still classified as touching Protected Core (Action Rules) per governance §4, so Phase 3 review is still required before coding, same procedure as B10a.

---

## 4. Regression impact (explicit answer required for every item, per governance §3)

| Area | Affected? | Explanation |
|---|---|---|
| Voice commands | **Yes, narrowly** | Only the spoken failure message after a time-trigger `SET_ACTION_RULE` confirmation fails. The action's actual success/failure behavior (whether a row is created) is unchanged — this only changes what Naavi says when it fails. |
| Geofencing | No | Location-trigger handler already has its own spoken failure messages; not touched. |
| Gmail integration | No | No shared code path. |
| Calendar integration | No | Different case block entirely. |
| Reminders | No | Different case block entirely. |
| SMS / call alerts | **Yes, narrowly** | Same scope as "Voice commands" above — wording only, not delivery behavior. |
| Onboarding | No | No onboarding flow reaches this function. |
| Staging build | **Not applicable, same known gap as B10a** | `naavi-voice-server` has no staging tier distinct from production; a manual voice call test (triggering an ambiguous/not-found name after confirming) is the equivalent gate before this ships. |

---

## 5. What alternatives were considered

- **A single generic "I couldn't resolve that contact" message for all three F12 failure kinds** — rejected in favor of reusing the location handler's existing two-message split (ambiguous vs. not_found/invalid), since they call for different follow-up actions from the user (say the full name, vs. give the number/email directly) — collapsing them would lose information the user needs to recover.
- **Writing new wording instead of reusing the location handler's** — rejected; Rule 18 favors presenting the same fact the same way regardless of which code path produced it, and the location handler's wording is already live and approved.
- **Broader error-taxonomy refactor of `executeAction`'s return value** — not proposed, per B10b Phase 1 §4 (out of scope, no demonstrated need beyond the resolution-failure case).

---

## 6. Scope boundary

Covers only `failSpeechForAction`'s branching logic and its three new regression tests. Does not cover: `naavi-voice-server/src/index.js` (unchanged, no wiring needed), the duplicate-timestamp-conflict case (preserved, not modified), or any other confirm-gate file (`list_confirm_gate.js` is separate and unrelated).

---

## 7. Next step

Awaiting Wael's review before Phase 3 (Technical Review). Given B10b's smaller footprint, Phase 3 may be lighter than B10a's — but still required per governance §4 (Protected Core).
