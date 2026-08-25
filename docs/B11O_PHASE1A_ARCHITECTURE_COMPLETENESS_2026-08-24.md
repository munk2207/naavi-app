# B11o — Phase 1A: Architecture Completeness Review

**Work item:** [[B11o]] — Voice `DELETE_EVENT` sends no `user_id`
**Date:** 2026-08-24
**Scope:** **STRICTLY VOICE STAGING** — branch `staging`, `naavi-voice-server/src/index.js`. Ruled by Wael, Phase 0.
**Status:** **RESUBMITTED FOR APPROVAL, 2026-08-24** — the first submission was written before Phase 1's live test had been run. See the deviation note below. **No code written.**

> ### ⚠️ Process deviation — this document was drafted before the evidence it depended on
>
> **Wael, 2026-08-24:** *"You did not wait for the test result, and you just produced the next phase. Why?"*
>
> **What happened.** Phase 1 §6 named the user-facing reproduction as **not yet proven**. Wael approved Phase 1 and authorized Phase 1A, and this document was produced immediately — while the one piece of evidence Phase 1 itself flagged as missing was still outstanding.
>
> **Authorization was not the problem; sequencing was.** Had the call shown Claude never emitting the `delete_event` tool — a live alternative at the time, and consistent with what Wael reported hearing (*"I can not do that"*) — Phase 1's root cause would have been wrong, and every architecture conclusion below would have rested on a false premise and been discarded.
>
> **The test cost one phone call.** It was available for the asking and would have taken minutes.
>
> **The result confirmed the diagnosis verbatim** (Phase 1 §6). **That is luck, not vindication.** The same shortcut with a different outcome would have wasted a phase, and the shortcut is what is being recorded — not the outcome.
>
> **This document is therefore resubmitted rather than treated as standing**, so its approval rests on a review made with the evidence in hand.
>
> **Nothing in §1–§6 required revision after the test.** The reproduction confirmed the capability is reachable and the failure is the predicted one; no ownership, classification, or drift conclusion changed.

---

## 0. Architecture Reference Version Verification

Required by Governance §3, Phase 1A.

| | |
|---|---|
| **Document** | `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` |
| **Architecture Version** | **2026.07.18.11** |
| **Revision** | 11 — 2026-08-24, [[B11x]] Phase 6 |
| **Last Verified line** | 2026-07-18 |
| **Read in full this session** | Yes |

**Recorded so Phase 8 can confirm nothing newer superseded it mid-implementation.** Revision 11 landed earlier today; if a revision 12 appears before merge, its effect on this work item must be evaluated explicitly, not assumed harmless.

---

## 1. The six mandatory questions

**Q1 — What is the architectural owner of the affected capability?**

Two answers, and the distinction is the whole of this review:

- **The capability** — Calendar writes (create/delete event) — is owned by **Shared Core**, `munk2207/naavi-app/supabase/functions/*` (Reference §0a, §2).
- **The defect** sits in the **Voice entry point**, owned by `munk2207/naavi-voice-server` (§0a).

**Q2 — Is the capability Shared Core, Duplicated, or Platform-specific?**

**Shared Core.** Reference §2: *"Calendar — writes (create/delete event) | `create-calendar-event`, `delete-calendar-event` (Shared Core) | Genuinely shared."* §5a's Duplication Inventory lists Calendar writes under ✅ Shared, with no Duplicated mark.

Note the contrast the Reference itself draws: calendar **reads** are Duplicated (§2, ADR 0002, Priority 2). **Writes are not.** This work item touches writes only.

**Q3 — If duplicated, were all documented implementations investigated?**

Not applicable — the capability is not duplicated. Answered explicitly rather than skipped, per the Architecture Scope Rule's requirement that silence is unacceptable in either direction.

**Q4 — If not, which implementations were investigated and which were not?**

All three callers of the single shared implementation were investigated. None excluded. See §2.

**Q5 — Does the documented problem scope match the Architecture Reference?**

**Yes.** Phase 1 locates the defect in the Voice entry point's translation of a request into a Shared Core call. Reference §3 states entry points *"translate requests rather than implement business logic"* — a failure to carry the caller's identity across that boundary is a translation defect, which is exactly where Phase 1 places it.

**Q6 — Is any documented implementation excluded from the investigation?**

