# B9x — Phase 3: Technical Review (Before Coding)

| | |
|---|---|
| **Item** | B9x — an alert meant for another person silently fires to the user instead |
| **Date** | 2026-08-26 |
| **Governance** | v4.2, §3 Phase 3 · §13 Review Gates · §14 Handoff |
| **Phase 0 / 1 / 1A / 2** | `..._V3` / `..._V2` / `..._V2` / `..._V2` — all approved (Phase 2 hold released 2026-08-26) |
| **Risk** | **HIGH** — Protected Core (Action Rules) |
| **Status** | **Submitted for external review. No code written.** |

**Governing principle (Phase 0 v3):** *Resolve silently when possible. Ask only when resolution is
impossible or ambiguous. Never add confirmation to a successfully resolved location alert.*

---

## 1. ⭐ Headline — the mechanism already exists, and Phase 2 described it as new

Phase 2 proposed *"a new recipient-resolution step"* in `naavi-chat`. **It is not new.**
`naavi-chat/index.ts:4252-4318` already contains a complete, working, server-side recipient
intercept — for `trigger_type='time'` only:

| Case | What the existing intercept does |
|---|---|
| name present (`action_config.to` **or** `to_name`) | calls `lookup-contact` with the service-role key |
| **zero matches** | returns immediately: `actions: []` + *"I couldn't find a phone number for X in your contacts. Please add them and try again."* |
| **multiple matches** | returns a **numbered list** of candidates with their phone numbers, plus a `PENDING_INTENT` marker so the user's pick executes next turn |
| **single match** | injects `to_phone`/`to_name` — its own comment: *"so mobile skips its own lookupContact"* |
| lookup throws | logs and continues |

**The change B9x needs is to extend that intercept's trigger-type filter to include `'location'`** —
not to build a parallel one. This is materially smaller and lower-risk than Phase 2 described, and it
follows AI Coding Discipline #19 (refactor over layer).

**Recorded as an invalidated planning assumption**, per Governance Phase 6's rule, but found at
Phase 3 — before code exists — which is where it costs nothing.

**It is also better than what Phase 2 specified.** Phase 2 proposed *"say their full name and I'll
try again"* for the ambiguous case, copied from voice. The existing intercept returns a numbered
choice with phone numbers — which is what CLAUDE.md Rule 13 requires and what Wael can answer with
`# 2`.

---

## 2. ⚠️ Three blocking design issues in reusing it — all found this session

### 2.1 The intercept is phone-only. Location alerts support email.

`:4276` — `const withPhone = allC.filter((c) => c.phone);` — and zero-phone contacts produce
*"I couldn't find a **phone number** for X."*

**Location alerts explicitly support `action_type='email'`.** `get-naavi-prompt:1215`:

> *"Email my wife when I leave the office" → set_location_rule_address(… action_type='email',
> action_config={to:'wife', …}) ← named contact still uses 'to' even for action_type='email' — the
> server resolves the contact's email address the same way it resolves a phone number for SMS"*

Extending the intercept unchanged would **reject a contact who has an email and no phone**, on an
email alert, with a message about phone numbers. That is a new defect, introduced by the fix.

**Proposed resolution:** filter on the channel the action actually uses — `c.phone` for
`sms`/`whatsapp`, `c.email` for `email` — and word the failure message to match. **This changes
behaviour for existing time triggers too**, which is why it is raised here rather than decided
unilaterally.

### 2.2 It cannot handle a literal phone number or email address

`lookup-contact` searches contacts by name. Given `to: "+16135550000"` it finds nothing and answers
*"I couldn't find a phone number for +16135550000 in your contacts."*

`resolve-recipient` handles exactly this — `literal_phone` / `literal_email` are two of its six
return kinds (`resolve-recipient/index.ts:23-24`), tested before any contact search
(`:159-160`).

**Today this is not a regression** — nothing resolves on mobile's location path at all, so a literal
currently passes through unresolved. But Phase 2's behaviour table promises literals work, and the
intercept as written would make them *fail loudly* rather than silently. **A loud failure is better
than a silent misdelivery, but it is not what Phase 2 promised.**

### 2.3 `lookup-contact` vs `resolve-recipient` — the surfaces would diverge

Voice's location path uses **`resolve-recipient`** (`src/index.js:12616`). The mobile orchestrator
uses **`resolve-recipient`** (`useOrchestrator.ts:3493`). The `naavi-chat` intercept uses
**`lookup-contact`**.

Extending the intercept means mobile-location resolves through a different function than
voice-location, for the same user request. The Architecture Reference §2b already flags time-trigger
recipient resolution as **not unified** across three `lookup-contact` call sites; this would place
location on the un-unified side.

