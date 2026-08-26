# B9x — Phase 0: Intent Approval (v3)

| | |
|---|---|
| **Item** | B9x — an alert meant for another person silently fires to the user instead |
| **Date** | 2026-08-26 |
| **Supersedes** | `B9X_PHASE0_INTENT_APPROVAL_2026-08-26.md` (v2), which superseded the 2026-08-25 original |
| **Governance** | `AI_DEVELOPMENT_GOVERNANCE.md` v4.1, §3 Phase 0 |
| **Architecture Reference** | 2026.07.18.12 |
| **Classification** | **Protected Core** — Action Rules + Notification routing. Full Phase 1–8. |
| **Status** | Awaiting Wael's approval. **No code written.** |

---

## Why v3 replaces v2

v2 planned to fix this **when the alert fires** — catch the bad rule on its way out.

Wael identified the better fix on 2026-08-26: **fix it when the alert is created, by having Naavi
ask who the person is.** That is prevention rather than interception, and it is the correct one for a
reason v2 could not solve — see "What this changes" below.

Direction given: *"add the recipient confirmation to the location path."*

---

## What the investigation found (evidence, not assumption)

Naavi already has a confirm-before-acting rule. **Location alerts are explicitly exempted from it, in
two separate places:**

1. **The shared prompt** — *"LOCATION ALERTS — IMMEDIATE SINGLE-TURN PATH (exempt from RULE 23) …
   DO NOT say 'say yes to confirm'"* (`get-naavi-prompt/index.ts:385-386`), and *"RULE 23 NEVER
   applies to location alerts"* (`:453`).
2. **The server-side gate** — *"Exempt (no gate): set_location_rule_chain,
   set_location_rule_address"* (`naavi-chat/index.ts:4179`).

**Confirmation was not removed from the location path — it was narrowed.** The prompt hands it to
the orchestrator: *"The orchestrator handles address verification and confirmation"* (`:390`). The
orchestrator confirms **the place**. Nothing confirms **the person**.

Reproduction 1 was *"Send sms message to Abdyn when I arrive at office"* — a location alert, so no
confirm, so "office" was verified and "Abdyn" never was.

---

## User Intent

> Before Naavi saves a location alert that is meant for another person, she must know who that
> person is — and ask if she doesn't.

### ⭐ The governing principle (Wael, 2026-08-26)

> **Resolve silently when possible. Ask only when resolution is impossible or ambiguous. Never add
> confirmation to a successfully resolved location alert.**

**This sentence governs every later phase of this item.** Where any phase document, review comment,
or implementation detail appears to conflict with it, this sentence wins and the other is wrong.

**Why it is here rather than left in conversation.** The direction that opened this scope was *"add
the recipient **confirmation** to the location path."* Taken literally, "confirmation" means RULE 23's
two-turn *say-yes-to-confirm* pattern — and that reading had already leaked into this document twice
before anyone noticed: Completion Criterion 2 required a recipient to be *confirmed*, and In Scope
authorised changing the location exemption itself. Both were approved in writing, both contradicted
Success Criterion 2, and **implementing Phase 0 as approved would have made *"alert me at Costco"*
start asking for confirmation** — the exact behaviour the exemption exists to prevent.

Wael's correction, 2026-08-26: *"my earlier phrase 'recipient confirmation' was imprecise. I do not
recommend introducing the RULE 23 confirm-then-act behavior for location recipients."*

**The four behaviours this principle fixes, stated so no later phase has to infer them:**

| The user says | Naavi does |
|---|---|
| *"Alert me at Costco"* — no recipient | saves immediately, one turn |
| *"Text my wife when I leave the office"* — resolves | saves immediately, one turn. **No read-back, no "say yes."** |
| *"Text Abdyn when I arrive"* — cannot resolve | **does not save**; asks for enough information to identify the recipient |
| Two contacts match the name | **does not save**; asks which person |

---

## What this changes, and why it is better than v2

**Neither approach reaches Reproduction 2, and this document originally claimed otherwise.**

The mobile one kept the name "Abdyn" in the rule. Confirming at creation catches it — Naavi is
holding a name she cannot identify, so she asks instead of saving.

The voice one never captured a name at all. There is no *unidentified* recipient in that row — there
is **no** recipient, which is indistinguishable from a genuine *"remind me when I get there."*
Confirmation has nothing to trigger on.

**Why prevention is still the better fix:** it is the only approach that reaches Reproduction 1
**before** a message is misdelivered, rather than intercepting it on the way out. The fire-time
approach could only ever act after the alert had already been created wrong.

> **⚠️ Corrected 2026-08-26, on the Phase 2 reviewer's blocking finding.** This section previously
> read: *"**Confirming at creation fixes both**, because a rule with an unidentified recipient never
> gets saved."* **That conflated *unidentified* with *absent*.** A rule holding a name Naavi cannot
> resolve and a rule holding no name at all are different states, and only the first is detectable.
> The claim was written into an approved Phase 0 and contradicted three documents later by Phase 2's
> own §9 — the reviewer caught the contradiction, not the author.
>
> **Prevention fixes one reproduction, not two.**