**No implementation is excluded from investigation.** Two surfaces are excluded from *modification*, each with justification recorded in §2 below and in Phase 0's scope table. Both were checked before being excluded — they were not assumed out of scope.

---

## 2. Architecture Scope Rule / Cross-Repository Verification Rule

Every bullet is tagged per the **Verification Provenance Rule** (Governance v3.7).

### Shared Core

- **`supabase/functions/delete-calendar-event/index.ts` — Freshly verified this session.** Evidence: `:60-84`, the dual-auth branch; `:86-90`, the `No Google token found` return. **Behaves correctly given what it is sent.** The `else` branch's missing user filter is correct by design — it expects a user JWT so RLS narrows the row set. The defect is that voice sends a service-role key into a branch built for a JWT. **Requires no change. Must not be changed** — see §3.

### Voice

- **`naavi-voice-server/src/index.js` on branch `staging` — Freshly verified this session.** Evidence: `:4625-4637` omits `user_id`; `:4517` shows `userIdOverride` is a parameter of the enclosing function; `:6650` shows it is populated from the caller's phone; `:1029` shows `getUserId()` is a stub returning `null`. **This is the defect and the only authorized change.**

- **`naavi-voice-server/src/index.js` on branch `main` (production) — Freshly verified this session.** Evidence: `git show origin/main:src/index.js`, lines `4625-4633`, byte-identical to `staging`. **Carries the same defect. Excluded from modification** by Wael's Phase 0 ruling and STAGING-FIRST. Not "unaffected" — deliberately deferred.

### Mobile

- **`lib/calendar.ts` — Freshly verified this session.** Evidence: `:538` sends `{ query }` through `supabase.functions.invoke`, which attaches the signed-in user's JWT. The Edge Function's `else` branch then works as designed — RLS resolves exactly one row. **Not affected. No matching change required.**

- **`supabase/functions/naavi-chat/intentHandlers.ts` — Freshly verified this session.** Evidence: `:1124` sends `user_id: userId` with the service key, taking the admin branch. **Not affected. No matching change required.**

### Demo

- **Demo line, both environments — Freshly verified this session.** Evidence: `/voice/demo/name:7676` and `/voice/demo/confirm:7714` both route into `buildDemoWalkthroughGateTwiml`; `/voice/demo/connect` at `:8580` — the only route that opens a media stream for a demo caller — is referenced by no TwiML anywhere in the file. Action execution is unreachable. **Not affected.**

  **This bullet exists because an earlier pass got it wrong.** The first analysis claimed demo *was* affected, reasoning that it deploys the same branch. Wael rejected that on the ground that calendar does not work on the demo line at all, and he was right. Reference §7 rule 5 — *a shared Edge Function does not guarantee shared behavior; confirm the caller actually reaches the path* — is the rule that was skipped.

---

## 3. Architecture integrity of the proposed direction

Phase 1's preferred alternative (A) is to pass the `user_id` the voice server already holds.

| Check | Answer |
|---|---|
| Modifies Shared Core? | **No** |
| Modifies an Entry Point? | **Yes** — and that is where the defect is. The entry point is being made to *translate correctly*, which moves it toward §3's stated ideal, not away. |
| Introduces new duplication? | **No** — it uses the Edge Function's existing admin branch rather than adding a second path. |
| Eliminates existing duplication? | **No** |
| Modifies Protected Core? | **Yes** — Voice orchestration and Calendar integration (§4). Full Phase 1–8 already in force. |
| Changes a capability's ownership? | **No.** Shared Core keeps the capability; the entry point keeps translation. §4's Ownership Change Rule is not triggered. |

**Rejected alternatives B and D would have failed this table.** Both put user-resolution logic into Shared Core to compensate for an entry point that declined to supply it — the wrong direction under §0.4, and a change to a function two other callers depend on.

---

## 4. Architecture Drift check

**Verdict: NO DRIFT. The Architecture Reference is accurate for this area.**

Stated plainly because the temptation is to find drift and look thorough. Tested directly:

- **Is *"Genuinely shared"* true for calendar writes?** Yes. All three callers invoke the same Edge Function — mobile (`lib/calendar.ts:538`), `naavi-chat` (`intentHandlers.ts:1121`), voice (`src/index.js:4626`). No surface reimplements deletion inline.
- **Does the Reference claim anything B11o contradicts?** No. §2 classifies *where the implementation lives*. It makes no claim that every caller invokes it correctly — and §7 rule 5 explicitly warns the opposite.