**Three options, and this document does not choose:**

1. **Extend the intercept as-is** (`lookup-contact`). Smallest diff; inherits 2.1 and 2.2; widens the
   documented non-unification.
2. **Extend the intercept, switching its resolver to `resolve-recipient`.** Fixes 2.1 and 2.2 by
   construction — `resolve-recipient` returns email and phone and handles literals — and converges
   mobile with voice. **But it changes behaviour for existing time triggers**, which are out of
   B9x's scope.
3. **Extend the intercept for location only, calling `resolve-recipient` on the location branch**,
   leaving the time branch untouched. Contained to B9x's scope; leaves two resolvers inside one
   function, which is the kind of thing this project's architecture debt is made of.

**Claude's recommendation: option 3**, on scope-discipline grounds (Rule 0.3, minimal change; option
2 modifies working behaviour outside the approved Phase 0), with option 2 recorded as a Deferred
Architectural Decision below. **The reviewer is asked to rule.**

---

## 3. Assumptions surfaced

| Assumption | Status |
|---|---|
| `naavi-chat` may call another Edge Function server-side | **Verified** — the intercept does it today with `SUPABASE_SERVICE_ROLE_KEY` (`:4258-4271`) |
| Dropping an action and speaking instead is a supported shape | **Verified** — two existing mechanisms: `actions.filter()` + `serverRejectionMessage` (`:4222-4238`), and early `jsonResponse` with `actions: []` (`:4280`) |
| The recipient name lives in `action_config.to` | **Verified, and it is either field** — the intercept reads `_t2AC?.to ?? _t2AC?.to_name` (`:4261`). Reproduction 1 stored `to`. |
| Mobile will not double-resolve | **Verified** — `useOrchestrator.ts:3493` is gated on `!to_phone && !to_email`; once populated it skips. The intercept's own comment states this is the intent. |
| Latency is not made worse | **Verified by reasoning, not measured.** Mobile pays this lookup today, client-side, after `naavi-chat` returns. Moving it server-side removes a round trip rather than adding one. **Voice is unaffected — it never calls `naavi-chat`.** |
| Location alerts reach Path B, not Layer 2 | **Verified** — `intentHandlers.ts` contains no location handling (zero grep matches) |

---

## 4. Hidden coupling checked

- **`task_actions`** — the existing intercept also resolves `task_actions[].to_name` (`:4262`,
  `:4310-4312`). Location alerts can carry `task_actions` (`get-naavi-prompt:1217`). Extending the
  intercept therefore also starts resolving those at creation, where today they resolve at fire time
  in `_shared/task_actions.ts`. **Both would then run.** `task_actions.ts:35-36` is gated on
  `!ta.to_phone`, so a pre-resolved entry is skipped — no double send. **Verified, but it is
  behaviour change beyond the stated fix and the reviewer should see it named.**
- **Place resolution ordering** — an unresolvable recipient returns early, before any place picker.
  Fail fast on the person; never ask about the place for an alert that cannot be delivered.
  **Intended, and stated here so it is a decision rather than an accident.**
- **F15 diagnostic block** (`:3760-3775`) logs raw location tool input. Read-only, unaffected.
- **`pendingLocationRef`** (mobile) — engages only after an action arrives. A dropped action never
  reaches it.

---

## 5. Isolation

The new branch engages only when **all** hold: `type === 'SET_ACTION_RULE'`,
`trigger_type === 'location'`, no `self_override_*` field, `to`/`to_name` non-empty, and both
`to_phone` and `to_email` empty. Every other request shape reaches identical code to today.

---

## 6. Implementation Boundaries Confirmed *(to be completed by the reviewer)*

Authorized files, and nothing beyond them:

- `supabase/functions/naavi-chat/index.ts` — extend the existing intercept at `:4252` to location.
- `supabase/functions/get-naavi-prompt/index.ts` — correct the `:1202`/`:1215` annotations only.
  **The RULE 23 location exemption is not touched.**
- `tests/catalogue/session-2026-08-26-b9x-location-recipient.ts` (new) and `tests/runner.ts`.

No mobile file. No voice file. No migration. No cron. No opportunistic refactoring. No architectural
change beyond what §2.3's chosen option authorises.

---

## 7. Deferred Architectural Decisions

1. **Unifying the three `lookup-contact` call sites onto `resolve-recipient`** (Architecture
   Reference §2b). Not approved for this implementation — blast radius covers time triggers, which
   are outside B9x's Phase 0. Reconsider if a third trigger type needs the same treatment.
