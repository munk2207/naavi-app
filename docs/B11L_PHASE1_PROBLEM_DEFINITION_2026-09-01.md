# B11l — Phase 1: Problem Definition

| | |
|---|---|
| **Item** | B11l — *"text me"* resolves to a stranger, and the confirmation card labels him *"me"* |
| **Date** | 2026-09-01 |
| **Governance** | `AI_DEVELOPMENT_GOVERNANCE.md` v4.2, §3 Phase 1 |
| **Architecture Reference** | 2026.07.18.15 |
| **Phase 0** | `B11L_PHASE0_INTENT_2026-09-01.md` — approved 2026-09-01 with one required edit, then **revised at 03:09 AM EST to withdraw voice from scope**. **This document was drafted at 02:48 AM EST against the pre-revision Phase 0, and reconciled against the revision afterwards** — see §4 and §9. |
| **Platform** | **⭐ MOBILE ONLY.** Voice settled as unaffected by three live calls (§4) and withdrawn from Phase 0's scope. |
| **Status** | Updated 2026-09-01 after Wael's review. **No code written.** |

---

## 1. The 2026-08-21 evidence is still true today

Phase 0 required this to be re-established before anything was designed on top of it. **Re-measured
live against production `hhgyppbxgmjrwdpdubcx`, account `788fe85c…` (wael.aggan@gmail.com),
2026-09-01.** Read-only; no writes.

```
=== "me"   → 200, 9 result(s)
    TOP >  AbdelMegid EL Mehelmy | +1 438-765-0528 | mehelmyam@yahoo.com
           Francois Menard       | no phone        | francois.menard@rbc.com
           Fatma El-Mehelmy      | +16137976746    | no email
           Hiba El-mehelmy       | +201273028757   | no email
       ... 5 more
=== "Wael" → 200, 2 result(s)
    TOP >  Wael                  | +1(613) 769-7957 | aggan@cloudmask.com
```

**Identical to the 2026-08-21 measurement, eleven days later.** Same top hit, same number, same
count. The defect is live on production today, and the correct record is still sitting right there
under the user's actual name. **Rule 17 is satisfied — this is not a phantom.**

---

## 2. What exactly is broken

Two defects, as Phase 0 named them. **Both are now proven with file:line evidence, and they are
independent of each other** — neither causes the other.

### Defect A — *"me"* is sent into contact search, and nothing stops it

**Proven.** `lookup-contact` has no minimum-query-length guard. The query goes straight to Google
People API `searchContacts` at `supabase/functions/lookup-contact/index.ts:191-198`. The only length
test in the file is `name.trim().length >= 4` at `:267`, and it gates the *phonetic prefix fallback*,
not the primary search.

**⭐ New, and not previously recorded: the one filter that could have caught this is structurally
incapable of doing so.** `:219-230` narrows multi-result searches to contacts whose **first name
exactly equals** the query's first word — the guard written so "Sami" stops returning Samiha and
Samir. For the query `me`:

- `queryFirst = "me"`
- No contact's first name is "me" (`abdelmegid`, `francois`, `fatma`, …)
- `exactMatches.length === 0`, so the `if` at `:226` is false and **`results` is left untouched**

**All nine matches survive precisely because none of them is a real match.** The filter narrows the
near-misses and passes the total misses through. Google's own ranking then picks the top one, and
`:360` takes `contacts[0]` as `contact`.

### Defect B — the card names the user's word, not the matched person

**Proven, and it is a two-line composition.**

| Line | Code | Renders |
|---|---|---|
| `app/index.tsx:661` | `{toRaw}` | **the word the user said** — `"me"` |
| `app/index.tsx:662-663` | `({resolvedContact})` | and `resolvedContact` is set at `:497-499` to **`contact.phone`** |

```
To: me (+1 438 765 0528)
```

**`contact.name` is never read on this path.** `lookup-contact` returns
`AbdelMegid EL Mehelmy` in the same object — `:339` of the Edge Function puts it there — and the card
discards it. **The single field that would have made the error self-evident is the one field not
displayed.**

**⭐ And the messaging path throws away the ambiguity too.** `:496-500` calls `lookupContact(to)` and
reads only `contact.phone`. The `contacts[]` array — all nine — is ignored. The email path builds a
picker from every match (`:504-514`, rendered `:667-675`); **the SMS path has no picker at all.** Nine
candidates are silently reduced to one, with no indication that a choice was made.

So three separate discards stack on one card: the other eight matches, the matched contact's name,
and any signal that resolution was ambiguous.

---

## 3. Root cause

**A and B have different root causes. Stated separately, because a single fix for both would be
designed against a false premise.**

**A — the prompt scopes `draft_message` to other people and then supplies no handling for the user
themselves.** `get-naavi-prompt/index.ts:564`:

> "If ${userName} uses ANY of: write, draft, compose, send, email, message, text, WhatsApp — AND it's
> about sending something to a person **OTHER than themselves** — you MUST call the draft_message
> tool."

*"text me"* trips the verb list and fails the "other than themselves" condition. **Nothing tells
Claude what to do instead**, so `draft_message` is emitted with `to: "me"`, and `"me"` reaches contact
search as though it were a name.

**⭐ The asymmetry that makes this a gap rather than an oversight: the self-default exists, but only
for alerts.** `:1135` — *"the orchestrator routes self-alerts to ${userName}'s phone/email
automatically"* — and `:709` — *"action_type='sms' with NO to_phone (system defaults to user's own
phone)"*. **This directly answers Phase 0's unknown #2: a self-defaulting mechanism exists on
`SET_ACTION_RULE` and does not exist on `DRAFT_MESSAGE`.** Phase 0 asked whether A might be an
ordering problem — a weak match outranking an existing fallback. **It is not. There is no fallback on
this path to outrank.**

**B — the card renders the request, not the resolution.** `hooks/useOrchestrator.ts:3252` pushes the
raw action (`turnDrafts.push(action)`), and `app/index.tsx:661` prints `action.to` verbatim. The card
was built to echo what was asked for and annotate it with a phone number; it was never built to
report who was found. That is a display contract, not a bug in the lookup.

---

## 4. Voice — Phase 0's unknown #1: **ANSWERED — NO. Voice does not have this defect.**

**Settled by live call, Wael, 2026-09-01, staging voice `+1 343 504 1572`.** Measured from the
running container's own logs (`railway logs --service naavi-voice-staging`), not from the caller's
recollection and not from code reading:

```
[DELETE-GATE] turn-summary payload={
  "user_message":"Text me saying hello.",
  "final_speech":"I'll draft a text message saying hello. Who should I send it to?",
  "speech_modified":false, "action_types":[] }
[Claude DIAG] converted actions: 0 (none)
```

**Voice heard the phrase correctly and asked who to send it to.** No `DRAFT_MESSAGE` was emitted, no
contact lookup ran, `"me"` was never treated as a name. **Zero actions converted.** This is Phase 0's
outcome (c) — voice handles it correctly.

**Consequence: `naavi-voice-server` is OUT of scope.** Phase 0 as approved admitted voice *"only if
Phase 1 finds voice exhibits the same behaviour."* Phase 1 finds it does not.

> **Reconciled 2026-09-01 — Phase 0 has since been revised and that conditional no longer exists in
> it.** On Wael's instruction (*"I do not have drift in the middle and we start talking about Voice
> again"*), the line was **withdrawn from In Scope entirely** and `naavi-voice-server` moved to Out of
> Scope with the evidence attached. **The quotation above is preserved as the wording this finding
> answered**; a reader checking Phase 0 today will find the withdrawal note in its place, not the
> conditional. Reopening voice requires a Phase 0 amendment from Wael.

**B11l is a MOBILE-ONLY item.** The holding-list row's `mobile (voice unverified)` can drop the
parenthesis — Wael's edit to make, not this document's.

**And it rests on positive evidence on both sides, not on an absence of evidence about voice:** three
live voice calls with zero misfires, and **Wael's own reproduction on the mobile app the same day,
using both test phrases, both of which failed.**

### ⭐ The contrast is the most useful thing this test produced

Same user phrase. Same shared `get-naavi-prompt`. **Opposite outcomes.**

| | What it did with *"text me"* |
|---|---|
| **Voice** | Asked: *"Who should I send it to?"* — no action emitted |
| **Mobile** | Emitted a draft to a stranger and rendered `To: me (+1 438 765 0528)` |

The two surfaces run **independently written classifiers** (Architecture Reference §2a), and voice's
already does the right thing. **The correct behaviour is not hypothetical and does not need
designing — it is running in production on the other surface today.** That is evidence for Phase 2,
and it is the strongest argument that the mobile gap is a gap rather than a design choice.

### The `executeDraft` path below is real but is NOT reached by this phrasing

> **⚠️ This section previously claimed "Voice has the same failure," then was corrected to "not yet
> answered," and is now settled as NO. Recording all three states deliberately.** The first was a
> code-path analysis presented as a behavioural finding — Wael rejected it on exactly that ground.
> The analysis below is still accurate about what `executeDraft` *would* do with a draft carrying an
> unresolvable name; it is simply **unreachable from *"text me"***, because voice's classifier asks
> first and never produces that draft. **A reachability claim and a behaviour claim are different
> claims** — Architecture Reference §2e, where eleven passing tests guarded unreachable code.

