# B9x — Phase 2: Change Plan (v3 — after the Phase 7 failure)

| | |
|---|---|
| **Item** | B9x — an alert meant for another person silently fires to the user instead |
| **Date** | 2026-08-27 |
| **Supersedes** | `B9X_PHASE2_CHANGE_PLAN_V2_2026-08-26.md` |
| **Governance** | v4.2, §3 Phase 2 |
| **Risk** | **HIGH** — Protected Core (Action Rules) |
| **Status** | **No code written.** Phase 3 re-review required. |

**Governing principle (Phase 0 v3, unchanged):** *Resolve silently when possible. Ask only when
resolution is impossible or ambiguous. Never add confirmation to a successfully resolved location
alert.*

---

## 1. Why v2 failed — proven live, not theorised

`fc71146` deployed to staging and **did not fire.** Three consecutive trials of
*"Send sms to Abdyn when I arrive at the office"* returned the alert with `action_config = {"to":
"Abdyn"}`, unresolved — the exact Reproduction 1 shape B9x exists to prevent.

**The staging logs are unambiguous:**

```
[timing] 1293ms | Universal gate classification: {"level":"action","intent":"SET_ACTION_RULE",...}
[timing] 1293ms | Level action SET_ACTION_RULE — deterministic action emitted immediately
```

and the unconditional `T2-intercept-check` line that prints immediately above v2's branch **never
appears at all.**

**`naavi-chat:3352-3356`** — the deterministic "Universal gate" branch, whose own comment reads:

> `// Immediate-emit intents: DRAFT_MESSAGE, SET_ACTION_RULE(location)`

returns at `:3356`, **966 lines before** v2's branch at `:4322`. v2 is unreachable on this path.

---

## 2. ⭐ The verification failure that caused it — named, because the process depends on it

**Phase 1A §3.3 stated:** *"Layer 2 (the deterministic classifier) — not involved.
`naavi-chat/intentHandlers.ts` contains no location handling — a grep for `location` returns
nothing. **Freshly verified this session.** Location alerts always route through Path B."*

**The grep was real. The conclusion was wrong.** The deterministic gate for location lives in
`index.ts`, not `intentHandlers.ts`. One file was searched; a claim about *every* deterministic path
was written.

**This is a Verification Provenance failure in substance rather than in form.** The bullet carried
the "freshly verified" tag honestly — a check *was* run — but the check was narrower than the claim
it supported. **The tag records whether evidence was gathered. It cannot record whether the evidence
covers the claim.**

**Nothing caught it.** Not Phase 1A's own review, not Phase 3, not Phase 6 — all three passed over
it. **The first live call caught it immediately.** That is the argument for Phase 7 existing, and for
Rule 17.

---

## 3. The complete map, this time by exhaustive search

Every construction site of a location `SET_ACTION_RULE` in `naavi-chat`, found by searching for
`trigger_type: 'location'` across all files in the function:

| # | Site | Path | Reached by v2's fix? |
|---|---|---|---|
| **A** | `convertLocationToolToActionRule():176` | Path B — Claude tool-use | ✅ **yes** |
| **B** | `buildActionConfirm():2048` | Universal gate — deterministic, returns at `:3356` | ❌ **no — this is the failure** |

**There is no third site.** Both are in `index.ts`; `intentHandlers.ts` has none.

**Which requests go where has not been characterised** and this plan does not guess. *"Send sms to
Abdyn when I arrive at the office"* went to B on 3/3 trials. Phase 7 must exercise **both**.

---

## 4. The corrected remedy — one helper, two call sites

**`buildActionConfirm` is synchronous** (`:1897`, no `async`, returns a plain object). It **cannot**
await a network call, so the resolution cannot live inside it. Both call sites are async.

**Proposed:** extract v2's logic into one async helper — `resolveLocationRecipient(action, userId)`
— returning either `{ ok: true }` (mutating `action_config` in place) or
`{ ok: false, message: string }`. Called from exactly two places:

1. **`:3352-3356`**, before the immediate-emit return — if it fails, return the message with
   `actions: []` instead of emitting.
2. **`:4322`**, the existing v2 branch — replaced by a call to the helper.

**Behaviour is unchanged from v2's approved table.** All six `resolve-recipient` outcomes, the
self-override short-circuit, the wrong-channel fail-closed case the Phase 6 reviewer ruled must stay,
ambiguity asking for the full name, and `task_actions` untouched. **Only the number of call sites
changes.**

