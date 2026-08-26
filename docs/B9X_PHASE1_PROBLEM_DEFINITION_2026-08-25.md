# B9x — Phase 1: Problem Definition

| | |
|---|---|
| **Item** | B9x — unresolved third-party recipient on a location alert silently fires to the user instead |
| **Date** | 2026-08-25 |
| **Governance** | `docs/AI_DEVELOPMENT_GOVERNANCE.md` v4.1, §3 Phase 1 |
| **Phase 0** | `docs/B9X_PHASE0_INTENT_APPROVAL_2026-08-25.md` — approved by Wael, 2026-08-25 |
| **Status** | Awaiting review. **No code written.** All work below is read-only. |

---

## ⭐ Headline finding — the holding-list row names the wrong function

**B9x's row cites `supabase/functions/evaluate-rules/index.ts:825` as the root cause. The session
handoff repeated it as *"the only item where the root cause is already located."* Both are wrong,
and the fix would have been applied to a function that cannot fire the affected alerts.**

The real location is **`supabase/functions/report-location-event/index.ts:765` and `:772`.**

`evaluate-rules` does contain the same defective pattern — but it never sees a location rule, so it
is not where B9x's reproductions misfire. Evidence in §3 below.

**Nothing has been changed in the holding list.** Under Rule 1b, correcting an existing item's
classification is Wael's decision, not this session's. The correction is proposed at §8, not applied.

---

## 1. What exactly is broken?

A user sets an alert intended for another person — *"send an SMS to Abdyn when I arrive at the
office."* Naavi saves the rule but never resolves "Abdyn" into a phone number or an email address.

When the alert later fires, the code asks one question to decide who it is for: *are there any
delivery addresses on this rule?* There are none — because resolution never happened. It concludes
the alert must be for the user themselves, and delivers it to the user's own phone, WhatsApp, email,
push and voice channels, worded as a personal arrival notice.

**From the user's side:** the message they meant for another person arrives at their own phone
instead, reading as if it was always theirs. The other person is never contacted. Nothing anywhere —
no error, no warning, no different wording — indicates a recipient was ever involved.

---

## 2. What evidence proves the problem?

### 2.1 The code (direct reads, this session)

`supabase/functions/report-location-event/index.ts`, function `fireLocationAction`:

| Line | Code | What it does |
|---|---|---|
| 722 | `const toPhone = String(config.to_phone ?? '')` | reads the delivery phone |
| 723 | `const toEmail = String(config.to_email ?? '')` | reads the delivery email |
| 725 | `const toName = String(config.to_name ?? '')` | reads the recipient's **name** |
| **765** | `const noRecipient = !toPhone && !toEmail` | **the defect** |
| **772** | `const isSelfAlert = Boolean(hasSelfOverride \|\| isSelfByPhone \|\| isSelfByEmail \|\| noRecipient)` | routes to the user |
| 914–919 | `if (isSelfAlert) { … }` | sends to the user's own five channels |
| 935–937 | `else { console.error('no destination'); return false }` | **unreachable for this case** |

**Line 765 cannot distinguish two entirely different situations:**

1. *No recipient was ever intended* — "alert me when I arrive at Costco." Correct to treat as a
   self-alert. This is what the code was written for, and the comment at 761–764 says so.
2. *A recipient was intended but never resolved* — "text Abdyn when I arrive." Wrong to treat as a
   self-alert, and there is nothing in the expression that could tell it apart.

**Line 725 is the proof that the information exists and is ignored.** `to_name` is read three lines
above the decision, and used only for log messages (927, 933) and for a display name (781). The
recipient's name never participates in deciding who the alert is for.

**Line 935's "no destination" guard is dead for this defect.** It is the `else` of a chain whose
first branch (`isSelfAlert`) has already claimed the case at 765. A third-party alert with no
resolved address can never reach it.

### 2.2 The stored data (from B9x's holding-list row)

- **Reproduction 1 — mobile, production build 301.** *"Send sms message to Abdyn when I arrive at
  office"* saved as `{"to": "Abdyn"}`. Rule `bb48e478-c863-4832-8f62-750a6a70cf3b`.
- **Reproduction 2 — voice, production.** Recipient name never captured at all. Rule
  `dadde218-5634-4a7b-ab15-1c1b6f98a9bf`.

Reproduction 1's key is `to` — not `to_phone`, not `to_email`, and not even `to_name`. **`config.to`
is not read anywhere in `report-location-event`.** A grep of the file returns no reference to it. So
the one piece of evidence that a third party was intended is invisible to the function that decides.

### 2.3 What the evidence does **not** yet prove — Rule 17

**The symptom has never been observed.** Both reproductions captured a badly-saved rule. Neither has
been watched firing. B9x's own row says so: *"Not yet observed at actual fire time (both are
dwell-based location alerts, not yet triggered) — traced from data + code, not yet watched fire
live."*

Rule 17 requires the user-facing test that exposes the bug to be run **before** a fix is coded. It
has not been run. This is flagged in Phase 0 and is raised separately, on its own, rather than
inside this document.

---

## 3. Why `evaluate-rules` is the wrong function — the evidence

`supabase/functions/evaluate-rules/index.ts`:

- **Line 36** — the `ActionRule` type declares
  `trigger_type: 'email' | 'time' | 'calendar' | 'weather' | 'contact_silence'`.
  **`'location'` is not among them.**
- **Lines 222–235** — the trigger `switch` has cases for those five types and
  `default: return []`. A location rule reaching this function yields **zero** triggers and fires
  nothing.
