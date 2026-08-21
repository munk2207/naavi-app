# T12 — Phase 0: Intent Approval

**Work item:** [[T12]] — Voice environment equilibrium: staging can be developed, tested, and ported to production
**Date:** 2026-08-21
**Scope:** **VOICE ONLY** — settled by Wael, 2026-08-21. See Out of Scope.
**Governance:** Full Phase 1–8 (Protected Core — Voice orchestration, API contracts, Notification routing)
**Risk:** HIGH
**Status:** **APPROVED WITH MANDATORY CHANGES** — Wael, 2026-08-21.

> Mandatory change, as given: shorten the Mobile discussion in Out of Scope; keep only the
> constraint that shared Edge Functions affected by T12 must be regression-tested so voice changes
> do not break existing consumers. Applied. Nothing else was changed under this authorization.

**This approval covers Phase 0 only.** Per governance §3's Phase-Gate Approval Rule, Phase 1 does
not begin — including drafting the Phase 1 document — until Wael gives his own separate word for
that transition.

---

## Why this Phase 0 exists

Wael's principle, in his own words, recorded here as the governing definition:

> Two environments only have value if you can start from a state where they are equal. Change
> staging, test, promote, return to equal. If you cannot start from equilibrium, staging is not a
> rehearsal of production — it is a second system, and *"validated on staging"* means nothing about
> production.

**The measurement that shows voice is not there.** Edge Functions referenced by
`naavi-voice-server/src`, compared between the two Supabase projects by deployed content hash
(`ezbr_sha256` from `supabase functions list`), measured 2026-08-21:

| | |
|---|---|
| Edge Functions the voice server calls | **39** |
| identical deployed content | 14 |
| **different deployed content** | **24** |
| present only on staging | 1 (`receive-demo-sms-reply`) |
| present only on production | 0 |

**The 24:** `assistant-fulfillment`, `create-calendar-event`, `create-contact`,
`delete-calendar-event`, `evaluate-rules`, `fetch-calendar-pdf`, `get-travel-time`, `ingest-note`,
`ingest-ticket`, `list-contact-names`, `manage-list`, `naavi-spend-summary`, `resolve-entity-ref`,
`resolve-place`, `save-hosted-reply`, `save-to-drive`, `search-google-drive`, `search-knowledge`,
`send-email`, `send-push-notification`, `send-sms`, `send-user-email`, `sync-gmail`,
`trigger-morning-call`.

**Bidirectional — neither side is a superset.** Production is ahead on `create-calendar-event`
(2026-08-10 vs staging 2026-08-05) and `ingest-note` (2026-08-13 vs 2026-07-03). Staging is ahead on
most of the rest. A one-directional sweep in either direction would be a regression.

**Measurement discrepancy, recorded rather than reconciled silently.** The 2026-08-21 session handoff
states 32 called / 11 identical / 20 different / 1 missing. This document's measurement gives 39 /
14 / 24 / 1, using a strict slug match (the slug not followed by another `[a-z0-9-]` character)
against `naavi-voice-server/src`; including `test/` changes nothing. **Phase 1 must resolve which is
right**, and must confirm each of the 39 is a genuine call site rather than a slug appearing in a
comment or a string that is never invoked.

**Why voice promotion never restored equilibrium.** Promoting voice means merging `staging` → `main`
and letting Railway deploy. That moves the voice server's own code — and today `src/` and `test/`
are byte-identical on both branches, so that half works. It moves **none** of the 24 Edge Functions,
because Edge Functions are not in that repo and have no promotion step of any kind. Every voice
promotion to date has delivered the voice half of a change and left the Shared Core half behind.

**A live production defect this has already caused, found while measuring.** Production
`search-knowledge` is v56, deployed **2026-04-29 at 8:57:04 PM EST**. Commit `22ca8f1`
(*"multi-user safety: remove user_tokens fallback from 4 Edge Functions"*) landed **2026-04-29 at
9:02:39 PM EST** — five minutes and thirty-five seconds later, and it has not been redeployed since.
Production therefore still runs the `user_tokens` "first-google-user" fallback that CLAUDE.md Rule 4
forbids: an unauthenticated caller is bound to whoever is first in `user_tokens`. The other three
functions in that commit were redeployed 2026-08-13 and are clean. `search-knowledge` is one of
the 24.

---

## User Intent

Make voice staging a true rehearsal of voice production: the two environments equal except for
differences that are deliberate and recorded, with that state maintained mechanically rather than
rediscovered periodically. Once reached, a change developed and tested on voice staging can be
ported to voice production in full — both its voice half and its Shared Core half.

---

## Success Criteria

1. **Equal.** Every Edge Function the voice server calls is either identical across both projects, or
   listed in an explicit baseline with a written reason it must differ.
