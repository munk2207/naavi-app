# B9x — Phase 1A: Architecture Completeness Review

| | |
|---|---|
| **Item** | B9x — unresolved third-party recipient on a location alert silently fires to the user instead |
| **Date** | 2026-08-26 |
| **Governance** | `docs/AI_DEVELOPMENT_GOVERNANCE.md` v4.1, §3 Phase 1A (mandatory — Protected Core) |
| **Phase 0** | `docs/B9X_PHASE0_INTENT_APPROVAL_2026-08-25.md` — approved 2026-08-25 |
| **Phase 1** | `docs/B9X_PHASE1_PROBLEM_DEFINITION_2026-08-25.md` — approved 2026-08-25 |
| **Status** | Awaiting review. **No code written.** All work below is read-only. |

---

## 0. Architecture Reference Version Verification

| | |
|---|---|
| **Reference** | `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` |
| **Version used for this review** | **2026.07.18.11** (revision 11) |
| **Last commit to that file** | `f06cf1c`, 2026-08-24 — the revision 11 edit itself |
| **Newer version superseding it?** | **No.** Verified by `git log` on the file this session. |

To be re-confirmed before Phase 8 merge, per the Version Verification requirement.

---

## 1. The six mandatory questions

### 1.1 What is the architectural owner of the affected capability?

**Shared Core** — the Edge Functions codebase, `munk2207/naavi-app/supabase/functions/*`, per the
Reference's Ownership Model (§0a).

The capability is *Action Rules — execution/firing* (§2).

### 1.2 Is the capability Shared Core, Duplicated, or Platform-specific?

**Shared Core, and internally duplicated within Shared Core.** Per §2 and §5 Priority 1b (ADR 0005):
`evaluate-rules` and `report-location-event` are two independently-maintained functions with
overlapping fan-out logic, held together only by a code comment.

It is **not** duplicated across surfaces. Neither the voice server nor the mobile client contains any
implementation of it — see §2.

### 1.3 If duplicated, were all documented implementations investigated?

**Yes — both, plus an exhaustive sweep for undocumented ones.**

A repository-wide search for the defective expression (`noRecipient`, `isSelfAlert`) across
`supabase/functions/` returns matches in **exactly two files** and no others:

- `report-location-event/index.ts:765, 772, 914, 951`
- `evaluate-rules/index.ts:833, 838, 1016, 1081`

There is no third implementation.

### 1.4 Which implementations were investigated, and which were not?

All were investigated. Full table with provenance tags at §2.

### 1.5 Does the documented problem scope match the Architecture Reference?

**Partly. Two mismatches, both recorded below rather than left implied.**

1. **Phase 0's In Scope had the two functions the wrong way round.** It named `evaluate-rules` as the
   primary site and `report-location-event` as a "check whether it carries the same fault." Phase 1
   proved the reverse: location alerts cannot fire through `evaluate-rules` at all. Both functions
   remain inside Phase 0's approved scope as written — the roles are simply inverted. **This is
   recorded as an invalidated planning assumption, not a scope change.**
2. **The Reference itself contains an inaccuracy on this exact path** — §2b's recipient-resolution
   table. Detailed at §4.

### 1.6 Is any documented implementation excluded from the investigation?

**Yes — two, both excluded deliberately, with justification, per Phase 0:**

- **Write-time recipient resolution, mobile** (`hooks/useOrchestrator.ts:862-917`). Explicitly out of
  scope under Phase 0. Different mechanism: it explains how a bad rule gets *created*, not why firing
  misdirects.
- **Write-time recipient resolution, voice** (`naavi-voice-server/src/index.js:4867`, `:12614`,
  `:4913`). Same justification. Verified to exist (§2), verified not to participate in fire-time
  behaviour, and excluded.

Neither exclusion is silent, and neither is a claim that those paths are correct.

---

## 2. Cross-Repository Verification Rule

Every bullet carries a Verification Provenance tag, per the v3.7 rule.

### 2.1 Shared Core

| Location | Finding | Provenance |
|---|---|---|
| `report-location-event/index.ts:765, 772` | **The defect.** `noRecipient = !toPhone && !toEmail` feeding `isSelfAlert`. Fires location alerts. **IN SCOPE.** | **Freshly verified this session** — direct read, lines 700–780, 900–959 |
| `evaluate-rules/index.ts:833, 838` | **The identical expression, character for character.** Fires time / email / calendar / weather / contact_silence alerts. Carries the same defect for those trigger types. **Scope decision required — §3.** | **Freshly verified this session** — direct read, lines 810–849 |
| `_shared/task_actions.ts:32-95` | **Already correct, and the precedent for the remedy** — see §5. Resolves `to_name` at fire time via `lookup-contact`; skips the send on zero matches, ambiguous matches, or a name under 2 characters; only sends when an address actually exists. **Not defective. No change proposed.** | **Freshly verified this session** — direct read, lines 32–96 |
| `check-reminders` | **No equivalent logic.** Contains no `isSelfAlert`, `noRecipient`, `to_phone` or `to_email` handling at all — reminders are self-only by construction. **Not affected.** | **Freshly verified this session** — grep returned zero matches |
| `fire-pending-dwells/index.ts:90` | Caller only. POSTs to `report-location-event` and makes no recipient decision. **Not affected.** | **Freshly verified this session** |

### 2.2 Voice

**The voice server contains no implementation of this capability.**

- `naavi-voice-server/src/index.js` contains **no** `isSelfAlert` and **no** `noRecipient`.
  **Freshly verified this session** — grep of the file returned zero matches for both.