**What the code path shows, if such a draft is ever produced by some other phrasing:**

`naavi-voice-server/src/index.js`, `origin/staging` and `origin/main` on the **identical tree**
`2392ea32…` (verified 2026-09-01) — so this is both branches:

| Step | Line | What happens |
|---|---|---|
| Draft stored | `:12324-12326` | `pendingDraft = action`, then `console.log`. **No recipient readback is constructed.** |
| Caller confirms | `:11166-11170` | "yes" → `executeDraft(pendingDraft)` |
| Recipient resolved | `:13959-13962` | `lookupContact("me")` → `to = contact.phone`, logged to console only |
| Sent | `:13993-13994` | `send-sms` |

**⭐ Resolution happens AFTER consent.** The caller says yes to a name; the name becomes a phone
number afterwards, and nothing speaks it. The only spoken recipient text on this path is the
**failure** message (`:13965` — *"Sorry, I couldn't find a phone number for me"*). **When the lookup
fails, Naavi tells the caller. When it succeeds wrongly, she says nothing and sends.**

This is Architecture Reference §5a Priority 1c's exact shape — voice speaking before executing and
discarding the result — reached independently here.

> **📕 HISTORICAL — PRE-TEST REASONING, SUPERSEDED BY THE LIVE EVIDENCE ABOVE. Not a current
> assertion.** Retained because it records the correct call made *before* the test existed: that a
> code-path reading could not settle a behavioural question. **The live call has since been run —
> voice emitted zero actions and asked who to send to — so every "not proven" below is now proven,
> and proven NO.** *(Labelled 2026-09-01 on Wael's Phase 1 review; unlabelled, it read as a live
> caveat contradicting §4's finding four paragraphs above it.)*
>
> > **⚠️ NOT PROVEN, and it needs a live call.** Whether voice's Claude actually emits `DRAFT_MESSAGE`
> > for *"text me"* has **not** been observed. The code path above is what happens **if** such a draft
> > reaches it. **Observation:** the path exists and resolves after consent. **Inference:** voice shares
> > `get-naavi-prompt`, so the `:564` gap is the same — but the two surfaces run different classifiers
> > (Architecture Reference §2a), and voice's behaviour cannot be inferred from mobile's. A live call is
> > required before any claim about voice's user-visible behaviour is made.
>
> **The inference in that paragraph turned out to be wrong, and that is worth keeping.** It reasoned
> that because voice shares `get-naavi-prompt`, the `:564` gap would be the same. Voice does share the
> prompt — and still behaves correctly, because the classifier in front of it is a different one.
> **A shared prompt does not produce shared behaviour**, which is Architecture Reference §2a stated
> from the opposite direction than usual: there it explains why a mobile fix fails to reach voice;
> here it explains why a mobile defect fails to reach voice.

---

## 5. Phase 0's unknown #3 — how many other short queries collide

**Measured live, same run, same account, 2026-09-01. Four of six pronouns collide.**

| Query | Results | Top hit | Matched via |
|---|---|---|---|
| `me` | **9** | AbdelMegid EL **Me**helmy | surname |
| `my` | **9** | Sarah El-Gillani | **email** — `mynaavi2207@gmail.com` |
| `us` | **2** | RBC **US**A | name |
| `her` | **1** | Réginald Gracia Painter | **email** — `heropropainters.ca` |
| `him` | 0 | — | — |
| `them` | 0 | — | — |

**⭐ This is broader than the holding-list row recorded.** The row describes *"a short substring
hitting a surname"*. Two of the four collisions are not surnames at all — they are **email
addresses**. `searchContacts` matches across fields, so the collision surface is every stored field,
not just the name.

> **⚠️ This touches the B9m boundary Phase 0 drew, and I am not moving it.** B9m is a contact's
> **email** field colliding with a **name** query — `MyNaavi` / `wael@mynaavi.com` matching a search
> for "wael". The `my` → `mynaavi2207@gmail.com` collision above is the same mechanism. **Phase 0
> ruled the two items must not be merged, and that ruling stands.** This is reported as evidence
> only. **Under Rule 1b, any reclassification, merge, or new item is Wael's decision, not this
> document's** — nothing has been changed.

---

## 6. Architecture ownership and classification

Per the Architecture Reference's Ownership Model (§0a).

| Element | Owning component | Classification | Provenance |
|---|---|---|---|
| `lookup-contact` — name resolution | **Shared Core** (`naavi-app/supabase/functions/*`) | Genuinely shared — §2, "Contacts / name resolution" | **Freshly verified this session** — voice calls the real function at `src/index.js:13930`; no inline reimplementation |
| `get-naavi-prompt` — the `:564` gap | **Shared Core** | Genuinely shared — §2 | **Freshly verified** — `:564`, `:709`, `:1135` read directly |
| DraftCard recipient display | **Mobile** (`naavi-app`, `app/index.tsx`) | **Mobile-only** | **Freshly verified** — `:450-515`, `:654-665` |
| `executeDraft` recipient resolution | **Voice** (`naavi-voice-server`) | **Voice-only** | **Freshly verified** — `:13949-13998`, both branches, identical tree |

**Duplication status.** Recipient resolution for an immediate message is **duplicated**: mobile
resolves in the card before send, voice resolves inside `executeDraft` after consent. They share the
Edge Function and share nothing else — different timing, different failure surface, different
readback. Consistent with §2b's finding that recipient resolution is **not** unified.

**Protected Core: YES.** Action Rules (recipient resolution) and Notification routing, per Governance
§4. `app/index.tsx` is **not** named in Architecture Reference §4's file list — and that does not
exempt it, per Wael's B9m ruling of 2026-08-31: *"§4 is a list of files, and a list of files cannot
capture consequence."* The consequence here is a real message to a real third party. **Full Phase
1–8.**

---

## 7. Alternatives considered as explanations, and ruled out

| Candidate explanation | Ruled out by |
|---|---|
| A weak match outranked an existing self-fallback (Phase 0's cheaper hypothesis) | **Ruled out.** The self-default exists on `SET_ACTION_RULE` only (`:709`, `:1135`). `DRAFT_MESSAGE` has none. Nothing was outranked. |
| `useOrchestrator.ts:2125`'s *"no 'me'/'myself' check exists here"* comment marks this hole | **Ruled out.** That comment sits on the **phone-number** lookup branch (`lookupContactByPhone`, `:2119-2128`), a B9g self-override diagnostic. Different path from a name query. *(The holding-list row also dates it "thirteen months before it bit" — the comment is July 2026 and the defect surfaced August 2026, one month.)* |
| Google's non-deterministic search cache (the B9m mechanism) | **Ruled out for this item.** Two measurements eleven days apart returned the identical top hit and identical count. This is deterministic substring matching, not cache variance. |
| The exact-first-name filter would catch it once tuned | **Ruled out as an explanation.** It is not failing — it is correctly finding zero exact matches and correctly declining to narrow. §2 above. |

---

## 8. What is NOT proven

Stated explicitly, per the No Assumptions Rule.

1. **Whether mobile emits the draft reliably.** Now **two** user-facing observations — the
   2026-08-21 card, and Wael's reproduction on 2026-09-01 with both test phrases, both failing.
   **Still one short of the Non-Determinism Rule's three-trial bar**, so the routing is well
   evidenced but not yet formally established. *(Was "one observation" when drafted.)*
2. **What the card shows when the matched contact has no phone.** `:498` sets `resolvedContact` only
   `if (contact?.phone)`, so the parenthetical would be absent and the card would read a bare
   `To: me` — untested.
3. **Whether any other action type reads `action.to` for display the same way.** Not searched; out of
   this item's scope.

> **✅ Removed from this list 2026-09-01, on Wael's Phase 1 review — item 1 was *"whether voice emits
> `DRAFT_MESSAGE` for 'text me'. Needs a live call."*** **The live call was run and §4 answers it: voice
> emitted zero actions and asked who to send to.** Leaving it here made this document contradict its
> own §4 — the reviewer caught it, not the author. **Voice behaviour for *"text me"* is proven
> unaffected for B11l and is out of scope.** See §4 and the revised Phase 0.

---

## 9. Carried from Phase 0 — **both ruled, nothing open**

> **⚠️ This section was headed "Open from Phase 0, still unruled" and listed two items as awaiting a
> decision. Wael ruled on both on 2026-09-01, after this section was written. It was false from that
> moment until this correction, and nothing would have caught it** — the holding-list gate checks
> that a line exists and is short, not that it is still true, and no gate reads a phase document at
> all. Found only because Wael asked whether this document predated the revised Phase 0. **It did, by
> 21 minutes.**

1. **Phase 0's Approval block** — *"Phase 1 investigation authorised."* Raised as now-false after
   Wael ruled the Phase 0→1 gate had not been given by that message. **RULED 2026-09-01: leave as
   written.** No edit made. Closed.
2. **Phase 0 lines 53 and 57** — *"B is the one that made A dangerous"*, *"B also generalises and A
   does not"* — asserted the defects' relationship that the approved scope sentence reserved for
   Phase 1 to determine. **RULED 2026-09-01: add a correction note, original text left visible.**
   Applied. The note records that **"A does not generalise" is false** — four of six pronouns collide
   (§5) — and that the relationship claim above it stands, since §3 finds independent root causes
   while B is still what made A invisible. Closed.

**Nothing from Phase 0 is open.**