- **Lines 79–82** — the query is `.select('*').eq('enabled', true)` with no `trigger_type` filter,
  so location rules *are* loaded. They are then discarded by the switch. Loading is not firing.

**Location alerts fire through `report-location-event`,** reached from two callers:

- `hooks/useGeofencing.ts:538` — the phone's geofence crossing.
- `supabase/functions/fire-pending-dwells/index.ts:90` — the dwell timer. **Both reproductions are
  dwell-based**, so this is their path.

This matches the Architecture Reference §2b, which states plainly that `report-location-event`
handles location fires and `evaluate-rules` handles time / email / weather / contact_silence.

---

## 4. Root cause

**Root cause: proven.**

> `report-location-event/index.ts:765` infers the *intended audience* of an alert from the *presence
> of delivery addresses*. Those are two different facts. When recipient resolution has failed
> upstream, the rule looks identical to a rule that never had a recipient — and line 772 therefore
> classifies a third-party alert as a self-alert and delivers it to the user.

The defect is not a missing lookup and not a wrong address. It is that **a failure state and a
legitimate state are represented identically in the data**, so no code downstream can separate them.

### 4.1 The safety net that exists on the other path — and does not exist here

`evaluate-rules:684` re-resolves a recipient at fire time by calling `resolve-recipient` when
`config.contact_id` is present.

**`report-location-event` has no such call.** A grep for `contact_id` and `resolve-recipient` across
all 985 lines returns nothing. So on the location path there is no fire-time re-resolution at all —
not a net that fails to catch these two rules, but **no net**.

This is materially worse than B9x's row describes. The row states the net *"only engages when a
`contact_id` was captured at creation time, which neither reproduction has"* — true of
`evaluate-rules`, and not the situation on the path that actually fires these alerts.

### 4.2 Consistency with the Architecture Reference

The Reference (§5, Priority 1b; ADR 0005) records `evaluate-rules` and `report-location-event` as two
independently-maintained Shared Core functions with overlapping fan-out logic held together only by a
code comment. **This is a fourth instance of that documented drift**, and the comment at
`report-location-event:763-764` — *"Mirrors the same fallback in evaluate-rules/fireAction"* — is the
drift saying so in its own words. It mirrored the fallback and did not mirror the safety net.

Whether that changes anything under Governance §5's Architecture Audit Trigger is not this document's
call and is not raised here.

---

## 5. Alternatives considered

| Hypothesis | Verdict | Evidence |
|---|---|---|
| The fault is in `evaluate-rules`, as the row and handoff state | **Ruled out** | No `'location'` case in the switch at 222–235; type at line 36 excludes it. Location rules load but never fire there. |
| The fault is at **write time** — the rule should never have saved without a resolved recipient | **Not ruled out, and out of scope** | B9x's row flags `hooks/useOrchestrator.ts:862-917` as an unconfirmed candidate. This is a *separate mechanism* — it explains how the bad row was created, not why firing misdirects. Both can be true simultaneously. Excluded by Phase 0. |
| Fire-time `contact_id` re-resolution would have caught it | **Ruled out** | That path does not exist in `report-location-event` at all (§4.1). |
| The "no destination" guard at 935 should have caught it | **Ruled out** | Unreachable — `isSelfAlert` claims the case first at 772. |
| The name is genuinely unavailable at fire time | **Ruled out** | `to_name` is read at line 725, three lines before the decision, and used only for logging and display. |

---

## 6. Architecture ownership

Per the Architecture Reference (version **2026.07.18.11**), §0a Ownership Model and §2:

| Question | Answer |
|---|---|
| **Owning component** | **Shared Core** — the Edge Functions codebase, `munk2207/naavi-app/supabase/functions/*` |
| **Capability** | *Action Rules — execution/firing* (§2) |
| **Classification** | Shared Core, **internally duplicated** between `evaluate-rules` and `report-location-event` (§5 Priority 1b, ADR 0005) |
| **Protected Core?** | **Yes** — Action Rules *and* Notification routing (§4). Full Phase 1–8. |
| **Voice-specific implementation?** | **None.** The voice server has no copy of this logic; it is the same Shared Core function for both surfaces. |

**Verification provenance** (Phase 1A rule, applied early): every claim in this section is
**freshly verified this session** by direct read of
`supabase/functions/report-location-event/index.ts` and `supabase/functions/evaluate-rules/index.ts`,
except the ADR 0005 / Priority 1b classification, which relies on the Architecture Reference and was
not re-derived.

**One Reference inaccuracy noted for Phase 1A**, not corrected here: §2b's recipient-resolution table
lists the Location row's mechanism as `resolve-recipient`, *"used by mobile, voice (2 call sites),
and `evaluate-rules`' fire-time re-resolution."* For **fire time on the location path**, that is not
accurate — `report-location-event` performs no re-resolution. Phase 1A will address it.

---

## 7. What is deliberately not decided here

Phase 1 proves what is broken and why. It does not choose the remedy. Whether the right answer is to
refuse to fire, to notify the user that the recipient was never resolved, to re-resolve from the
name at fire time, or to prevent the rule from being saved at all, is Phase 2's decision.

---

## 8. Proposed correction to the holding list — **not applied**

B9x's row cites `evaluate-rules/index.ts:825` and `:830`. Both the function and the line numbers are
wrong. Correct values: `report-location-event/index.ts:765` and `:772`.

Under **Rule 1b**, reclassifying an existing tracked item requires explaining it to Wael first and
receiving his explicit approval for that specific change. This is a proposal. **The holding list has
not been edited.**