2. **Portable.** A documented promotion procedure exists that moves a voice change's Edge Function
   half together with its `staging` → `main` merge — so promotion cannot silently deliver only part
   of a change.
3. **Enforced.** A gate bound to `.githooks/pre-push` fails closed when new divergence appears
   outside the baseline. Per the T4 precedent: a check that must be remembered is a ritual, not a
   gate.

---

## In Scope

- Classifying the 24 differing slugs and the 1 staging-only slug by **direction and reason** — which
  side is correct, and why — before anything is deployed.
- Confirming the voice boundary itself: that all 39 are real call sites, and resolving the
  discrepancy with the handoff's 32.
- Bringing both projects to equilibrium across that boundary, once the classification is reviewed.
- The equilibrium gate and its baseline file.
- The promotion procedure, documented in the Architecture Reference.
- The auto-tester coverage Rule 15a requires for the gate.

## Out of Scope

- **Mobile — excluded by Wael's explicit decision, 2026-08-21.** Mobile parity is not investigated,
  measured, or addressed by this work item.

  **The one constraint that survives the exclusion:** 18 of the 24 slugs in scope have consumers
  beyond voice. **Shared Edge Functions moved by T12 must be regression-tested against their
  existing consumers**, per Rule 0.5 and Phase 2's Regression Matrix. That is a regression
  requirement on this work item — not an opening to investigate parity on another platform.

- **Any change to Edge Function source code.** This item deploys existing code; it does not modify
  it. If a function's source is wrong, that is a separate work item.
- Database schema parity — that was T4, closed, and it has its own drift check.
- The schema/code defects in [[T10]] and the outbound-SMS finding in [[T11]].
- **The voice staging cancellation decision.** Explicitly deferred: this item establishes whether
  equilibrium is achievable and at what cost, which is the information that decision needs.
- The voice server's own branch promotion (`staging` → `main`). That already works.
- Fixing `search-knowledge`'s multi-user defect as a separate action. It is fixed **as a
  consequence** of reaching equilibrium, not by a code change.

## Constraints

- **This item deploys to production by definition.** The staging-first rule cannot apply in its usual
  direction. Every production deploy requires Wael's own explicit approval, per CLAUDE.md
  Staging-First rule 7.
- **Three functions must never be promoted to production:** `send-sms`, `send-user-email`,
  `send-push-notification`. All three are in the 24. They differ only by the T2 outbound containment
  guard, which is staging-only by design and stops staging texting and emailing real people. These
  become permanent baseline entries with that reason recorded.
- **No source changes**, per Out of Scope.
- **Protected Core.** External review mandatory at Phase 3 and Phase 6.
- The existing drift check and schema/code gate must stay green and must not be weakened.

## Completion Criteria

1. Every slug on the voice boundary matches across both projects, or appears in the baseline with a
   stated reason.
2. The gate is bound to the pre-push hook and **verified in both directions** — green at the
   baseline, and exit non-zero with the push refused when a divergence is introduced. The same
   two-direction verification T4's drift check was held to.
3. The promotion procedure is written into the Architecture Reference in this same work item, per
   governance Phase 8.
4. `npm run test:auto` green against a confirmed environment, and voice regression green.
5. Wael confirms on a live production call that nothing regressed.

---

## The central risk, stated plainly

**Reaching equilibrium is more dangerous than being out of it.** Twenty-four functions differ. If
equilibrium is reached by deploying staging's copy over production's, that ships 24 functions' worth
of change to production in one movement — including code that has never run against production data,
production's Google tokens, or production's users. Production is ahead on two of them, so a blind
staging-wins sweep would be a regression, not a promotion. And 18 of the 24 are shared with mobile,
which is out of scope as a target but is fully exposed as a blast radius.

Phase 1 must establish, per slug, which side is correct and why. Phase 2 must propose an order and a
rollback. **Phase 0 deliberately does not prescribe the mechanism** — including the obvious
candidate, deploying the current `main` source to both projects so neither side "wins." That is a
Phase 2 decision, not an intent.

**Given this session's record, one further constraint on how Phase 1 reports:** every per-slug
classification must cite the evidence that produced it — a diff, a deploy timestamp, a commit — not
a judgement about which side looks newer. A hash difference proves the deployed bundles differ. It
does not prove the source differs: during T4, six differences chased turned out to be formatting or
tooling artifacts, and three of the voice slugs were the same source deployed on different dates.
**24 is an upper bound on real drift, not a defect count**, and Phase 1's first job is to find out
what the real number is.

---

## Required output

Approve, approve with changes, or reject. Per governance §3's Phase-Gate Approval Rule, no work
begins — including drafting Phase 1 — until Wael's own explicit go-ahead.