**Reproduction 2 remains an open, unresolved observation.** Its creation-time failure has not been
reproduced and its cause is unproven (Phase 1 v2 §5). Under Rule 17 it stays that way until someone
reproduces it. **It is not in scope, and no tracked item has been created for it** — under Rule 1b
that is Wael's decision.

---

## Success Criteria

1. A location alert naming a person Naavi cannot identify is **not saved**. She asks instead.
2. **Nothing that works today slows down.** *"Alert me at Costco"* — no person involved — still fires
   immediately on turn one, with no extra question. This is the single-turn speed the exemption was
   written to protect, and protecting it is part of success.
3. A location alert naming a person Naavi **can** identify still saves in one turn.

---

## In Scope

Shared Core only:

- `supabase/functions/naavi-chat/index.ts` — a **new recipient-resolution step**, placed in the
  action-gate region (~`:4170-4210`) after the actions are assembled. A location alert naming a
  person who cannot be resolved has its action **dropped**, and Naavi asks instead.
- `supabase/functions/get-naavi-prompt/index.ts` — correct the `:1202` / `:1215` annotations so they
  describe what the server now actually does, and state that an unresolvable recipient produces a
  question. **The RULE 23 location exemption is NOT changed** — location alerts stay exempt.
- `naavi-voice-server/src/index.js:12613+` — **only if** Phase 1 finds a gap. **Phase 1A found none;
  voice is already correct and is not being changed.**
- Regression tests, per Rule 15a.
- Deploy to **Supabase staging** (`xugvnfudofuskxoknhve`). No voice deploy — no voice change.

**Why no mobile file:** the resolution step runs inside `naavi-chat`, before the action reaches the
mobile orchestrator (`:4176-4177` states this of the gates in that region). Mobile has **three**
location-creation paths and two of them skip resolution; fixing it in Shared Core covers all three
without touching mobile code.

> **⚠️ Corrected 2026-08-26 — three further Phase 0 ↔ Phase 2 inconsistencies, found on a full
> re-read after the reviewer's blocking finding was fixed. The reviewer flagged one; these three were
> not flagged by anyone.** This section previously said: (1) the change modifies *"the gate at
> `:4179`"* — it does not; that gate is left alone and a **new** step is added near it; (2) the action
> is *"held rather than passed through"* — "held" is the RULE 23 two-turn pattern, and this design
> **drops** the action and asks a question instead; (3) the prompt change alters *"the location
> exemption, so it requires the recipient to be identified"* — the exemption is **not** touched, only
> two annotations that described the server inaccurately.
>
> **The third one mattered most:** as written, Phase 0 authorised removing the single-turn exemption,
> which is the opposite of Success Criterion 2 and of the reviewer's constraint on Phase 2.

---

## Out of Scope

| Excluded | Why |
|---|---|
| `hooks/useOrchestrator.ts:862-917` | Mobile-specific. Covered by the Shared Core gate instead. |
| **The fire-time fix from v2** — `report-location-event`, `evaluate-rules` | Superseded by prevention. See the open question below. |
| B10a, `_shared/task_actions.ts`, `check-reminders` | Separate or already correct. |
| Any production deploy · any mobile build | — |
| Any other item, rule, or document | — |

---

## Constraints

- Staging only. No production deploy without Wael's explicit instruction.
- Protected Core → full Phase 1–8, Wael's own approval at every gate.
- Rule 15a — regression tests before this closes.
- Rule 1b — nothing found becomes a new tracked item without being explained and approved first.
- **Non-Determinism Rule (Governance Phase 3):** this is a prompt change. Every behaviour-changing
  test case needs **at least 3 independent trials**, with the full distribution reported. A single
  passing trial proves nothing.

---

## Completion Criteria

1. Phase 1 confirms the creation-path cause and whether voice has a gap.
2. Recipient **resolved** before a location alert is saved — and where it cannot be resolved, the
   alert is not saved and Naavi asks. *(Corrected 2026-08-26: this read "recipient **confirmed**
   before a location alert is saved", which contradicted Success Criterion 3 in the same document —
   a recipient Naavi can identify saves in **one turn**, with no confirmation step. Nothing in this
   work asks the user to confirm a recipient she has successfully identified.)*
3. Deployed to staging.
4. Reproduction 1's phrasing now produces a question, not a saved rule.
5. *"Alert me at Costco"* verified still single-turn.
6. Regression tests added, registered, green — 3 trials each for prompt behaviour.
7. Architecture Reference re-checked at Phase 8.
8. Wael's explicit approval at each gate.

---

## Decided — the fire-time safety net is deferred

**Wael's ruling, 2026-08-26 (option 3 of 3): prevention now; the fire-time safety net is decided
separately, once prevention is proven working.**

This **confirms** the scope above rather than changing it — `report-location-event` and
`evaluate-rules` remain Out of Scope for this work item. **No tracked item has been created for the
deferred safety net; under Rule 1b that is Wael's decision, not this session's.**

### The correction that informed the ruling

The options Wael was shown stated that the two known bad rules were *"still there, still enabled, and
will misdeliver whenever they trigger."* **That was false.** It was inferred from B9x's phrase *"not
yet triggered"* — which means only that nobody watched them fire — and asserted without reading the
rows.

