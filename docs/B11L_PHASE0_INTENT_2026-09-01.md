# B11l — Phase 0: Intent Approval

| | |
|---|---|
| **Item** | B11l — *"text me"* resolves to a stranger, and the confirmation card labels him *"me"* |
| **Date** | 2026-09-01 |
| **Governance** | `AI_DEVELOPMENT_GOVERNANCE.md` v4.2, §3 Phase 0 |
| **Architecture Reference** | 2026.07.18.15 |
| **Platform** | **⭐ MOBILE ONLY.** Voice withdrawn from scope 2026-09-01 by Wael, on positive evidence (three live calls, zero misfires). Reopening requires a Phase 0 amendment. |
| **Classification** | **Protected Core** — Action Rules (recipient resolution) + Notification routing. Full Phase 1–8. |
| **Status** | **APPROVED — Wael, 2026-09-01**, with one required edit (applied). Phase 1 investigation authorised. **No code written.** |

---

## The defect, in one paragraph

Wael said *"text me"*. Naavi searched his contacts for the word "me", matched **AbdelMegid EL
Mehelmy** — because the two letters `me` sit inside "**Me**helmy" — and rendered a draft card reading
**`To: me (+1 438 765 0528)`**. That is not Wael's number. One tap would have sent a real message to
a real stranger. He caught it by reading the digits and declining to press Send.

---

## The evidence, and how old it is

**Measured 2026-08-21** — `lookup-contact` called directly against production for `788fe85c…`
(wael.aggan@gmail.com):

| Query | Result |
|---|---|
| `name="me"` | **`AbdelMegid EL Mehelmy` · `+1 438-765-0528`** top hit, six further matches behind it |
| `name="Wael"` | `Wael` · `+1(613) 769-7957` — **correct, and available the whole time** |

Also established that day: `get-naavi-prompt` contains **no** rule mapping *"text me"* to the user as
recipient, and `lookup-contact` has **no** minimum-query-length guard.

> **⚠️ This evidence is eleven days old and is not re-asserted as current by this document.** Google
> People API results are not stable over time, and this session's own governing lesson is that a row
> can be accurate when written and wrong when read. **Phase 1 re-establishes every line above before
> anything is designed on top of it.** If the defect no longer reproduces, Rule 17 applies and the
> item is closed rather than fixed.

> **✅ RE-ESTABLISHED 2026-09-01, twice, by two independent methods — the caveat above is discharged.**
>
> 1. **`lookup-contact` called live against production**, same account, same day: `"me"` → **9
>    results, `AbdelMegid EL Mehelmy` · `+1 438-765-0528` on top**; `"Wael"` → his own number,
>    correct. Identical to the 2026-08-21 measurement eleven days earlier. Phase 1 §1.
> 2. **⭐ Wael reproduced it on the mobile app the same day, using both test phrases, and both
>    failed.** Reported 2026-09-01. **This is the user-facing reproduction Rule 17 requires** — the
>    first measurement proves the lookup returns a stranger; this proves a real user still meets it
>    on the real surface.
>
> **Together with voice passing all three of its trials, this is what fixes the item to MOBILE
> ONLY** — not an absence of evidence about voice, but positive evidence on both sides.

---

## Two defects, not one

They are separable, and the distinction governs the rest of this item:

| | What is wrong |
|---|---|
| **A — the match** | *"me"* reached contact search at all. It denotes the user, whose number is already on the account making the request. Nothing needed guessing. |
| **B — the readback** | The card **echoed the user's own word** rather than naming who was actually matched. *"To: me"* reads as self-evidently safe. Only the digits gave it away. |

**B is the one that made A dangerous.** CLAUDE.md Rule 12 requires a readback specifically so the
user can *"detect mis-resolutions immediately"* — here the readback asserted the wrong recipient in
the user's own vocabulary, which is the opposite of what it exists to do.

**B also generalises and A does not.** Fixing A stops this phrase. Fixing B makes **every** wrong
recipient visible, including ones nobody has found yet — [[B9m]] among them.

