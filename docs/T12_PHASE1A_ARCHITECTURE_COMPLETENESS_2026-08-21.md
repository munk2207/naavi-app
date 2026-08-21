# T12 — Phase 1A: Architecture Completeness Review

**Work item:** [[T12]] — Voice environment equilibrium
**Date:** 2026-08-21
**Scope:** VOICE ONLY (Phase 0, approved)
**Architecture Reference version used for this review:** **2026.07.18.8** (per its own version block,
line 3). Recorded here per Phase 1A's Version Verification requirement; Phase 8 must confirm no newer
version superseded it.
**Status:** awaiting Wael's review. **No code written. No deploys performed.**

---

## The controlling question this review serves

> **What prevents Voice Staging from being a functional replica of Voice Production at the starting
> equilibrium?**

Phase 1 answered it and concluded **YES**, achievable. **Phase 1A's only job is to ask whether that
answer is complete with respect to the Architecture Reference** — not whether it is internally
consistent, which Phase 1 already established. The specific risk this phase exists to catch: an
implementation somewhere that Phase 1 never looked at, which would make "equal" false even after all
four obstacles are cleared.

**Verdict: PASS, with three findings that must be carried into Phase 2 and two Architecture Reference
corrections owed at Phase 8.** Details below.

---

## 1. The six mandatory questions

**Q1 — What is the architectural owner of the affected capability?**

**Shared Core** — `munk2207/naavi-app/supabase/functions/*`, per Architecture Reference §0a's
Ownership Model (line 55). *Freshly verified this session — evidence: no `supabase/functions/`
directory exists anywhere under `naavi-voice-server/`; the 32 functions have exactly one source
location.*

**A distinction this work item forces, which §0a does not currently cover:** T12's subject is not a
capability, it is **the deployment relationship between two instances of Shared Core**. Shared Core
owns the code. **Nothing owns the equality of its two deployments** — that is precisely the gap, and
it is why no existing owner caught it. Recorded here because "who owns this?" having no answer is,
per §0a's own words, *"itself a defect to resolve, not a reason to skip verification."*

**Q2 — Is the capability Shared Core, Duplicated, or Platform-specific?**

**Shared Core, and Protected Core.** The 32 functions include Notification routing (`send-sms`,
`send-push-notification`, `send-user-email`), Calendar integration, Gmail integration and API
contracts — four of the twelve areas Governance §4 names.

**Q3 — If duplicated, were all documented implementations investigated?**

**Not duplicated.** The two Supabase projects are two *deployments* of one implementation, not two
implementations. *Freshly verified this session — evidence: `supabase functions download` from both
projects produced files that are byte-identical for 15 of 20 slugs and differ only by an additive
guard block for 4 more, which is inconsistent with independent implementations.*

**Q4 — If not, which implementations were investigated and which were not?**

See §2 — the Cross-Repository Verification Rule table. All three surfaces checked.

**Q5 — Does the documented problem scope match the Architecture Reference?**

**Yes, and the Reference anticipated it.** §0c (line 155): *"It compares schema, not data, and not
Edge Function code. A function deployed to one project and not the other is invisible to it."* §0d
(line 211): *"Nothing compares deployed Edge Function code between projects. T4 recorded this as a
known weakness; this is the first time it bit."*

**T12 is the work item that closes a gap the Architecture Reference had already named and left
open.** That is the strongest possible scope match — the problem was documented before the item
existed.

**Q6 — Is any documented implementation excluded from the investigation?**

**One, deliberately: mobile.** Excluded by Wael's explicit Phase 0 decision. **It is not an
unexamined exclusion** — mobile was measured before being excluded (42 functions referenced, 29
flagged), and mobile remains a regression surface in Phase 2 because 18 of the flagged slugs are
also called by it. *Freshly verified this session — evidence: strict slug match against `app/`,
`hooks/`, `lib/`, `components/`.*

---

## 2. Architecture Scope Rule / Cross-Repository Verification

Every bullet tagged per the Verification Provenance Rule.

