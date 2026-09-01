# B11l — Phase 8: Merge

| | |
|---|---|
| **Item** | B11l — *"text me"* resolves to a stranger, and the confirmation card labels him *"me"* |
| **Date** | 2026-09-01 |
| **Governance** | `AI_DEVELOPMENT_GOVERNANCE.md` v4.3, §3 Phase 8 |
| **Target** | **Staging only.** Supabase `xugvnfudofuskxoknhve` · staging APK 331. No production deploy, no AAB |
| **Status** | **The Architecture Reference edits below are NOT made. They need the Architecture Owner's approval — §4 and the Reference-Document Read-Only Rule.** |

---

## 1. Merge preconditions

| Precondition | State |
|---|---|
| Automated tests pass | ✅ **575 tests, 0 failures.** 15 errors traced to a dead Google token on the gates account, verified as a credential fault by comparing two accounts through the same function. Phase 7 §1a |
| Manual validation passes | ✅ **Four device tests on build 331**, on the account where the defect reproduces. Delivery confirmed in `sent_messages`, not from the screen. Phase 7 §2 |
| External review completed | ✅ Phase 3 before coding, Phase 6 after. **Phase 6's four reviewer verdict slots are deliberately unfilled** — no external reviewer issued them, and filling them would make the document assert its own review. Wael approved Phase 6 directly, which under §10 is the decision that counts |
| Architecture Reference updated | ⏳ **This document. Proposed, not made** |
| No newer Reference superseded Phase 1A's version | ✅ See §2 |

---

## 2. Architecture Reference version verification

Phase 1A recorded **2026.07.18.15**. The committed Reference is **2026.07.18.15**. **No
newer version has superseded it in the repository.**