> **⚠️ Correction added 2026-09-01 on Wael's ruling, after Phase 1 measured it. The two paragraphs
> above are left as written; this note records what they got wrong.**
>
> **"A does not generalise" is false, and it is false in the direction that shrinks the problem.**
> Measured live against production the same day: **four of six pronouns collide** on this account —
> `me` → *AbdelMegid EL Mehelmy* (9 results), `my` → *Sarah El-Gillani* (9), `us` → *RBC USA* (2),
> `her` → a painting company (1); `him` and `them` return nothing. **A is a class, not a phrase**, and
> *"fixing A stops this phrase"* would have sized the work at one word.
>
> **Two of those four matched inside an email address, not a name** — `mynaavi2207@gmail.com` and
> `heropropainters.ca`. The People API searches every stored field, so the collision surface is wider
> than the surname mechanism the holding-list row describes. **This touches the [[B9m]] boundary; that
> boundary is unchanged and remains Wael's to move (Rule 1b).**
>
> **The relationship claim in the paragraph above it stands.** Phase 1 found the two defects have
> **independent root causes** — but B is still what made A invisible, which is what that paragraph
> says. Evidence: `B11L_PHASE1_PROBLEM_DEFINITION_2026-09-01.md` §2, §3 and §5.

---

## User Intent

> When Naavi shows the user who a message is about to go to, that must be who it will actually go
> to — named truthfully, not echoed back from what the user typed. And *"me"* must mean the user.

---

## Success Criteria

1. *"text me"* reaches the user's own number, without a contact search deciding it.
2. A draft or alert card names **the contact that was actually matched**, so a wrong recipient is
   visible to the user before they act on it.
3. Nothing that works today breaks — specifically the *"email me at jane@x.com in 3 minutes"*
   vocabulary, which already assigns two meanings to this phrase (see Constraints).

---

## In Scope

- **Phase 1 investigation** of the three unknowns listed below. No fix is designed until they are
  settled.
- The recipient-resolution path that serves *"text me"* on mobile, and the code that produces the
  confirmation card's recipient label. **Which files those are is a Phase 1 output, not a Phase 0
  assumption** — the item's own evidence names three independent `lookup-contact` call sites for
  third-party recipients (Architecture Reference §2b), and which one serves this path is unproven.
- Regression tests, per Rule 15a.
- Deploy to **Supabase staging** (`xugvnfudofuskxoknhve`).

> **⭐ MOBILE ONLY. Voice was withdrawn from scope on 2026-09-01, by Wael, after Phase 1 settled it.**
> This bullet previously read *"`naavi-voice-server/src/index.js` — **only if** Phase 1 finds voice
> exhibits the same behaviour."* **The conditional has resolved to NO and is therefore closed, not
> carried.**
>
> **Why it was removed rather than marked resolved in place.** An open conditional obliges every
> later phase to re-open the question — Phase 1A's cross-repository check, Phase 2's Voice row, Phase
> 3's file authorisation. Wael's instruction, 2026-09-01: *"I do not have drift in the middle and we
> start talking about Voice again."* With the line withdrawn, Phase 2's Voice row is answered by
> **citation** rather than by re-deciding. **Governance Rule 0.2 — anything not explicitly In Scope
> is Out of Scope.**
>
> **Reversal requires a Phase 0 amendment, which is Wael's decision — not a session's.**

### The three unknowns Phase 1 must settle

Stated as open, because the holding-list row explicitly says not to assume either way:

1. ~~**Does voice do this too?**~~ — **ANSWERED 2026-09-01: NO. Voice does not have this defect.**
   Three live calls to staging voice, three different routings, **zero misfires**: *"Text me saying
   hello"* → **asked who** to send it to (zero actions); *"Text me in five minutes saying hello"* →
   routed to a **self-alert on Wael's own number**, message received; *"Text me saying hello"* again
   → **asked when**, then created the time alert correctly. Voice asks rather than guesses, and
   `"me"` never reached contact search on any trial. Measured from the running container's logs, not
   from recollection. Satisfies the Non-Determinism Rule's three-trial requirement. Full evidence:
   `B11L_PHASE1_PROBLEM_DEFINITION_2026-09-01.md` §4.
   **Caveat recorded once:** transcription mangled "Text" in two of the three trials, so voice
   received the exact phrase cleanly only once. All three refused to guess a recipient regardless.
2. **Does a self-defaulting mechanism already exist on this path?** One exists at
   `hooks/useOrchestrator.ts:4256` (B4y) but sits on `SET_ACTION_RULE`, not on draft-message.
   **If one does exist here, this is a weak match outranking it — an ordering problem, and a
   materially cheaper fix than building anything new.**
3. **How many other short queries collide?** `scripts/diag-lookup-contact-single-letter.js` already
   probes single letters, so this ground has been walked before.

---

## Out of Scope

