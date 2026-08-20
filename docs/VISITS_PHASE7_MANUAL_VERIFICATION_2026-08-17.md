# Visits Flow Redesign — Phase 7 — Manual Verification

Status: CLOSED (2026-08-17) — verified live by Wael on staging build 325, business sign-off given.

---

## Background

Phase 5 (`VISITS_PHASE5_EVIDENCE_2026-08-15.md`) implemented the Visits redesign (build 324) and listed a 5-item manual test checklist as "Phase 7, not yet performed." No Phase 6 or Phase 7 evidence document existed prior to this one — that gap is what this document closes.

## What was tested

Wael ran a live recording on the **Naavi Staging** app (build 325) on 2026-08-17, guided step by step, with screenshots captured at each stage and shared for direct review — not a summary after the fact.

**Scenario:** a 2-speaker ("Dr" / "Robert") mock visit with 4 distinct action items, spoken aloud and recorded through the app's "Visits" button:
- Amoxicillin, 1 capsule twice daily (09:00 and 21:00), for the full 10-day course
- A blood test
- A follow-up appointment with the doctor
- An email to a literal address (`whwh2207@gmail.com`) about questions following the appointment

## Evidence observed, in sequence

1. **Speaker labeling modal** — title and both speakers entered, "Done — Extract Action Items" tapped.
2. **Compound message sent to chat** — the 4 extracted actions converted into one imperative message and sent through the existing `send()` → `naavi-chat` pipeline.
3. **Confirmation gate held** — Naavi responded *"Here are your 4 actions: ... Say yes to confirm all, or no to cancel."* Nothing was created at this point.
4. **Email required its own explicit action** — the email surfaced as a separate Draft card (To/Subject/Body shown in full) with independent **Send** / **Discard** buttons, distinct from the compound "yes."
5. **Real, cross-verified outcomes** — not just app-reported success:
   - **Gmail**: the actual sent email was found via `in:sent` search — subject "Questions Regarding Recent Appointment," from Robert to `whwh2207@gmail.com`, timestamped 8:16 PM, matching the app's own timestamp exactly.
   - **Google Calendar**: Amoxicillin doses correctly placed twice daily (9am/9pm) for all 10 days (Aug 17–26); Blood Test correctly placed Aug 21, 9am; Follow-Up appointment placed Aug 31, 10am.
   - A duplicate Follow-Up entry on Aug 31 was observed and attributed by Wael to having run the same scripted test twice — expected, since one-off `CREATE_EVENT` appointments have no dedup logic by design (unlike location alerts, which do). Not treated as a defect.

## What this confirms

The core defect Phase 1 identified — silent auto-execution with no confirmation — is fixed and working as designed: nothing fired before explicit confirmation, and the email path required its own separate explicit Send action on top of the compound "yes." This matches the Phase 2 approved design exactly (`channel: "email"` always excluded from auto-send, always rendered as a real Draft card).

## What was not separately re-tested in this session

Phase 5's full 5-item checklist included two items not walked through live in this session: a visit where a mentioned recipient's name doesn't clearly resolve to a contact (ambiguous-name handling), and triggering Visits while an unconfirmed chat draft is already pending. The ambiguous-name case has isolated API-level evidence from Phase 2 (Proof 2, a direct `naavi-chat` call with "Dr. Ahmed" as a name-only recipient, correctly returning `channel: "email", to: "Dr. Ahmed"`) but was not re-verified as a full on-device recording flow here.

## Decision (Wael, 2026-08-17)

**Build 325's Visits flow satisfies the business need, based on the verification above — not based on the absence of a written Phase 7 document.** The untested edge cases noted above are explicitly not pursued further as a condition of this sign-off. This closes Phase 7 and the project's earlier documentation gap for this work item.
