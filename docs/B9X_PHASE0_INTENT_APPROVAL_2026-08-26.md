# B9x — Phase 0: Intent Approval (v2)

> ## ⚠️ SUPERSEDED — 2026-08-26
>
> **Replaced by `docs/B9X_PHASE0_INTENT_APPROVAL_V3_2026-08-26.md`. Retained as the record.**
>
> **Why:** this version fixed the problem *when the alert fires*. Wael identified the better fix the
> same day — fix it *when the alert is created*, by having Naavi ask who the recipient is. Location
> alerts are explicitly exempt from the confirm-then-act rule in two places
> (`get-naavi-prompt:385-386`, `naavi-chat:4179`), which is why the bad rule was ever saved.
>
> Prevention also fixes both reproductions; this version could only ever fix one.

| | |
|---|---|
| **Item** | B9x — an alert meant for another person silently fires to the user instead |
| **Date** | 2026-08-26 |
| **Governance** | `docs/AI_DEVELOPMENT_GOVERNANCE.md` v4.1, §3 Phase 0 |
| **Supersedes** | `docs/B9X_PHASE0_INTENT_APPROVAL_2026-08-25.md` — retained as the record, not deleted |
| **Architecture Reference** | **2026.07.18.12** (revision 12, `0e20f8a`, 2026-08-26) — to be re-confirmed at Phase 8 |
| **Classification** | **Protected Core** — Action Rules + Notification routing. Full Phase 1–8. |
| **Status** | Awaiting Wael's approval. **No code written.** |

---

## Why this replaces the first Phase 0

The original was written from B9x's holding-list row, which named
`supabase/functions/evaluate-rules/index.ts:825` as the root cause. **That row is wrong.**

- **Phase 1** proved location alerts cannot fire through `evaluate-rules` at all — its trigger
  `switch` has no `location` case. The real site is `report-location-event/index.ts:765` and `:772`.
- **Phase 1A** proved the identical faulty expression also exists in `evaluate-rules:833/838`, where
  it affects the other five trigger types, and that no third implementation exists anywhere —
  including the voice server and the mobile client, both grepped directly.
- **Wael ruled on 2026-08-26** that both functions are in scope.

The first Phase 0's In Scope was therefore built on a false premise. Rather than amend a contract
mid-flight, it is superseded. Under Governance §3, Phase 0 is the contract for the rest of the
project; a contract with a wrong premise in it should be replaced, visibly.

---

## The defect, in plain language

You set an alert meant to text somebody else. Naavi never worked out who that person was. When the
alert fires, the message comes to **you** instead — worded as though it was always meant for you.

The other person never hears from you. Nothing warns you. You believe the message was sent.

**The mechanism, in one sentence:** the code decides who an alert is for by asking whether it has any
delivery addresses on it. "Nobody else was ever meant to get this" and "somebody was meant to get
this and we never worked out their number" both leave the rule with no addresses — so the two are
indistinguishable, and both are treated as the first.

---

## User Intent

> When an alert was meant for another person and Naavi cannot determine who that person is, Naavi
> must not silently deliver it to the user as though it were the user's own alert.

**Phase 0 does not choose the remedy.** Whether the answer is to refuse to fire, to tell the user the
recipient was never resolved, to re-resolve from the stored name at fire time, or some combination,
is Phase 2's decision.

---

## Success Criteria

1. In **both** dispatch functions, a rule carrying an unresolved third-party recipient no longer
   fires to the user framed as a self-alert.
2. **Genuine self-alerts are unchanged.** *"Alert me when I arrive at Costco"* — no recipient named,
   none intended — must still fire to the user on all their enabled channels, exactly as today. This
   is the behaviour the current code was deliberately written to protect
   (`report-location-event:761-764`, `evaluate-rules:828-832`), and protecting it is part of success.
3. The two functions agree afterwards. `report-location-event:763-764` claims it *"mirrors the same
   fallback in evaluate-rules/fireAction"* — that statement must be true when this work closes, in
   whichever direction Phase 2 chooses.

Per Governance §3's note for bug fixes, Success Criteria does not require the root cause to be proven
here — Phase 1 already proved it.

---

## In Scope

- **`supabase/functions/report-location-event/index.ts:765, 772`** — `noRecipient` feeding
  `isSelfAlert`. Fires location alerts. B9x's actual defect.
- **`supabase/functions/evaluate-rules/index.ts:833, 838`** — the identical expression. Fires time,
  email, calendar, weather and contact_silence alerts. **In scope by Wael's ruling of 2026-08-26.**