**This is not the [[B11k]] situation.** B11k's Phase 1A found a capability with no row at all, which made §5a's *"Full* Duplication Inventory" inaccurate — Outcome 3 under the Architecture Drift Rule, and implementation was correctly blocked until the Reference was fixed. Here the row exists, says the right thing, and needs no edit. **No Reference update is required by this work item.**

---

## 5. One observation — recorded, not acted on

**Within the Reference's single row "Calendar — writes (create/delete event)", voice's create half works and its delete half does not.**

Freshly verified this session: all four `create-calendar-event` call sites in the voice server pass a user identifier — `:4526`, `:4598`, `:4975`, `:13464`. The one `delete-calendar-event` call site, `:4626`, does not.

This does **not** make the Reference wrong (§4 above). It is an observation that a row describing two operations as one unit can be half-broken from one surface without the row being false.

**Second instance of the same shape.** [[B11j]] was voice `ADD_CONTACT` omitting the caller's identity when calling a genuinely-shared Edge Function, fixed 2026-08-21 for `ADD_CONTACT` alone. B11o is the same shape. Two instances is not yet the four the Reference's own §5 Audit Trigger requires, and it is a different pattern from the one that trigger describes.

**Bounded honesty about what was and was not checked.** All 11 cases in `executeAction` were scanned exhaustively — `DELETE_EVENT` is the only one omitting the identity. The capability's own five call sites were checked individually. **The remaining ~55 Edge Function call sites elsewhere in the 13,000-line voice server were not exhaustively audited.** A heuristic scan produced results too noisy to support a claim in either direction, so no claim is made.

**Recommended disposition:** record as a general-list item — *"audit voice Edge Function call sites for omitted user identity"* — per the standing instruction that findings go to the general list and work stays on the priority item. **Not part of B11o. Not investigated further here.**

---

## 6. Independent Review Rule — both reviews

Governance §3 requires Phase 1 to pass two independent reviews. Neither implies the other.

| Review | Verdict | Basis |
|---|---|---|
| **1. Technical Investigation Review** | **PASS** | Root cause proven with file, line, branch, the missing field, the branch it forces, the measured row counts (4 staging / 5 production, re-measured today), and the literal HTTP response. No statement rests on inference. Recorded in Phase 1 §7. |
| **2. Architecture Completeness Review** | **PASS** | Owner identified and distinguished from defect location; capability correctly classified Shared Core, not duplicated; all three callers verified with `file:line` provenance tags; both excluded surfaces checked before exclusion; no drift; proposed direction preserves ownership and adds no duplication. |

**One caveat on the second verdict, stated rather than buried:** the ~55 unaudited call sites in §5 are outside this capability and outside Phase 0's scope. They are named here so an external reviewer can weigh whether that boundary is acceptable, rather than discovering the gap from an inferential leap in prose.

---

## 7. Outstanding before Phase 2

**Nothing. The live reproduction has been run — Wael, 2026-08-24.** Full log evidence in Phase 1 §6.

```
[Claude DIAG] tool_use name=delete_event jsonStr: {"query": "David meeting"}
[Claude DIAG] converted actions: 1 (DELETE_EVENT)
[Action] Executing: DELETE_EVENT
[Action] DELETE_EVENT result: No Google token found
[Process] action DELETE_EVENT → failure
```

**Two architecture-relevant confirmations from that call**, recorded here because they bear on this review rather than on Phase 1's diagnosis:

1. **The Shared Core function behaved exactly as §2 describes.** It received a request with no `user_id`, took the `else` branch, failed to resolve, and returned its own error string. **Nothing in Shared Core needs to change** — the live evidence supports the §3 conclusion rather than merely the code read.

2. **Voice calendar *reads* worked in the same call** — `fetchLiveCalendarEvents — 635ms, 8 event(s) from 2 calendar(s)`, and Naavi read the meeting's time back correctly. Consistent with §2's split: reads are Duplicated (ADR 0002) and use a different path; writes are Shared Core. **The read/write asymmetry in the Reference is confirmed live, not assumed.**

**No code written. No mechanism authorized.** Phase 1A→2 requires Wael's own separate word; a reviewer's "Approved" is not sufficient (Governance §3, Phase-Gate Approval Rule).