**Complexity Tax (#23).** The simpler alternative — copy the block to the second site — is rejected:
two copies of a fail-closed security check with nothing keeping them in step is the exact pattern
ADR 0005 records three incidents for. One helper, two callers.

---

## 5. Files that will change

| File | Classification | Change | Risk |
|---|---|---|---|
| `supabase/functions/naavi-chat/index.ts` | Backend / Shared Logic | extract v2's branch into `resolveLocationRecipient()`; call it at `:3352` and `:4322` | **High** |
| `tests/catalogue/session-2026-08-27-b9x-location-recipient.ts` | Tests | assert **both** call sites exist; keep all 11 existing cases | Low |

**No prompt change** — `get-naavi-prompt` is already correct as shipped in `fc71146` and needs
nothing further. **No mobile, voice, database, cron, or dependency change.**

---

## 6. Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **No file changes.** | Behaviour changes: actions now arrive resolved from **both** paths. The orchestrator's own guard at `:3493` short-circuits either way. |
| **Voice** | **No.** | Voice does not call `naavi-chat`. Verified in Phase 1A and unchanged. |
| **Shared Core** | **Yes.** | One file, one new helper, two call sites. |
| **Database** | **No.** | No schema, migration, or RLS change. |
| **Cron** | **No.** | Untouched. |
| **API contracts** | **No.** | `action_config` shape unchanged; fields populated earlier. |
| **Tests** | **Yes.** | Existing suite extended; no case removed. |

---

## 7. Mandatory Architecture Impact Checklist

| Question | Answer |
|---|---|
| Modifies **Shared Core**? | **Yes.** |
| Modifies an **Entry Point**? | **No.** |
| Introduces **new duplication**? | **No** — a helper specifically to avoid a second copy. |
| **Eliminates** duplication? | **Partially**, as v2. **Still does not resolve ADR 0001.** |
| Modifies **Protected Core**? | **Yes** — Action Rules. |

**Architecture Drift:** unchanged from Phase 6's assessment — `naavi-chat` remains the third
`resolve-recipient` call site. **The number of *internal* call sites does not change the Reference's
claim.** The Phase 8 update condition stands exactly as written.

---

## 8. Regression Matrix — what the second call site newly touches

`:3352-3356` is the immediate-emit return for **`DRAFT_MESSAGE` and `SET_ACTION_RULE(location)`**
(its own comment). The helper must be gated on `trigger_type === 'location'` so **`DRAFT_MESSAGE`
is not affected** — it has its own recipient handling and is out of scope.

| Consumer | Effect |
|---|---|
| `DRAFT_MESSAGE` via the same return | **None** — gated out by trigger type. Must be asserted by test. |
| Path B location alerts | Unchanged from `fc71146`. |
| Universal-gate location alerts | **Now resolved** — the failure this plan fixes. |
| `buildActionConfirm` itself | **Not modified.** It stays synchronous; the helper runs at the call site after it returns. |

---

## 9. Test plan additions (Rule 15a)

Existing 11 cases retained. Added:

12. **Both call sites invoke the helper** — the assertion that would have caught this failure.
13. **`buildActionConfirm` remains synchronous** — a guard against someone later trying to resolve inside it.
14. **`DRAFT_MESSAGE` through the same return is unaffected.**

**And a process change, because a source-assertion suite cannot catch this class:** Phase 7 must
exercise **both** paths live. v2's 11 tests all passed while the fix was unreachable. **Static tests
proved the shape and could not prove the reach.**

---

## 9a. Review outcome — **APPROVED**, external reviewer, 2026-08-27

The design is approved: **one shared async helper, `resolveLocationRecipient()`, called from both
execution paths** — *"preferable to copying the security-sensitive resolution block."* The behaviour
contract is unchanged: self-overrides, all six resolver outcomes, wrong-channel fail-closed,
ambiguity handling, `task_actions` exclusion.

**On the verification failure (§2), the reviewer's own words, because the distinction is the
transferable lesson:** *"Searching only `intentHandlers.ts` supported the narrow statement that
location handling was absent there, but **not** the broader conclusion that no deterministic location
path existed."*

**Two things called out as required:**

1. **The helper must remain strictly gated to `trigger_type === 'location'`**, because the
   immediate-return region also handles `DRAFT_MESSAGE`. **The isolation regression test is
   required, not optional.**
2. The reviewer endorsed the testing conclusion in §9: *"static source assertions cannot establish
   execution-path reachability; Phase 7 must exercise both paths live."*

**Explicitly closed and not to be reopened:** the Phase 6 rulings on wrong-channel fail-closed
behaviour and the all-actions-discard limitation.

**Decision: APPROVED — proceed to the Phase 3 re-review before coding.** *(That re-review was
submitted as `B9X_PHASE3_TECHNICAL_REVIEW_V2_2026-08-27.md`, commit `cc9c36c`, and awaits its own
verdict. **This is a Phase 2 approval and is not authorization to code.**)*

---

## 10. Not decided here

Phase 3 re-review before any code. The Phase 6 reviewer's two rulings — keep the wrong-channel case,
accept the all-actions discard as a known limitation — **carry forward unchanged** and are not
reopened.