- The mirroring comment at `report-location-event:763-764`, so it does not become false.
- Regression tests in `tests/catalogue/`, per Rule 15a — covering both the fixed behaviour and the
  genuine-self-alert behaviour that must not change.
- Deployment to the **Supabase staging project** (`xugvnfudofuskxoknhve`) only.

### A consequence of shared code, not scope creep

Both functions are Shared Core. There is no voice copy and no mobile copy — Phase 1A verified this by
direct grep of `naavi-voice-server/src/index.js` and `hooks/useGeofencing.ts`, both of which returned
zero matches. Fixing voice's instance of this bug necessarily fixes the app's, because there is only
one implementation. Per Wael's ruling of 2026-08-25: *"it does not mean if the voice component is
shared by others you should stop; it means do not expand to the others."*

---

## Out of Scope

Per Governance Rule 0.2, anything not listed as In Scope is Out of Scope whether or not it appears
here. These are named because Phase 1A identified them and silence about an identified implementation
is itself a violation.

| Excluded | Why |
|---|---|
| **Mobile write path** — `hooks/useOrchestrator.ts:862-917` | Different mechanism: explains how a bad rule is *created*, not why firing misdirects. Unconfirmed. Excluded since the first Phase 0. |
| **Voice write paths** — `naavi-voice-server/src/index.js:4867`, `:4913`, `:12614` | Same reason. Verified to exist and verified not to participate in fire-time behaviour. |
| **B10a** | Separate item, separate root cause. Its rules arrive with `to_phone` populated with the user's own number, so `isSelfByPhone` is true and the `noRecipient` branch is never reached. This fix changes nothing for it. |
| **`_shared/task_actions.ts`** | Already handles this correctly — resolves at fire time, skips on zero or ambiguous matches. Not defective. No change. |
| **`check-reminders`** | Contains no self/third-party logic at all. Not affected. |
| **Any production deploy** | Staging only. |
| **Any mobile client build** | Not required by this work. |
| **Any other holding-list item, rule, or document** | Including the eight findings of 2026-08-25, all ruled on and closed. |

---

## Constraints

- **Staging only.** Supabase staging project `xugvnfudofuskxoknhve`. No production deploy without
  Wael's explicit instruction.
- **Protected Core → full Phase 1–8.** Wael's own separate, explicit approval at every phase
  transition. A reviewer's "Approved" is never authorization to proceed.
- **Rule 15a** — regression tests must exist, be registered, and pass before this closes.
- **Rule 1b** — nothing found during this work becomes a new tracked item without being explained to
  Wael first and approved individually.
- Findings outside scope are recorded in phase documents as description only. Writing *"for the
  general list"* in a phase document does not put anything on the general list.

---

## Completion Criteria

1. Remedy chosen and approved (Phase 2), reviewed before coding (Phase 3).
2. Both functions fixed, and the mirroring claim between them true.
3. Deployed to Supabase staging.
4. The reproduction no longer misdirects.
5. Genuine self-alerts verified unaffected — on both dispatch paths.
6. Regression tests added, registered, green.
7. Architecture Reference re-checked at Phase 8; updated in this work item if anything architectural
   changed. Revision 12 already landed at Phase 1A.
8. Wael's explicit approval recorded at each phase gate.

---

## Two decisions recorded, so neither is implied

### 1. Rule 17 is not satisfied, and is still open

**The symptom has never been observed.** Both of B9x's reproductions captured a badly-saved rule;
neither has been watched firing. The row says so directly: *"traced from data + code, not yet watched
fire live."*

For `evaluate-rules` there is **no reproduction at all** — its inclusion rests entirely on reading the
code.

Rule 17 requires the user-facing test that exposes the bug to be run before a fix is coded, and to
close the item rather than fix a phantom if it does not reproduce. **That test has not been run.**
Before Phase 2 closes, one of the following is needed, and it is Wael's decision under Governance §3:

1. Fire one of these rules on staging and observe the misdirection directly, or
2. Wael accepts the code-plus-data trace in place of a live fire — itself a phase-gate decision
   requiring his explicit sign-off, not Claude's judgment.

### 2. Wael was shown the argument against including `evaluate-rules`, and chose to include it

He was told there is no reproduction for that function, and that Rule 17 points toward excluding it.
He selected inclusion on 2026-08-26. Recorded here so the decision is visible rather than inferred
from the scope list.

---

## Approval

Phase 0 requires Wael's explicit approval before Phase 1 is re-confirmed against it and Phase 2
begins. Phases 1 and 1A are already complete and remain valid — both were written after the premise
correction, and neither depends on the superseded Phase 0's scope.