- Voice never fires an `action_rule`. Its `send-sms` call sites (`:1630`, `:6267`, `:6272`, `:6486`,
  `:6493`) are conversational sends during a call — drafting a message, sending a recap — not alert
  fan-out. **Freshly verified this session.**
- Voice's references to `evaluate-rules` (`:8759-8811`) are the **inbound** webhook that
  `evaluate-rules.callVoice()` dials when firing a voice-channel alert. Voice is the callee, not the
  firer. **Freshly verified this session.**
- Voice **does** have write-time recipient resolution, including a location-specific block at
  `:12614` (`if (!hasSelfOverrideLoc && toNameLoc && !to_phone && !to_email)` → resolve). It runs at
  creation, not at fire. **Freshly verified this session. Excluded per Phase 0.**

This satisfies the standing rule never to assert "shared" without grepping the voice file first.

### 2.3 Mobile

- `hooks/useGeofencing.ts` makes **no** recipient or self/third-party decision. It reports a geofence
  crossing to `report-location-event:538` and nothing more. **Freshly verified this session** — grep
  for `to_phone`, `to_email`, `isSelf`, `send-sms` returned zero matches.
- `hooks/useOrchestrator.ts` write paths — **excluded per Phase 0**, not re-checked this session
  beyond confirming they are write-time.

**Conclusion: there is no mobile or voice implementation of this capability. One fix in Shared Core
reaches both surfaces, because there is only one implementation to fix.**

---

## 3. ⭐ The one architectural decision this phase surfaces

**`evaluate-rules:833/838` carries the identical defect for non-location triggers.** Phase 0's
approved In Scope names that file explicitly — but it named it on the false premise that it was where
location alerts fire. Phase 1 disproved that premise.

So the question is genuinely open, and it is Wael's, not this session's:

- **Fixing only `report-location-event`** repairs B9x's actual reproductions and nothing else. It
  also **widens** the drift the Reference already tracks as Priority 1b — the two functions would
  differ by one more behaviour, and the comment at `report-location-event:763-764` claiming it
  *"mirrors the same fallback in evaluate-rules"* would become false.
- **Fixing both** removes the defect class from the capability. It changes user-visible behaviour for
  time, email, calendar, weather and contact_silence alerts as well as location — beyond the symptom
  B9x records.

**This does not overlap B10a.** B10a's rows arrive at fire time with `to_phone` populated with the
user's own number (voice's B4y default at `src/index.js:4725-4739`), so `isSelfByPhone` is true and
the `noRecipient` branch is never reached. Fixing the collapse changes nothing for B10a. The two
items stay cleanly separate.

**This decision is raised to Wael on its own, not inside a phase summary.**

---

## 4. Architecture Reference inaccuracy found — correction proposed, not applied

§2b's recipient-resolution table states, for the **Location** trigger row:

> `resolve-recipient` Edge Function — Yes — one function, used by mobile, voice (2 call sites), and
> `evaluate-rules`' fire-time re-resolution

**For fire time on the location path, this is wrong in a way that matters.** `report-location-event`
performs **no** fire-time re-resolution — a grep for `contact_id` and `resolve-recipient` across all
985 of its lines returns nothing. `evaluate-rules:684` has that re-resolution; the function that
actually fires location alerts does not.

A reader consulting the Reference to ask *"is a location recipient re-checked when the alert fires?"*
would be told yes. The answer is no.

**Under the Architecture Drift Rule this is Outcome 3** — the Reference was stale before this work
started. Governance requires that implementation **stops** until it is reconciled, rather than being
noted and passed. It is therefore raised now, at Phase 1A, and **not deferred to Phase 8.**

**Not applied.** The Architecture Owner is Wael (Reference §0a); Claude proposes, ChatGPT reviews, only
Wael approves. Proposed replacement wording for the Location row's "Shared?" cell:

> Yes at **creation** time — one function, used by mobile and voice (2 call sites). **No at fire
> time:** `report-location-event`, which fires location alerts, performs no re-resolution.
> `evaluate-rules:684` does, but never sees a location rule.

---

## 5. The remedy already exists in this codebase — for Phase 2, not decided here

`_shared/task_actions.ts` solves this exact problem correctly, in the same fan-out, for third-party
sends attached to an alert:

1. If only a name is present, resolve it at fire time via `lookup-contact` (`:32-47`).
2. Zero matches → **skip and log**, never redirect (`:64`).
3. Ambiguous matches → **skip and log** (`:66`).
4. Send only when an address genuinely exists (`:77`, `:89`).

**Fail closed, never substitute a different recipient.** The primary alert path does the opposite:
it substitutes the user.

This is recorded so Phase 2 evaluates an existing in-codebase pattern before inventing one — per
Decision Rule #1 (can it live in Shared Core) and AI Coding Discipline #19 (refactor over layer).
**Phase 1A does not choose the remedy.**

---

## 6. Independent Review Rule

Per Phase 1A, Phase 1 carries two independent reviews and passing one does not imply passing the
other:

1. **Technical Investigation Review** — Phase 1 (`B9X_PHASE1_PROBLEM_DEFINITION_2026-08-25.md`).
2. **Architecture Completeness Review** — this document.

Neither has an overall approval recommendation until both pass.

**Architecture Completeness — this session's assessment: PASS, conditional on two things being
settled before Phase 2 opens:**

- the §3 scope decision (Wael's), and
- the §4 Reference reconciliation, which the Architecture Drift Rule makes a stop condition rather
  than a follow-up.
