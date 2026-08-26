# B9x — Phase 0: Intent Approval

> ## ⚠️ SUPERSEDED — 2026-08-26
>
> **Replaced by `docs/B9X_PHASE0_INTENT_APPROVAL_2026-08-26.md`. Retained as the record; do not work
> from it.**
>
> **Why:** this document's In Scope was built on B9x's holding-list row, which names
> `evaluate-rules/index.ts:825` as the root cause. Phase 1 proved that wrong — location alerts cannot
> fire through `evaluate-rules` at all. The real site is `report-location-event/index.ts:765`/`:772`.
> The two functions' roles are inverted from what this document assumed, and Wael ruled on 2026-08-26
> that both are in scope.
>
> Superseded rather than amended, because Governance §3 makes Phase 0 the contract for the rest of
> the project — a contract with a false premise inside it should be replaced visibly, not quietly
> edited.

| | |
|---|---|
| **Item** | B9x — unresolved third-party recipient on a location alert silently fires to the user instead |
| **Date** | 2026-08-25 |
| **Governance** | `docs/AI_DEVELOPMENT_GOVERNANCE.md` v4.1, §3 Phase 0 |
| **Classification** | **Protected Core** — Action Rules + Notification routing. Full Phase 1–8. |
| **Status** | Awaiting Wael's approval. No implementation has begun. |

---

## The defect, in plain language

You set an alert meant to text somebody else. Naavi never worked out who that person was. When the
alert fires, the message comes to **you** instead — worded as though it was always meant for you.

The other person never hears from you. Nothing tells you that. You believe the message was sent.

---

## User Intent

> When an alert was meant for another person and Naavi cannot determine who that person is, Naavi
> must not silently deliver it to the user as though it were the user's own alert.

**Phase 0 does not decide the remedy.** Whether the right answer is to fail, to warn the user, to
block the rule at creation time, or something else, is a Phase 1/Phase 2 decision. Phase 0 fixes
only what "done" means.

---

## Success Criteria

1. A rule carrying an unresolved third-party recipient no longer fires to the user framed as a
   self-alert.
2. **Genuine self-alerts are unchanged.** "Alert me when I arrive at Costco" — no recipient named,
   none intended — must still fire to the user exactly as it does today. This is the behaviour the
   current code was deliberately written to protect (see the comment at
   `supabase/functions/evaluate-rules/index.ts:828-832`), and protecting it is part of success, not
   a side concern.

Per Governance §3's note for bug fixes, Success Criteria does not require the root cause to already
be proven — that is Phase 1's job.

---

## In Scope

- `supabase/functions/evaluate-rules/index.ts` — the fire-time self-alert determination.
  Currently `noRecipient` at **line 833** and `isSelfAlert` at **line 838**. *(B9x's holding-list
  row cites `:825` and `:830`; the file has shifted since the row was written. The mechanism is
  exactly as the row describes — only the addresses moved.)*
- **Phase 1A verification of `report-location-event`** — the twin Shared Core function that fires
  location alerts. The Architecture Reference (§2, §5 Priority 1b) records these two as an
  independently-maintained pair with overlapping fan-out logic held together only by a code comment.
  If it carries the same fault, it is the same defect in the same capability and is part of this
  item. If it does not, that is stated and it stays untouched.
- Deployment to the **Supabase staging project** (`xugvnfudofuskxoknhve`) only.
- A regression test in `tests/catalogue/`, per Rule 15a.

### A consequence of shared code, stated up front so it is not mistaken for scope creep

`evaluate-rules` is Shared Core. It is one function serving both the phone and the app. Fixing
voice's instance of this bug necessarily fixes the app's instance too, because there is only one
piece of code. This is not an expansion of the work — it is the nature of the component the fault
lives in. Recorded here explicitly per Wael's ruling of 2026-08-25: *"it does not mean if the voice
component is shared by others you should stop; it means do not expand to the others."*

---

## Out of Scope

Everything below is explicitly prohibited under this Phase 0. Per Governance Rule 0.2, anything not
listed as In Scope above is Out of Scope regardless of whether it appears here.

- **The mobile write-path lead** in `hooks/useOrchestrator.ts:862-917` (the compound/numbered-list
  location-alert insert path with no contact-resolution call). B9x's row flags this as a strong but
  **unconfirmed** candidate for how the bad rows were created. It is a different mechanism on a
  different surface, and going near it is exactly the expansion Wael ruled out.
- **B10a** — voice's time-trigger recipient failure. A separate item with its own Phase 1 already
  complete.
- **Any production deploy**, of anything, to any environment.
- **Any mobile client build.**
- Any change to genuine self-alert behaviour.
- Any other holding-list item.
- Any documentation, rule, or governance change outside this item — including the eight findings
  raised on 2026-08-25, all of which Wael has ruled on and closed.

---

## Constraints

- **Staging only.** Supabase staging project `xugvnfudofuskxoknhve`. No production deploy without
  Wael's explicit instruction.
- **Protected Core → full Phase 1–8.** Wael's own separate, explicit approval is required at every
  phase transition. A reviewer's "Approved" is never authorization to proceed.
- **Rule 15a** — a regression test must exist, be registered, and pass before the item closes.
- **Rule 1b** — no new tracked item may be created out of anything found during this work without
  explaining it to Wael first and getting his approval for that specific item.
- Findings outside this item's scope are recorded in the phase documents as description. They are
  not added to the holding list, and writing "for the general list" in a phase document does not put
  anything on the general list.

---

## Completion Criteria

1. Root cause proven with direct evidence — `file:line`, not inference (Phase 1).
2. Phase 1A answers, explicitly, whether `report-location-event` carries the same fault.
3. Fix deployed to Supabase staging.
4. The reproduction no longer misdirects.
5. Genuine self-alerts verified unaffected.
6. Regression test added, registered, and green.
7. Architecture Reference updated in this same work item if anything architectural changed.
8. Wael's explicit approval recorded at each phase gate.

---

## Open accuracy note — Rule 17 is not yet satisfied

The session handoff into this work states that Rule 17 is "already satisfied by two live
reproductions." **Re-read directly against the holding-list row, that is not accurate, and it
matters.**

Both reproductions captured **bad stored data** — rules saved with a recipient name that was never
resolved to a phone number:

- Reproduction 1 (mobile, production build 301): `{"to": "Abdyn"}`, row `bb48e478-c863-4832-8f62-750a6a70cf3b`
- Reproduction 2 (voice, production): name never captured at all, row `dadde218-5634-4a7b-ab15-1c1b6f98a9bf`

The row's own words: *"Not yet observed at actual fire time (both are dwell-based location alerts,
not yet triggered) — traced from data + code, not yet watched fire live."*

So the **precondition** is proven. The **symptom** — a message actually arriving at the wrong person
— has never been observed. Rule 17 requires the user-facing test that exposes the bug to be run
*before* coding a fix, and that test has not been run.

**This is a Phase 1 gate, and it is Wael's decision, not this session's.** Either:

1. Fire one of these rules on staging and observe the misdirection directly, or
2. Wael accepts the code-plus-data trace as sufficient evidence in place of a live fire — which is
   itself a phase-gate decision under Governance §3 and needs his explicit sign-off, not Claude's
   judgment call.

This will be raised on its own at Phase 1, not buried in a phase summary.

---

## Approval

Phase 0 requires Wael's explicit approval before Phase 1 begins. No investigation beyond the
read-only work already recorded here has been performed, and no code has been written.