**One thing stated rather than glossed:** the working tree carries an **uncommitted
`.16`** — the **Reference-Document Read-Only Rule**, written earlier today on Wael's
instruction and deliberately left uncommitted at his direction (*"only commit Governance,
do not commit Architecture"*).

**Evaluated explicitly, as Phase 1A requires rather than assumed away:** `.16` adds a rule
about **when** this document may be edited. It changes no capability's ownership, no
classification, and no boundary. **It invalidates no assumption B11l relied on.**

**It is also the rule this item is the originating case for** — which is why B11l's own
Reference findings have sat unactioned since Phase 1A instead of blocking Phase 2.

---

## 3. ⭐ The Architecture Reference finding, carried since Phase 1A

**The Reference has never described immediate message drafting.** Verified by exhaustive
search at Phase 1A and unchanged since:

- **§2** — no row for drafting or sending an immediate message
- **§2b** — its recipient-resolution table covers **location** and **time-trigger
  third-party**. Immediate drafts are **absent**, despite the section existing for exactly
  this question
- **§5a** — no duplication row, though `naavi-chat` builds `DRAFT_MESSAGE` in **two**
  places
- **The only mention anywhere** is incidental: §2e notes Site B *"shares its exit with
  `DRAFT_MESSAGE`"*, in a section about something else

**This is Outcome 3 — stale before B11l began.** Under the old rule it would have blocked
Phase 2. Under v4.3 it was recorded and carried here.

**The cost of the omission is measurable in this item's own record:** Phase 1 concluded the
defect was a mobile-client bug and never opened `naavi-chat`, because the map gave it
nowhere else to look. Phase 1A found the origin was Shared Core, with two construction
sites. **An entire phase went by against a map that did not mention the capability.**

---

## 4. Proposed edits — for the Architecture Owner. NOT made.

### 4.1 — §2, new row

> \| **Immediate message drafting (`DRAFT_MESSAGE`)** \| `naavi-chat` (Shared Core) \|
> **Shared Core, internally duplicated across two construction sites** — Layer 2's
> deterministic classifier and the Path B tool-use mapper. Recipient resolution is
> **delegated to the entry point by tool contract** (`_shared/anthropic_tools.ts`: *"Contact
> NAME only. Orchestrator resolves email/phone"*), which is why the client historically
> owned it. **Since [[B11l]] (2026-09-01) a self-reference resolves in Shared Core** before
> any contact search; every other recipient still resolves on the client \|

### 4.2 — §2b, third row in the recipient-resolution table

> \| **Immediate draft (`DRAFT_MESSAGE`)** \| **No shared resolver.** The tool schema
> instructs Claude to emit a bare name and assigns resolution to the orchestrator. The
> mobile card resolves it at display time. **Self-references (`me`, `myself`, …) are
> resolved in Shared Core by `resolveSelfRecipient()`, awaited at both construction sites**
> \| **Partly** — self only \|

### 4.3 — §5a, Duplication Inventory row

> \| **`DRAFT_MESSAGE` construction, intra-`naavi-chat`** (**new row 2026-09-01**) \| \| ✅
> \| Not an accepted Exception. Two independent construction sites inside one function —
> Layer 2 (`:2181`) and the Path B mapper. Mirrors §2e's location-alert shape. A test
> asserts `resolveSelfRecipient` is awaited at **exactly two** call sites, because [[B9x]]
> lost three live trials to a fix on one site alone \|

### 4.4 — Version: **2026.09.01.16** — ✅ APPLIED

**Wael's ruling, 2026-09-01, correcting what this section originally proposed.**

The original draft offered two options, both of which assumed the uncommitted `.16`
read-only-rule edit would land in the Architecture Reference. **Wael rejected the premise
rather than choosing between the options:**

> *"We previously established that this rule belongs in Governance, not Architecture
> Reference. The Architecture Reference should describe architecture, not duplicate
> governance/process rules."*

**Applied exactly as instructed:**

1. The uncommitted Architecture Reference `.16` change was **discarded** (`git checkout --`),
   not committed. **Verified first that the rule survives in committed Governance v4.3** — it
   does, so nothing was lost.
2. §4.1, §4.2 and §4.3 were applied to the **last committed `2026.07.18.15`**.
3. The result is versioned **`2026.09.01.16`** — the date component moves to today, so the
   identifier records when the content was verified rather than the filename's original date.
4. **Governance v4.3 is the sole authority for the Reference-Document Read-Only Rule**, and
   revision 16's note says so explicitly, so a future reader does not re-add it here.

**Why the correction matters beyond tidiness:** a process rule copied into the architecture
document would have created two homes for one rule — precisely the "five parallel
architecture documents" failure this file's own header was written to prevent, in miniature.

---

## 5. What merges, and what does not

**Merged to staging already** — `naavi-chat` deployed (source `7bb559bd4222`), APK 331 on
Wael's phone, four commits on `main`.

**Not merged, and not requested:** production. Phase 0 scoped this staging-only; CLAUDE.md
requires Wael's explicit words for any production deploy or AAB. **And Phase 7 §1b records
that a production AAB is currently impossible anyway** — Rule 15 needs a 100% green
`test:auto`, which cannot happen while the gates account's Google token is revoked.

---

## 6. Carried out of this item, deliberately unactioned

Reported at Phase 5 §8 and Phase 6, **none made into tracked items** (Wael's ruling):

1. `self_override_sms` receiving `"true"` instead of a phone number — **measured live
   impact**: the alert fired, WhatsApp and voice arrived, the SMS silently did not.
2. Naavi's spoken sentence saying *"to me"* while the card says *"To: you"*.
3. My fail-closed message duplicating the pre-existing guard's wording, which made the two
   indistinguishable during diagnosis.
4. `conversations` written on every turn and read by nothing.
5. `src/orchestration/*` imported by no app code.
6. Compound requests handled three different ways, one of which silently drops the message.
7. The gates account's dead Google token — blocks Gate 1, and therefore any production AAB.

**One was created, with approval: [[T15]]** — the staging outbound allowlist not tracking
the test account's contacts, explained and approved before the row was written, per Rule 1b.