### 2a. Does equivalent outbound-guard logic exist outside Shared Core?

| Surface | Result | Provenance |
|---|---|---|
| **Voice server** | **None.** No allowlist, no guard, no local containment logic. | **Freshly verified this session** — `grep -rniE "allowlist\|allow_list\|guardDestination\|outbound_guard" naavi-voice-server/src` returns **zero matches** |
| **Mobile** | **None.** | **Freshly verified this session** — same pattern over `app/ hooks/ lib/ components/`, zero matches |
| **Shared Core** | Single implementation, `supabase/functions/_shared/outbound_guard.ts` | **Freshly verified this session** — read in full, 161 lines |

**Conclusion: no duplication.** Deploying the guard to production cannot conflict with a second
implementation, because there is no second implementation. **This is the single most important
negative result in this phase** — had a voice-side guard existed, deploying the Shared Core one to
production could have produced two interacting containment rules on the production line.

### 2b. Are there send paths the Shared Core guard cannot see?

**Yes — one, and it is voice-server-side.** *Freshly verified this session — evidence:*
`grep -rn "api.twilio.com" naavi-voice-server/src` returns four call sites. Three are Recordings /
Calls management (`:5441`, `:5464`, `:5492`) and send nothing. **One is a direct message send:
`naavi-voice-server/src/index.js:7624`** — the F2b demo recap SMS, posting to Twilio's
`Messages.json` without passing through Shared Core.

**Why it does not block T12:** it is voice-server code, identical on both branches, and T12 deploys
Edge Functions only. It is unreachable on staging because `STAGING_DEMO_TWILIO_NUMBER` is unset on
the `naavi-voice-staging` service — the invariant Architecture Reference §0b already records.

**Why it is recorded anyway:** §0b states the guard *"sits in Shared Core on every send path."* That
is not exactly true, and Phase 1 found a second counterexample — `ingest-ticket` was outside the
guard until 2026-08-20. **Two known exceptions to a stated invariant means the invariant is a
description, not a guarantee.** See §4.

### 2c. Which surfaces call the five functions T12 would deploy?

*Freshly verified this session — strict slug match against each surface.*

| Function | Voice | Mobile | Other Shared Core |
|---|---|---|---|
| `send-sms` | yes | yes | 8 Class A callers (per T2 Phase 1A §3) |
| `send-push-notification` | yes | yes | dispatchers |
| `ingest-ticket` | yes | yes | — |
| `send-user-email` | yes | **no** | `global-search/adapters/contacts.ts`, `ingest-ticket`, `send-ticket-reply`, `_shared/task_actions.ts`, three dispatchers |
| `receive-demo-sms-reply` | yes (`index.js:7762`) | no | — |

**Mobile is reachable by three of the five.** Since Phase 0 excludes mobile as a target but not as a
regression surface, Phase 2's Regression Matrix must trace those three. **The full consumer trace is
Phase 2's obligation, not this phase's** — what Phase 1A establishes is that no consumer sits on an
implementation nobody looked at.

---

## 3. Three findings that change Phase 2's plan

### 3.1 — The four guard deploys are additive-only. Zero removals.

*Freshly verified this session — full `diff -r` of each production-deployed copy against repo source:*

| Function | Changed lines | **Removals** |
|---|---|---|
| `send-sms` | 20 | **0** |
| `send-user-email` | 16 | **0** |
| `send-push-notification` | 32 | **0** |
| `ingest-ticket` | 24 | **0** |

Every changed line is an addition, and every addition is the guard import plus one guard block.
**Nothing else in these four functions differs between production and the repo.** This bounds the
regression surface far more tightly than Phase 0 assumed.

### 3.2 — ⚠ `send-push-notification` is NOT fully inert on production

**This corrects a claim in Phase 1 §2 and in the T12 commit message.** "Inert" is accurate about the
*outcome* and inaccurate about *execution*.

`supabase/functions/send-push-notification/index.ts:198-218` — the guard block opens with an
**unconditional** database read:

```
const { data: idn } = await adminClient
  .from('user_settings')
  .select('phone, email')
  .eq('user_id', userId)
  .maybeSingle();
```

It runs before any `enforced` check. On production `guardDestination` returns `enforced: false` and
nothing is blocked — **but the `user_settings` round-trip executes on every production push send.**

The other three are genuinely inert: `guardDestination` is a pure function over an environment
variable, called with values already in hand.

**Assessment: acceptable, but it must be a decision rather than a discovery.** One indexed
single-row read on a path that already performs several. Not user-visible. **Phase 2 must state it
explicitly and Phase 6 must be able to audit that it was known** — the alternative, moving the query
inside an `enforced` check, is a source change and Phase 0 forbids those.

### 3.3 — After T12, staging's containment rests on one secret and nothing gates it

Today production is protected two ways at once: it lacks the guard code **and** it lacks the secret.
After T12 it is protected one way — it lacks the secret. That is the design's own stated model
(`outbound_guard.ts:20-24`, Architecture Reference §0b), so it is not a regression.

**But it converts a structural property into a configuration invariant: `OUTBOUND_ALLOWLIST` must
never be set on the production project.** Nothing currently checks that. Per the lesson recorded in
`MEMORY.md` — *"Make it refuse, don't make it warn"* — Phase 2 should consider gating the invariant
alongside the equilibrium gate it is already building.

---

## 4. Architecture Reference corrections owed (Phase 8 preconditions)

Per Governance Phase 8, an approved architectural change must update the Reference in the same work
item. Two inaccuracies were found while performing this review — **neither caused by T12, both owed
by it** since T12 is the item that touched this ground.

**4.1 — §0b's stale line reference.** It cites the voice server's direct-to-Twilio SMS path as
`naavi-voice-server/src/index.js:7224`. *Freshly verified — the path is at `:7624`.* A line number
that no longer resolves is how §0d says an architecture document goes stale.

**4.2 — §0b overstates the guard's coverage.** *"An allowlist guard sits in Shared Core on every send
path"* has two known exceptions: the direct Twilio path at `:7624`, and `ingest-ticket`, which was
outside the guard until 2026-08-20 despite the claim predating that. **Recommended rewording: the
guard covers every Shared Core send path, with the voice server's direct Twilio path contained
instead by an unset environment variable.**

**4.3 — What T12 itself will change, when Phase 2 lands.** §0d currently states *"Nothing compares
deployed Edge Function code between projects."* Phase 2 builds exactly that. §0c's list of what the
drift check cannot see will also need amending. **These are Phase 8 updates, not Phase 1A findings**
— recorded now so they are not rediscovered.

---

## 5. Independent Review Rule

Governance Phase 1A requires two independent reviews, and states that passing one does not imply
passing the other.

| Review | Verdict |
|---|---|
| Technical Investigation (Phase 1) | Approved by Wael, 2026-08-21, Path B |
| **Architecture Completeness (this document)** | **PASS** |

**Basis for PASS:** the owner is unambiguous, the capability is not duplicated, all three surfaces
were freshly checked rather than cited, the one deliberate exclusion was measured before being
excluded, the problem scope matches a gap the Architecture Reference had already documented, and no
implementation was found that Phase 1 failed to investigate.

**What would have made this FAIL, so the verdict is falsifiable:** a second guard implementation in
the voice server or mobile. §2a checked for exactly that and found zero matches on both.

**Known limitation, per Governance's own note on this phase:** ChatGPT has no codebase access and
reviews only what is presented here. The provenance tags above make each claim checkable by
inspection, but they cannot prove the greps were run. The compensating mechanism is the Architecture
Audit Trigger (§5), not this document.

---

## 6. Nothing requiring a decision in this phase

No new decisions. Phase 1's Path B stands. §3.2 and §3.3 are inputs Phase 2 must carry, not choices
to make now.

---

## Required output

Confirm the Architecture Completeness PASS. Per Governance §3's Phase-Gate Approval Rule, Phase 2
does not begin — including drafting the Phase 2 change plan — until Wael's own separate go-ahead.
