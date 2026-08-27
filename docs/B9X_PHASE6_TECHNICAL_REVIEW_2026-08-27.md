# B9x — Phase 6: Technical Review (After Coding)

| | |
|---|---|
| **Item** | B9x — an alert meant for another person silently fires to the user instead |
| **Date** | 2026-08-27 |
| **Governance** | v4.2, §3 Phase 6 · §13 Gates |
| **Commit under review** | **`fc71146`** |
| **Evidence** | `docs/B9X_PHASE5_EVIDENCE_2026-08-27.md` (contains the full diff) |
| **Deployed** | **Nowhere.** |
| **Status** | Submitted for external review. |

**Everything below marked "Claude's assessment" is a self-assessment.** The four verdicts that count
are the reviewer's.

---

## 1. ⭐ Architecture Drift Rule — Outcome 2, and it makes the Reference update a merge precondition

**Does the implementation still match what the Architecture Reference claims? No — and the divergence
is intentional and approved.**

The Reference (2026.07.18.**12**, §2b) says of location recipient resolution:

> Yes at **creation** time — one function, used by mobile and voice (**2 call sites**).

**After `fc71146` there are three call sites.** `naavi-chat` is now the third, alongside voice
(`src/index.js:12616`) and the mobile orchestrator (`useOrchestrator.ts:3493`).

Under the Architecture Drift Rule this is **Outcome 2** — divergence caused by an intentional,
approved architectural change made during this work item. **Not a FAIL. But it makes updating the
Architecture Reference a hard precondition for merge at Phase 8, not an optional follow-up.**

Two edits will be required at Phase 8, and **neither has been made**:

1. §2b's Location row: "2 call sites" → three, naming `naavi-chat` as the creation-time resolver for
   the mobile surface.
2. The addition Wael deferred at Phase 1A — that mobile has three location-creation paths and only
   `:3996` resolves independently. After this change the other two receive a pre-resolved
   `action_config`, so the wording must describe the new state, not the old.

**Nothing else in the Reference changed.** Capability ownership is unchanged (Shared Core), the
classifier remains Duplicated (Priority 1 / ADR 0001), and this change **does not resolve** that
duplication — Phase 6 must not claim it does.

---

## 2. Invalidated planning assumptions

Recorded per the Phase 6 rule, distinct from omitted features and from deliberate scope cuts.