2. **The phone-only filter's effect on existing time-trigger email alerts** (§2.1). If the reviewer
   scopes the fix to location only, the time branch keeps the defect. **Not converted into a tracked
   item — Rule 1b makes that Wael's decision, and it is raised to him separately.**

---

## 8. Non-Determinism Rule

This touches the Claude system prompt. Every behaviour-changing test case runs **at least 3
independent trials**, and Phase 5 reports the full distribution — not pass/fail.

---

## 9. What the reviewer was asked to decide

1. **§2.3** — which of the three resolver options.
2. **§2.1** — whether the channel-aware filter is in scope, or location-only.
3. Whether §4's `task_actions` coupling is acceptable as described.
4. Gates 1–5 (§13), and a decision.

---

## 10. Claude Implementation Handoff (Governance §14)

### Decision

**APPROVED WITH MANDATORY CHANGES**, external reviewer, 2026-08-26.

⚠️ **This is not authorization to code.** Per Governance §3's Phase-Gate Approval Rule, a reviewer's
verdict is one input Wael weighs. **Phase 4 begins only on Wael's own separate, explicit go-ahead.**

### Mandatory Changes

Nothing beyond this list may be performed under this authorization.

1. **Resolver — Option 3.** The **location branch only** calls `resolve-recipient`. The existing
   time-trigger branch keeps `lookup-contact`, **unchanged**. Option 1 was rejected for knowingly
   mishandling email recipients and literals; Option 2 for changing working time-trigger behaviour
   outside B9x's approved scope.
2. **No channel-aware retrofit.** The time branch's phone-only filter (`:4276`) is **not** repaired
   in this item. `resolve-recipient` gives the location branch correct phone / email / literal
   handling by construction, so no retrofit is needed to satisfy B9x.
3. **⭐ `task_actions` must NOT be resolved by the location branch.** This is the reviewer's one
   mandatory design adjustment. Extending the existing intercept *wholesale* would begin resolving
   `task_actions[].to_name` at creation, where they already resolve at fire time in
   `_shared/task_actions.ts`. **The location branch resolves only the primary recipient**
   (`action_config.to` / `to_name`). Existing `task_actions` behaviour is unchanged unless a
   demonstrated technical necessity brings it back through governance.
4. **Boundaries confirmed** — §6 stands as written.

### Architecture Requirements

- Extend the existing intercept **structurally** — a location branch beside the time branch in the
  same region — rather than creating a second parallel mechanism (AI Coding Discipline #19).
- Preserve the time branch **exactly**.
- RULE 23 is untouched. Location alerts stay exempt; successful resolutions stay single-turn.
- No mobile, voice, database, cron, or unrelated refactoring.

### Regression Requirements

- §5's isolation conditions are **implementation requirements**, not description: the branch engages
  only for `SET_ACTION_RULE` + `trigger_type='location'` + no `self_override_*` + non-empty
  `to`/`to_name` + empty `to_phone` **and** `to_email`.
- Self-overrides preserved (F15 Defect A).
- `tests/catalogue/confirm-then-act.ts:142-168` must stay green — *"alert me at Shoppers Drug Mart"*
  single-turn.
- Fail closed on unresolved and ambiguous. Never substitute the user as recipient.

### Scope Restrictions

Phase 0 v3's In Scope and Out of Scope, unchanged. **Reproduction 2 stays out** — cause unproven.

### Verification Checklist (what Phase 5 must produce)

- Git diff, files changed, rollback instructions.
- Test results for all 8 cases in Phase 2 §8, **3 independent trials each** for prompt-dependent
  cases, full distribution reported (Non-Determinism Rule).
- Evidence that `task_actions` on a location alert still resolve at fire time and **not** at
  creation — the mandatory change above, proven rather than asserted.
- The live staging creation test required by Wael's Rule 17 ruling.

### ⚠️ One implementation question Phase 4 must resolve before coding the ambiguous case

The existing time intercept answers ambiguity with a **numbered candidate list plus a
`PENDING_INTENT` marker**, so the user's `# 2` executes on the next turn. **Whether that
`awaitingDisambig` path supports `trigger_type='location'` end-to-end has not been verified** — Step
1.4's executor and the marker's `field`/`taIndex` shape were written for time triggers.

Phase 4 must check this directly. If location is not supported, the fallback is voice's wording
(*"say their full name and I'll try again"*), which is correct but loses the numbered choice
CLAUDE.md Rule 13 prefers. **Raised to Wael separately if the fallback turns out to be needed** — not
decided here, and not assumed either way.