Both were then read directly from production on 2026-08-26. **Both are `enabled: false`, and have
been inert since 15 July 2026.** Neither can fire.

So of the two arguments for the fire-time safety net, one does not exist. The remaining one — defence
against a future route that bypasses the creation gate — is what the deferred decision rests on.

### Evidence preserved — the two reproduction rows

Read from production `hhgyppbxgmjrwdpdubcx`, 2026-08-26. Recorded here so the evidence survives
independently of the rows. Both are on `788fe85c-b6be-4506-87e8-a8736ec8e1d1` (wael.aggan@gmail.com).

| Field | Reproduction 1 | Reproduction 2 |
|---|---|---|
| `id` | `bb48e478-c863-4832-8f62-750a6a70cf3b` | `dadde218-5634-4a7b-ab15-1c1b6f98a9bf` |
| `label` | `Office` | `Alert when arriving at 580 Bayview Drive` |
| `trigger_type` | `location` | `location` |
| `action_type` | `sms` | `sms` |
| `action_config` | `{"to": "Abdyn"}` | `{"body": "You've arrived at 580 Bayview Drive."}` |
| `enabled` | **false** | **false** |
| `created_at` (EST) | 2026-07-15, 9:47 AM | 2026-07-15, 10:09 AM |

**Reproduction 2 confirms, from the data itself, what no code reading could settle:** the row
contains no recipient field of any kind. Nothing distinguishes it from a genuine *"remind me when I
arrive"*, which is why prevention at creation is the only fix that could ever have covered it.

**Reproduction 1 carries a recipient name and no message body at all.**

---

### ⭐⭐⭐ The bug fired. It is not theoretical, and never was.

**Both rows carry `last_fired_at`.** Reading only the columns needed for the earlier table missed it;
reading `select=*` before deleting them found it. **Both are `one_shot: true`, which is why they are
`enabled: false` — they disabled themselves after firing. Nobody switched them off.**

| Row | `last_fired_at` (EST) | `last_entered_at` (EST) |
|---|---|---|
| `bb48e478` — `{"to": "Abdyn"}` | **2026-07-19, 7:58:14 PM** | 2026-07-19, 7:58:13 PM |
| `dadde218` — no recipient | 2026-07-16, 11:13:02 AM | 2026-07-16, 11:10:54 AM |

**What went out when `bb48e478` fired**, from `sent_messages`, production:

| `id` | Channel | `to_name` / `to_phone` | Body | Status | Provider SID |
|---|---|---|---|---|---|
| `dcb3d6ec-b3c0-4f03-92f8-528f2c3ed716` | sms | **Wael** / `+16137697957` | `You've arrived at Office.` | sent | `SM16bd963a46da064c706c9896856938bf` |
| `ac67c3d4-0e3e-482f-8639-bc9ecc1b4de0` | whatsapp | **Wael** / `+16137697957` | `You've arrived at Office.` | sent | `MM5c6badec48e3eaee9fa72ad11995a0e7` |
| `0352ed18-6994-409e-83b1-2b3f81d3c52f` | voice | — / `+16137697957` | `You've arrived at Office.` | sent | `CA8cb38c5fff357e36c3b97082311315b7` |

All three `source: location_alert`, all timestamped within 0.4s of the rule's `last_fired_at`.

**Abdyn received nothing. Wael received three notifications indistinguishable from an ordinary
arrival alert** — the rule had no `body`, so the self-alert fallback at `report-location-event:748`
supplied *"You've arrived at Office."* There was nothing a user could have noticed.

**Observation vs inference.** *Observed:* the rule's `last_fired_at`, and three `sent_messages` rows
at that instant with `source: location_alert` and that body. *Inference (strong):* those sends came
from that rule — `sent_messages` has no `rule_id` column, so the link is timestamp + source + the
label-derived fallback body, not a foreign key.

**This is the full defect, end to end, on a real account.** Not a code trace, not a stored
precondition — a delivered message that went to the wrong person and looked completely normal.

**The holding-list row's claim that this was *"not yet observed at actual fire time … not yet watched
fire live"* is wrong.** It fired on 19 July 2026 and the proof has been in the database since.

---

### Disposition of the two rows

**Deleted from production on 2026-08-26, on Wael's explicit ruling, given twice after being shown the
evidence above.** The contents are preserved in this document, which is now the only record of them.
The three `sent_messages` rows were **not** touched and remain in production.

---

## Rule 17 — satisfied, and closed

**Satisfied by the 19 July 2026 incident recorded above**, not by a test still to be run. The alert
fired, the message was delivered to the wrong party, and the delivery is recorded in
`sent_messages` with provider confirmations. This is a user-facing reproduction of the exact defect.

**Wael's ruling, 2026-08-26 (option 1 of 3):** a live creation test is still run on staging before
Phase 2 closes — *"text \<name not in contacts\> when I arrive at Costco"* — but its purpose is now
to **prove the fix**, not to prove the bug. Cheap, because it tests creation rather than firing: no
geofence needs to be crossed.

**Carried into Phase 7 as a required test.**