| # | Phase 2 assumed | Implementation found | Why it did not hold |
|---|---|---|---|
| 1 | *"a new recipient-resolution step"* | The mechanism already existed for time triggers (`naavi-chat:4252`) | Nobody had read that region. Found at Phase 3, before code — the cheapest place to find it. |
| 2 | Ambiguity answered with a **numbered pick** (Phase 3's preferred shape) | Reverted to *"say their full name"* | The pick path routes through Step 1.4 → `manage-rules`, which **cannot write location rules** (`manage-rules:321`, its own comment). A location rule written that way saves with no `resolved_lat`/`resolved_lng` and **never fires**. Wael ruled option 1, 2026-08-27. |
| 3 | The behaviour table had **no row** for "contact found, but not on the channel this alert needs" | Implemented as a fifth fail-closed case | Emerged from using `resolve-recipient` with `action_type='email'`: a contact can resolve successfully and still have no email. **See §4.1 — this is an addition beyond the approved table and the reviewer should rule on it.** |

---

## 3. Claude's assessment against the four verdicts

### 3.1 Technical Review — **PASS, with two findings** (§4)

The branch is correctly isolated, fails closed on every non-resolving outcome, preserves
`self_override_*` ahead of everything else, and never emits an action carrying a name without an
address. 11/11 tests pass; `deno check` shows 57 errors before and 57 after, none in the new block.

### 3.2 Architecture Completeness — **PASS**, each question answered explicitly

| Question | Answer |
|---|---|
| Increased duplication? | **No.** It calls the existing shared `resolve-recipient` rather than reimplementing lookup. |
| Reduced duplication? | **Partially.** Location recipient resolution moves from the mobile client into Shared Core, covering all three mobile paths. **It does not resolve Priority 1 / ADR 0001.** |
| Bypassed Shared Core? | **No.** The change *is* in Shared Core. |
| Introduced another independent implementation? | **No** — but it is a **third call site** of `resolve-recipient`, which is the §1 drift. Not a new implementation of the logic; a new caller of the shared one. |
| Violated entry-point responsibilities? | **No.** No mobile or voice file changed. This moves business logic *out of* an entry point. |
| Changed an API contract? | **No.** `action_config` keeps its shape. Fields are populated earlier, not added or renamed. |
| Changed a capability's ownership? | **No.** Shared Core before and after. No Ownership Change Rule approval needed. |
| Expanded Protected Core? | **No.** `naavi-chat` and `get-naavi-prompt` were already inside it. |

### 3.3 Governance Compliance — **PASS, with one exception already recorded**

Phases 0–5 each have a document; Wael's explicit approval recorded at every gate; Rule 15a test added
and registered; Rule 16 `parity-impact:` line present; `PROMPT_VERSION` bumped; Rule 1b honoured — no
tracked item created from anything found.

**The exception, already visible and not being smuggled through:** Governance v4.2 itself was added
without the external review §9 requires, on Wael's direct instruction. It is recorded in that
document's own changelog as *"External review: NOT obtained."* Unrelated to B9x's code, listed here
because a governance-compliance verdict should see it.

### 3.4 Overall — **Claude recommends Approved, conditional on §1's Reference update at Phase 8.**

---

## 4. Two technical findings the reviewer should rule on

### 4.1 A fail-closed case was added that the approved plan did not contain

Phase 2's behaviour table has four failure rows. The implementation has **five** — the extra one
being *contact resolved, but with no address on the channel the alert needs* (an email alert to a
contact with only a phone, or the reverse).

Without it, `resolved_contact` would set neither `to_phone` nor `to_email`, and the action would
continue with an unresolved recipient — **reintroducing exactly the defect B9x fixes**, through the
narrow gap of a partially-populated contact.

**Claude's position:** required for correctness under Phase 0's governing principle, not scope creep.
**But it is behaviour not in the approved plan, so the reviewer is asked to rule** rather than have it
pass unremarked.

### 4.2 ⚠️ On failure, the early return discards **every** action in the turn, not just the location rule

`naavi-chat:4428` returns `actions: []`. If the same turn produced other actions — *"alert me at
Costco when I arrive and add milk to my shopping list"* — the list action is discarded along with the
location rule, and the user is told only about the recipient problem.

**Precedent exists:** the time-trigger intercept does exactly the same at `:4280` and `:4301`. This
change adds a second instance of an existing behaviour rather than inventing one.

**But it matters more here.** B9x's own Reproduction 1 came from the **compound** request path
(`useOrchestrator.ts:914`), which is precisely where multi-action turns occur. The scenario is not
hypothetical for this defect — it is the defect's own origin path.

**What an early return skips**, verified by reading forward from `:4428`: Layer 3 Path B disclosure
(`:4546`), GLOBAL_SEARCH narration cleanup (`:4600`), ADD_TO_COMMUNITY execution (`:4617`), and the
**pending-actions queue** (`:4677`) — the last being the one that would otherwise preserve a
companion action across turns.

**Claude's position:** out of scope to fix here, and fixing it would touch the time branch too, which
Phase 3 explicitly ruled out. **Recorded rather than repaired. No tracked item created — Rule 1b.**
The reviewer is asked whether it is acceptable as described.

---

## 5. What is not proven, and is not claimed

- **Gate 1 has not been run.** `npm run test:auto` defaults to **production** and deletes rows in its
  fixtures. The 11 new tests are pure source assertions and were run directly.
- **The Non-Determinism Rule is not satisfied.** No live Claude trial has run. 3 trials per
  behaviour-changing case fall to Phase 7.
- **Nothing is deployed** to staging or production.
- **Reproduction 2 is not fixed.** Cause unproven; explicitly out of scope.

---

## 5a. ⭐ Review outcome — **APPROVED WITH CONDITIONS**, external reviewer, 2026-08-27

| Verdict | Result |
|---|---|
| Technical Review | **PASS** |
| Architecture Completeness | **PASS** |
| Governance Compliance | **PASS for B9x itself** — the separately disclosed governance-v4.2 review exception does not invalidate this implementation |
| Overall Recommendation | **APPROVED WITH CONDITIONS** |

**§4.1 — the fifth fail-closed case: ACCEPT, keep it.** *"Once `resolve-recipient` returns a contact,
B9x still has to establish that the contact has the address required by the requested channel.
Otherwise the implementation could pass an unresolved location rule downstream and recreate the exact
failure class B9x is intended to prevent."* Ruled a direct consequence of Phase 0's governing
principle, not scope expansion.

**§4.2 — discarding all actions on failure: ACCEPT for B9x, explicitly as a known limitation.** Not
to be repaired here — the behaviour already exists in the time-trigger intercept and changing the
response/queue architecture would enlarge B9x considerably. **⭐ And explicitly: it must NOT
automatically become another work item.** Under Rule 1b that is Wael's decision. **Preserved in the
evidence and carried into Phase 7's testing context** so it is remembered as a known, accepted limit
rather than rediscovered later as a defect.

**Architecture Drift confirmed as Outcome 2.** The third `resolve-recipient` call site is an
intentional approved change, not accidental drift.

### The two conditions

1. **Phase 7 must prove the implementation live in staging**, including the required
   non-deterministic trials. **Nothing currently proves runtime behaviour.**
2. **Phase 8 may not merge or close B9x until the Architecture Reference is updated** for the third
   call site and the resulting state of the three mobile creation paths.

---

## 6. What the reviewer was asked to decide

1. §4.1 — is the added fifth fail-closed case acceptable, or scope creep to be removed?
2. §4.2 — is the all-actions discard acceptable as described?
3. §1 — confirm Outcome 2, and that the Reference update is a Phase 8 merge precondition.
4. Gates 1–5 (§13) and the four verdicts: Technical Review, Architecture Completeness, Governance
   Compliance, Overall Recommendation.