| Excluded | Why |
|---|---|
| **⭐ `naavi-voice-server` — the entire voice surface** | **Withdrawn 2026-09-01 by Wael, after Phase 1 settled unknown #1 as NO.** Three live calls, three routings, zero misfires — voice asks who or when, and never sends `"me"` to contact search. **B11l is a MOBILE-ONLY item.** Any later phase asking "should voice change too?" is answered here: no, by evidence, and reopening it requires a Phase 0 amendment from Wael. Evidence: Phase 1 §4. |
| [[B9m]] — contact "MyNaavi" matching a search for "wael" | **Same family, different mechanism. Do not merge.** A field colliding with a name query, plus Google's non-deterministic cache — not a short substring hitting a surname. A fix for either does not fix the other. |
| [[B4z]] — the universal confirm-then-act gate | Governs *whether the user is asked at all*. Separate item. |
| [[B11k]] — action outcome reporting | Governs what the user is told *after* an action. Separate item, and Architecture Reference §5a Priority 1c. |
| General contact-search quality beyond what Success Criteria 1–2 require | Scope control. Anything found is reported, not implemented (Phase 4's No Extra Changes Rule). |
| Any production deploy · any mobile build | Requires Wael's separate word. |
| Any new tracked item | Rule 1b — explained and approved first, or not created. |

---

## Constraints

- **⭐⭐ This cannot be reproduced on staging, and a green staging test proves nothing.** Measured
  2026-08-21: `name="me"` returns **0 results** on staging `robert.esm.2207` and **0** on staging
  `mynaavi2207`, against **9** on production `wael.aggan`. Same code, opposite outcome — the
  difference is the **data**. Staging's contact lists are deliberately controlled and hold no name
  containing "me". **Reproduce on production, or against a contact list carrying a deliberate
  collision. Never on the plain staging APK.**
- **The phrase already has two meanings.** `get-naavi-prompt` maps *"email me at jane@x.com in 3
  minutes saying test"* to a `set_action_rule` with `self_override_email`, and carries a
  carefully-tuned section distinguishing that from `draft_message` — written after [[F15]] confused
  the two. **Any fix here adds a third meaning to that phrase.** Scope it deliberately; do not add a
  keyword.
- Staging only. No production deploy, no AAB, without Wael's explicit instruction.
- Protected Core → full Phase 1–8, Wael's own approval at every gate.
- Rule 15a — regression tests before this closes.
- **Non-Determinism Rule** (Governance Phase 3) — if the fix touches a prompt or classifier, every
  behaviour-changing case needs **at least 3 independent trials** with the full distribution
  reported. One passing trial proves nothing.

---

## Completion Criteria

1. Phase 1 has re-established the 2026-08-21 evidence as still current, and settled the three
   unknowns. **Unknown #1 (voice) is settled — NO — and voice is withdrawn from scope; this
   criterion no longer asks anything about `naavi-voice-server`.**
2. *"text me"* produces the user's own number **on mobile**.
3. The card names the matched contact truthfully, so a wrong recipient is readable at a glance.
4. *"email me at jane@x.com in 3 minutes saying test"* verified unchanged.
5. Verified against a contact list containing a short-substring collision — **not** against plain
   staging data.
6. Deployed to staging.
7. Regression tests added, registered, green — 3 trials each for any prompt behaviour.
8. Architecture Reference re-checked at Phase 8 (§2b's recipient-resolution table is the section
   most likely to need it).
9. Wael's explicit approval at every phase gate.

---

## Scope decision — both defects, order deferred to Phase 1

**Both A and B are in scope. Phase 1 must determine their relationship and the appropriate
implementation order before any fix is designed.**

The narrower alternative — fix only *"me"* and leave the card echoing the user's word — was
considered and **rejected by Wael on 2026-09-01**. The card is what stands between a wrong match and
a real message reaching a real person, and it is currently incapable of showing one; fixing only the
phrase leaves that intact for every collision nobody has found yet.

> **⚠️ Corrected 2026-09-01, on Wael's required Phase 0 edit.** This section previously read *"Both A
> and B are in scope, with **B — the readback — fixed first**."* **Phase 0 defines scope and intent,
> not implementation order.** That sentence fixed an order this document elsewhere admits it cannot
> yet justify: Phase 1 has not established where either defect occurs, and this document's own third
> unknown says that if a self-defaulting mechanism already exists on this path, **A is an ordering
> problem rather than a missing feature** — which would change the correct sequence entirely. Wael's
> ruling: *"Phase 1 must determine their relationship and the appropriate implementation order before
> any fix is designed."*

---

## Approval

**APPROVED — Wael, 2026-09-01**, with one required edit (applied above). Phase 1 investigation
authorised.
