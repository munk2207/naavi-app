# B9x — Phase 3: Technical Review v2 (re-review after the Phase 7 failure)

| | |
|---|---|
| **Item** | B9x — an alert meant for another person silently fires to the user instead |
| **Date** | 2026-08-27 |
| **Supersedes** | `B9X_PHASE3_TECHNICAL_REVIEW_2026-08-26.md` — its rulings carry forward, see §6 |
| **Plan under review** | `B9X_PHASE2_CHANGE_PLAN_V3_2026-08-27.md` |
| **Risk** | **HIGH** — Protected Core (Action Rules) |
| **Status** | **Submitted for external review. No code written.** |

---

## 1. What changed, and why this is back here

The previously approved Phase 3 authorised **one** call site. Live testing proved that call site is
unreachable for the request shape B9x is about: `naavi-chat:3352` returns 966 lines earlier, from a
deterministic branch whose own comment names location alerts.

**Only the implementation boundary changes: one call site becomes two, via one shared helper.**
No behaviour in the approved table changes. Both Phase 6 rulings carry forward untouched.

---

## 2. The two call sites, and why a helper rather than two copies

| | Site A — Path B | Site B — Universal gate |
|---|---|---|
| Action built at | `convertLocationToolToActionRule():176` | `buildActionConfirm():2048` |
| Resolution runs at | `:4322` (already shipped in `fc71146`) | **`:3352`, new — before the immediate-emit return** |
| Async? | yes | yes at the call site — **`buildActionConfirm` itself is synchronous (`:1897`) and cannot await** |

**Both sites are fail-closed security checks.** Two independently-maintained copies of one is the
exact pattern ADR 0005 records three drift incidents for. One helper,
`resolveLocationRecipient(action, userId)`, called from both.

**Only one site executes per request.** Site B returns immediately; Site A is reached only when the
gate falls through to Claude (`:3344`, *"Non-time `__FALLTHROUGH__` … let Claude respond
naturally"*). No double resolution is possible.

---

## 3. Assumptions surfaced

| Assumption | Status |
|---|---|
| `confirmed.actions[].action_config` can be mutated at `:3352` before the return | **Verified** — the object is constructed fresh inside `buildActionConfirm` (`:2003`, `{ ...params.action_config }`) and returned; nothing else holds a reference |
| The deterministic gate carries the recipient name at all | **Verified** — `:2017-2019` forwards `params.to_name ?? params.to` into `action_config.to` (F15, 2026-07-09). The live log confirms it: `{"to":"Abdyn"}` arrived through this path |
| Self-overrides are already separated at this site | **Verified** — `:2032-2037` writes `self_override_*` into their own fields, never into `to` (F15 Defect A). The helper's existing short-circuit therefore behaves identically at both sites |
| `buildActionConfirm` need not become async | **Verified** — the helper runs at the call site, after it returns. Its signature is untouched. |
| Which requests take which path | **NOT characterised, and not guessed.** *"Send sms to Abdyn when I arrive at the office"* took Site B on 3/3 trials. **Phase 7 must exercise both.** |

---

## 4. Hidden coupling checked

- **⚠️ `DRAFT_MESSAGE` shares the `:3356` return.** Its own comment: *"Immediate-emit intents:
  DRAFT_MESSAGE, SET_ACTION_RULE(location)"*. The helper **must** be gated on
  `trigger_type === 'location'`, or every drafted message acquires a recipient-resolution step it
  does not want and has its own handling for. **This is the sharpest regression risk in the change
  and is asserted by a new test.**
- **`missingParam` branch** (`:3348`) returns before the emit branch. Untouched.
- **`REMEMBER`** (`:3358`) is a sibling branch, unreached for location. Untouched.
- **`task_actions`** — still not resolved at creation, at either site. Phase 6 ruling preserved.
- **Latency on the common case** — the helper returns immediately when no name is present, so
  *"alert me at Costco"* pays nothing.

---

## 5. Isolation

The helper engages only when: the action is `SET_ACTION_RULE`, `trigger_type === 'location'`, no
`self_override_*` is set, `to`/`to_name` is non-empty, and both `to_phone` and `to_email` are empty.
Identical at both sites, because it is the same function.

---

## 6. Rulings carried forward from the superseded Phase 3 and from Phase 6

Not reopened, and not up for re-decision:

1. **`resolve-recipient`, not `lookup-contact`**, on the location path. Time branch unchanged.
2. **No channel-aware retrofit** of the time branch's phone-only filter.
3. **Primary recipient only** — `task_actions` untouched.
4. **The wrong-channel fail-closed case stays** (Phase 6 §4.1: *"Otherwise the implementation could
   pass an unresolved location rule downstream and recreate the exact failure class B9x is intended
   to prevent."*).
5. **The all-actions discard is an accepted known limitation** (Phase 6 §4.2) — **and explicitly must
   not become another work item.** It now applies at Site B too: a failure there returns
   `actions: []`, discarding any companion action in the same turn. **Same accepted limitation, one
   more place it can occur — named here rather than left for the reviewer to infer.**
6. **Ambiguity asks for the full name**, no numbered pick (Wael, 2026-08-27).

---

## 7. Implementation Boundaries Confirmed *(to be completed by the reviewer)*

- `supabase/functions/naavi-chat/index.ts` — extract the shipped `:4322` block into
  `resolveLocationRecipient()`; call it at `:4322` and at `:3352` before the immediate-emit return.
- `tests/catalogue/session-2026-08-27-b9x-location-recipient.ts` — extend; **no existing case removed**.

**No prompt change** — `get-naavi-prompt` shipped correctly in `fc71146`. No mobile, voice, database,
cron, or dependency change. No opportunistic refactoring. `buildActionConfirm`'s signature is not
touched.

---

## 8. Deferred Architectural Decisions

1. **Characterising which phrasings route to which path.** Not approved for this implementation —
   the fix covers both, so routing behaviour need not be predictable for correctness. Worth
   revisiting if a future item depends on knowing.
2. **⭐ A lead on Reproduction 2, recorded and NOT acted on.** `:2011-2016`'s comment states this
   branch *"previously never read [the recipient], silently dropping the recipient before
   useOrchestrator's resolve-recipient call ever saw it"* — fixed by F15 on 2026-07-09.
   **Reproduction 2's rule was created 2026-07-15, after that fix**, so the comment does not by
   itself explain it. **A candidate mechanism, not a cause.** Phase 1 v2 §5's finding stands: the
   cause is unproven. **No tracked item created — Rule 1b.**

---

## 9. Testing — the process change matters more than the cases

**v2's 11 static tests all passed while the fix was unreachable.** They proved the shape and could
not prove the reach. Three new cases (both call sites present, `buildActionConfirm` still
synchronous, `DRAFT_MESSAGE` unaffected) narrow that gap but **do not close it** — a static test
cannot prove which path a live request takes.

**Phase 7 must exercise both paths live**, with the Non-Determinism Rule's 3 trials per
behaviour-changing case.

---

## 10. What the reviewer is asked to decide

1. The revised boundary — one helper, two call sites.
2. That gating on `trigger_type === 'location'` is sufficient to protect `DRAFT_MESSAGE` (§4).
3. §6.5 — the accepted all-actions discard now applying at a second site.
4. Gates 1–5 (§13), and a decision: Approved / Approved with Mandatory Changes / Rejected.
