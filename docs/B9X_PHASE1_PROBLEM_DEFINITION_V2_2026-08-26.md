# B9x — Phase 1: Problem Definition (v2 — creation path)

| | |
|---|---|
| **Item** | B9x — an alert meant for another person silently fires to the user instead |
| **Date** | 2026-08-26 |
| **Phase 0** | `B9X_PHASE0_INTENT_APPROVAL_V3_2026-08-26.md` — approved 2026-08-26 |
| **Supersedes** | `B9X_PHASE1_PROBLEM_DEFINITION_2026-08-25.md` (fire-time analysis, still valid for what it covered) |
| **Architecture Reference** | 2026.07.18.12 |
| **Status** | Awaiting review. **No code written.** |

---

## 1. What exactly is broken

A location alert naming a person Naavi cannot identify **gets saved anyway**, on the mobile surface,
with the person's name sitting in the rule as plain text and no phone number or email behind it.

Naavi never asks who they are. The user is told the alert is set.

---

## 2. ⭐ The root cause: the prompt promises something the server does not do

**The shared prompt states, in its own words, that the server resolves the contact.**
`get-naavi-prompt/index.ts:1215`:

> `"Email my wife when I leave the office"` → `set_location_rule_address(… action_config={to:'wife', …})`
> **"← named contact still uses `'to'` even for `action_type='email'` — the server resolves the
> contact's email address the same way it resolves a phone number for SMS"**

Same instruction at `:1202` for SMS. So Claude is told, correctly, to emit a bare name in
`action_config.to` and to rely on the server.

**`naavi-chat` does not resolve it.**

- `convertLocationToolToActionRule():179` passes `action_config: input.action_config` **straight
  through, unexamined**, from Claude's tool call into the emitted action.
- **`naavi-chat` never calls `resolve-recipient` at all.** A grep across
  `supabase/functions/naavi-chat/*.ts` returns exactly one occurrence — a *comment* at `:2013`
  referring to `useOrchestrator`'s call, not a call of its own.

So resolution for the mobile surface happens **client-side**, in the orchestrator, after
`naavi-chat` has already emitted the action. B9x's holding-list row records that one orchestrator
path — `hooks/useOrchestrator.ts:862-917`, the compound/numbered-request insert — performs no
resolution at all. A rule saved by that path keeps the raw name, which is exactly Reproduction 1's
stored shape: `action_config = {"to": "Abdyn"}`.

**The defect is a promise gap.** The prompt's contract says the server resolves. The server that
Claude actually talks to does not, and the component that does is a client the prompt does not
control.

---

## 3. Why nothing asks the user

Naavi has a confirm-before-acting rule (RULE 23). **Location alerts are exempt from it in two
independent places:**

| Where | Text |
|---|---|
| The prompt, `get-naavi-prompt:385-386` | *"LOCATION ALERTS — IMMEDIATE SINGLE-TURN PATH (exempt from RULE 23) … DO NOT apply RULE 23 confirm-then-act. DO NOT say 'say yes to confirm'."* |
| The prompt, `:453` | *"RULE 23 NEVER applies to location alerts."* |
| The server gate, `naavi-chat:4179` | *"Exempt (no gate): `set_location_rule_chain`, `set_location_rule_address`"* |

The server gate (`naavi-chat:4195-4204`) covers `CREATE_EVENT`, `DELETE_EVENT`, `DELETE_RULE`,
`DELETE_MEMORY`, `UPDATE_MORNING_CALL`, `SCHEDULE_MEDICATION`, and `SET_ACTION_RULE` for
`time`/`calendar`/`weather`/`contact_silence`. **Location is in neither set.**

**Confirmation was not removed from the location path — it was narrowed.** `:390` hands it over:
*"The orchestrator handles address verification and confirmation."* The orchestrator confirms **the
place**. Nothing confirms **the person**.

The exemption exists for a good reason — *"alert me at Costco"* should complete in one turn. It was
written about **places** and it swallowed **people**.

---

## 4. ⭐ Voice already does this correctly — and that decides the remedy

`naavi-voice-server/src/index.js:12613-12655`, the location-alert creation path:

| Outcome of `resolve-recipient` | What voice does |
|---|---|
| `resolved_contact` / `literal_phone` / `literal_email` | populates `to_phone`/`to_email`/`contact_id`, saves |
| `ambiguous` | *"You have more than one contact named X — say their full name and I'll try again."* — **does not save** |
| `not_found` / `invalid` / default | *"I don't have a contact named X. Tell me their email or phone number directly, or save them to your contacts first."* — **does not save** |
| call fails | *"I couldn't verify that contact right now."* — **does not save** |

**Voice already asks, and already refuses to save an unidentifiable recipient.** This is the exact
behaviour Phase 0 v3 asks for. It is not a new mechanism to design — it is a behaviour that exists
on one surface and is missing from the shared server the other surface depends on.

**Consequence for scope:** the remedy is to give `naavi-chat` the resolution step voice already
performs, which also makes the prompt's `:1215` claim true. No mobile file changes — the gate runs
before the action reaches the orchestrator (`naavi-chat:4176-4177` states this explicitly).

---

## 5. Reproduction 2 — what is proven and what is not

**Observed** (read from production `hhgyppbxgmjrwdpdubcx`, 2026-08-26): rule
`dadde218-5634-4a7b-ab15-1c1b6f98a9bf` has `action_config = {"body": "You've arrived at 580 Bayview
Drive."}` — **no recipient field of any kind**, and no `task_actions`.

**Recorded** in B9x's row: the recipient's name was *"never even captured."*

**Not proven:** *why* it was never captured. The row's data is consistent with Claude producing only
the self-alert half of a request that also named a third party — `get-naavi-prompt:1217` requires
such requests to be structured as a self-alert plus `task_actions`, and there are no `task_actions`
here. **That is an inference from the row's shape, not an observation**, and this document does not
rest on it.

**What is certain:** no fire-time change could ever have helped this row, because it carries nothing
to distinguish it from a genuine *"remind me when I arrive."* Prevention at creation is the only
mechanism that reaches it.

---

## 6. Alternatives considered

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Fix it when the alert fires (Phase 1 v1) | **Superseded, not wrong.** Still true, still the site of the damage — but can only reach rules that stored a name. Reproduction 2 stores none. | Phase 1 v1 §2.1; row read at §5 |
| Voice needs the same fix | **Ruled out** | `src/index.js:12613-12655` already resolves, already asks, already refuses to save |
| Require `to_phone`/`to_email` to be present before accepting the action | **Ruled out** | Would break every working third-party location alert on mobile, where the orchestrator resolves *after* `naavi-chat` emits |
| Fix it in the mobile orchestrator | **Out of scope**, and unnecessary | Mobile-specific; the Shared Core gate covers it without touching mobile code |
| The recipient information is unavailable at creation | **Ruled out** | `action_config.to` carries the name; `resolve-recipient` exists and is already called by voice with exactly this input |

---

## 7. Architecture ownership

| Question | Answer |
|---|---|
| **Owning component** | **Shared Core** — `munk2207/naavi-app/supabase/functions/*` (Reference §0a) |
| **Capability** | *Action Rules — creation (the classifier)* (§2, §2a) |
| **Classification** | **Duplicated, two independent implementations** — Priority 1, ADR 0001. Mobile and voice each decide independently what a new alert should be. |
| **Protected Core?** | **Yes** — Action Rules. Full Phase 1–8. |
| **Is this a case of that duplication?** | **Yes, precisely.** Voice's implementation is correct; the mobile-facing one is not. §2a warns in advance: *"a bug fixed in mobile's alert-creation classifier does not fix voice's… and vice versa."* Here it is the reverse direction — a behaviour voice has that the shared server never received. |

**Verification provenance.** Every claim in §2, §3, §4 and §5 is **freshly verified this session** by
direct read of `get-naavi-prompt/index.ts`, `naavi-chat/index.ts`,
`naavi-voice-server/src/index.js`, and a live read of the two production rows. The ADR 0001 /
Priority 1 classification **relies on the Architecture Reference and was not re-derived**.

---

## 8. Not decided here

Phase 1 proves the cause. It does not choose the remedy — whether `naavi-chat` resolves inline like
voice, or holds the action and asks, or both, is Phase 2's decision, reviewed at Phase 3 before any
code exists.

**Rule 17 remains open.** No live fire has been observed. Wael's decision, outstanding.
