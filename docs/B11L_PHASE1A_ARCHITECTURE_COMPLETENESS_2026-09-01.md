# B11l — Phase 1A: Architecture Completeness Review

| | |
|---|---|
| **Item** | B11l — *"text me"* resolves to a stranger, and the confirmation card labels him *"me"* |
| **Date** | 2026-09-01 |
| **Governance** | `AI_DEVELOPMENT_GOVERNANCE.md` v4.2, §3 Phase 1A |
| **Architecture Reference version used** | **2026.07.18.15**, recorded per Phase 1A's Version Verification requirement. **B11l runs on this version for the whole item, supplemented — for this work item only — by the approved findings in this document.** No Reference edit or version bump is made during Phases 0–7 (Reference-Document Read-Only Rule, Governance v4.3 §3). Re-confirm before Phase 8 merge. |
| **Phase 1** | `B11L_PHASE1_PROBLEM_DEFINITION_2026-09-01.md`, approved by Wael 2026-09-01 |
| **Platform scope** | **MOBILE ONLY** — unchanged. Voice remains withdrawn (Phase 0, three live calls). |
| **Status** | Awaiting Wael's approval. **No code written.** |

---

## ⭐ Headline: Phase 1 was incomplete, and this is what Phase 1A exists to catch

**Phase 1 located this defect entirely in mobile client code and never examined `naavi-chat`.** It
concluded the card was Mobile-only and the lookup was Shared Core, and stopped there.

**The action the card renders is built in Shared Core.** `naavi-chat:2092` constructs the
`DRAFT_MESSAGE` with `to: params.to_name` — Claude's raw, unresolved word — and hands it to the
client. The `"me"` that appeared on the card originated there, not in the app.

**This does not reopen voice.** Two different axes, and they must not be collapsed:

| Axis | Answer |
|---|---|
| **Which user-facing surface is affected?** | **Mobile only.** Voice settled by three live calls. Unchanged. |
| **Which component owns the code?** | **Shared Core**, not the mobile client. |

A defect can be owned by Shared Core and reach only one surface — that is exactly what happens when
the other surface's classifier never produces the input. **Phase 0's voice withdrawal stands
untouched.**

---

## 1. The six Phase 1A questions, answered explicitly

### Q1 — What is the architectural owner of the affected capability?

**Shared Core** (`munk2207/naavi-app/supabase/functions/*`), per the Reference's Ownership Model
§0a. Specifically `naavi-chat` and `_shared/anthropic_tools.ts`. The mobile client owns only the
*display* of the resolved recipient.

### Q2 — Is the capability Shared Core, Duplicated, or Platform-specific?

**Shared Core, and internally duplicated.** `DRAFT_MESSAGE` is constructed in **two** places inside
`naavi-chat`:

| | Site A — Layer 2 (deterministic classifier) | Site B — Path B (Claude tool-use) |
|---|---|---|
| Built at | `:2067-2093` | `:3925` — `{ type: actionType, ...b.input }` |
| Recipient field | `to: params.to_name` | `to`, spread from the tool input |
| Resolution performed | **none** | **none** |

**This is the same two-site shape Architecture Reference §2e documents for location alerts** — and
§2e's own table already notes that Site B *"shares its exit with `DRAFT_MESSAGE`"*. §2e was written
after B9x's first fix landed on one site and eleven passing tests guarded unreachable code.
**Any Phase 2 change here must address both sites or state explicitly why one is excluded.**

### Q3 — If duplicated, were all documented implementations investigated?

**Yes — all three components, freshly verified this session.** Provenance tags per the Verification
Provenance Rule:

| Component | Verdict | Provenance |
|---|---|---|
| **Shared Core** | **Affected — the origin.** `naavi-chat:2092` (Site A), `:3925-3958` (Site B), `:2068` (the existing missing-recipient path), `_shared/anthropic_tools.ts:448-463` (the tool contract) | **Freshly verified this session** — every line read directly |
| **Mobile** | **Affected — display only.** `app/index.tsx:450-515`, `:654-665`; `hooks/useOrchestrator.ts:3225-3252` pushes the raw action unchanged | **Freshly verified this session** |
| **Voice** | **NOT affected.** `src/index.js:12324-12326`, `:13949-13998` — the draft path exists but is unreachable from this phrasing | **Freshly verified this session**, plus **three live calls** with zero misfires |

### Q4 — If not, which were investigated and which were not?

All three were investigated. **Nothing was left unchecked.**

### Q5 — Does the documented problem scope match the Architecture Reference?

**NO. The Architecture Reference does not document this capability at all** — no row in §2, §2b or
§5a; one incidental mention in §2e. See §3.

**This is a recorded Phase 1A finding and it does not gate Phase 2.** Under the Reference-Document
Read-Only Rule (Governance v4.3 §3) it is carried to Phase 8 for the Architecture Owner's review and
explicit approval. **B11l proceeds on Architecture Reference 2026.07.18.15, supplemented — for this
work item only — by the approved findings in this document.** *(Corrected 2026-09-01 — this answer
previously ended "This is the finding that gates Phase 2.")*

### Q6 — Is any documented implementation excluded from the investigation?

**Yes, one, and deliberately: `naavi-voice-server`.** Excluded by Phase 0's withdrawal of 2026-09-01,
on positive evidence — three live calls, three routings, zero misfires. **Justification recorded,
not silence.** Reopening requires a Phase 0 amendment from Wael.

---

## 2. The three findings Phase 2 must carry

### ⭐ 2.1 — Shared Core delegates recipient resolution to the entry point, by written contract

`_shared/anthropic_tools.ts:455`, the `draft_message` tool schema:

> `to: { type: 'string', description: 'Contact NAME only. **Orchestrator resolves email/phone.**' }`

**Shared Core instructs Claude to emit an unresolved name and assigns the resolution to the mobile
orchestrator.** That is not an oversight — it is the documented contract, and it is what produces
defect B: the client is the only thing that ever learns who was matched, and the client displays the
phone number without the name.

**This contradicts Architecture Principle §1**, which states *"Entry points translate requests rather
than implement business logic"* and *"Shared business logic belongs in Shared Core."* Deciding which
human being receives a message is business logic.

**`make_call:472` carries the identical wording** — *"Contact name only. Orchestrator resolves to
phone number."* **Flagged, not investigated.** Whether MAKE_CALL has the same user-visible exposure
is unproven and out of B11l's scope; it is reported here rather than silently fixed (Phase 4's No
Extra Changes Rule).

### ⭐ 2.2 — The correct behaviour already exists in Shared Core, one condition away

`naavi-chat:2068`:

> `if (!params.to_name) return { … missingParam: "Who should I send the message to?" }`

**That is the same sentence voice spoke on the live call.** The guard fires when the recipient is
**absent**. It does not fire when the recipient is **present but unresolvable**.

Voice reached it because voice's classifier supplied no `to_name`. Mobile did not, because Claude
supplied `"me"` — a value that is present, and meaningless.

**Voice and mobile are not running different logic here. They are running the same Shared Core code
and differing only in whether Claude filled the field.**

**An existing missing-recipient guard therefore provides a potentially reusable mechanism. Phase 2
must determine whether — and under what conditions — self-referential or otherwise invalid recipient
values should enter that path.**

> **⚠️ Corrected 2026-09-01 on review. This paragraph previously concluded: *"The fix shape is
> therefore narrower than Phase 1 implied: **extend an existing guard's condition**, not build a new
> mechanism."* That was Phase 1A prescribing a fix, which is Phase 2's work, and it was not
> established by anything above it.**
>
> **What this section proves:** the guard fires on a **missing** `to_name`, and mobile supplied
> `"me"`. **What it does not prove: what condition should make `"me"` equivalent to missing.**
>
> **And `"me"` is not universally an invalid recipient.** Phase 0 records that *"email me at
> jane@x.com in 3 minutes"* already has working semantics that must not change, and Phase 1 §5
> measured collisions on `me`, `my`, `us` and `her`. **Deciding which values are self-reference,
> which are ambiguity, which are a real contact, and which are simply too short to trust is design
> work** — and it is precisely the judgement Phase 0 warned would add a third meaning to a phrase
> that already has two.

### ⚠️ 2.3 — A recorded architectural decision stands directly in the way, and must not be stepped over

`naavi-chat:3480-3484`, written during B9x:

> *"`resolveLocationRecipient()` is a no-op for anything that is not a location `SET_ACTION_RULE`,
> which is what keeps `DRAFT_MESSAGE` — the other intent sharing this return — **completely
> untouched. It has its own recipient handling and must not acquire a second one.**"*

**That comment is accurate and is also the reason nobody looked.** `DRAFT_MESSAGE` does have its own
recipient handling: the mobile card. **Phase 1 proved that handling is the thing that lied.**

Any Phase 2 design placing resolution at that site is **reversing a deliberate, documented decision**
from a prior work item. It may well be the right call — but it must be named, argued, and approved,
not quietly overwritten. Flagging it here so Phase 2 opens with it rather than discovers it.

---

## 3. Architecture Reference omission — **recorded finding, deferred to Phase 8. Does not gate Phase 2.**

**The Architecture Reference contains no description of immediate message drafting or its recipient
resolution.** Verified by exhaustive search of the document, 2026-09-01:

- **§2 (Shared Core Boundaries)** — no row for drafting or sending an immediate message. Rows exist
  for notification *sending* (`send-sms`/`send-email`) and for action-rule creation, but nothing for
  the path a user takes when they say *"text Bob."*
- **§2b (recipient resolution)** — its table covers **location** triggers and **time-trigger
  third-party**. **Immediate drafts are absent**, despite the section being titled for exactly this
  question.
- **§5a (Full Duplication Inventory)** — no row, though §2 above establishes two independent
  construction sites inside one function.
- **The only mention in the entire document** is incidental: §2e's table notes Site B *"shares its
  exit with `DRAFT_MESSAGE`"* — a passing reference in a section about something else.

**This is a recorded Phase 1A finding. It does NOT gate Phase 2, and no Architecture Reference edit
is proposed or made during Phases 0–7.**

Per the **Reference-Document Read-Only Rule** (`AI_DEVELOPMENT_GOVERNANCE.md` v4.3 §3, added
2026-09-01): Phases 0–7 are read-only with respect to reference documents; a defect found in them is
recorded as a finding only, and reconciliation occurs **only at Phase 8**, after implementation and
testing evidence are complete, and **only with Wael's explicit approval**. The rule's narrow blocking
exception — *unsafe, or impossible to define* — **does not apply here**: the two construction sites,
the tool contract and the existing guard were all established by direct code reading in §2, so B11l's
implementation is fully definable without any Reference edit.

> **⚠️ Superseded 2026-09-01. This paragraph previously read: *"Under the Architecture Drift Rule
> this is Outcome 3 … which specifies: implementation stops, and the Reference is reconciled before
> proceeding,"* and cited revisions 10 (B11k), 11 (B11x) and 13 (B9x) as precedent for blocking at
> Phase 1A.** That was an accurate reading of the governance **as it stood when written**. Outcome 3
> has since been amended to record-and-defer, and those three precedents are now history rather than
> instruction. **[[B11l]] is the originating case for that amendment** — this finding is what
> demonstrated Outcome 3 halting an item over an omission months older than it and immaterial to its
> fix.

**The parallel to B11x is close enough to be worth naming.** There, one wrong word — *"cron-driven"*
— sent four months of cost-reduction work at the wrong target, because the map showed only the cron.
Here the map shows **nothing**, and Phase 1 correspondingly looked only where the map pointed: at the
client. **An omission misdirects exactly as a wrong word does; it is simply harder to notice, because
there is no sentence to disagree with.**

### 📌 PHASE 8 ITEM — deferred, for Architecture Owner review and explicit approval

**Not a proposal for now. Nothing is to be edited or version-bumped during Phases 0–7.** This is
carried forward and raised at Phase 8, where the Architecture Owner (Wael, per §4's Ownership Model)
reviews it and either approves the reconciliation or does not. **Listed here so the finding survives
the phases in between with its evidence attached** — the content below is the Phase 8 agenda, not a
live request:

1. **§2** — a new row: *Immediate message drafting (`DRAFT_MESSAGE`) — Shared Core (`naavi-chat`),
   internally duplicated across two construction sites; recipient resolution delegated to the entry
   point by tool contract.*
2. **§2b** — a third row in the recipient-resolution table for immediate drafts, recording that
   resolution happens **at display time on the client**, not at creation.
3. **§5a** — a duplication row for the two `naavi-chat` construction sites.
4. **A version bump**, in the same commit as the edits, per revision 5's own note. **The number is
   deliberately not fixed here** — it depends on what else lands before B11l reaches Phase 8.

---

## 4. Independent Review Rule — status

Governance Phase 1A requires two independent reviews, and a Phase 1 document cannot receive an
overall approval recommendation until both pass:

1. **Technical Investigation Review** — Phase 1, **approved by Wael 2026-09-01** after two rounds of
   corrections (the voice claim, then the stale §8/§9 statements).
2. **Architecture Completeness Review** — **this document. Not yet reviewed.**

**Passing one does not imply passing the other.** Phase 1 passed its technical review while
containing the omission this document found, which is the rule working as designed.

---

## 5. What this changes for Phase 2, stated plainly

| Phase 1 implied | Phase 1A establishes |
|---|---|
| A mobile-client defect | A **Shared Core** defect displayed on mobile |
| Fix the card, and add a self-rule to the prompt | The card is one of **three** places involved — two construction sites and a tool contract |
| One construction path | **Two**, mirroring §2e's Site A / Site B |
| Build a missing self-default | **Existing missing-recipient handling may be reusable; Phase 2 determines the correct semantics and implementation.** *(Corrected 2026-09-01 — previously read "Extend an existing guard", which prescribed a fix Phase 1A had not established. See §2.2.)* |

**Platform scope is unchanged: MOBILE ONLY.** What changed is *where the code lives*, not *who is
affected*.
