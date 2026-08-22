# T12 — The equilibrium test, as run by Wael

**Date:** 2026-08-21
**Designed by:** Wael. **Run by:** Wael, on a phone. **Recorded by:** Claude.

---

## Why this test exists

`parity:verify` proved the two environments run **identical Edge Function code** — 32/32. It cannot
prove they **behave** the same, because behaviour also depends on data, tokens and configuration.
Code identity makes behavioural identity likely; it does not establish it.

**Wael's requirement, stated at Phase 0 and never relaxed:**

> Two environments only have value if you can start from a state where they are equal. Change
> staging, test, promote, return to equal. If you cannot start from equilibrium, staging is not a
> rehearsal of production — it is a second system, and *"validated on staging"* means nothing about
> production.

**A discarded design, recorded because discarding it was correct.** The first proposal was to
introduce a deliberate bug on production and show staging surviving. Wael rejected his own idea:
*"this is not proving anything, this same test will be valid even if we have two different
platforms."* He is right — that measures **isolation**, and two entirely unrelated systems are also
isolated. Equilibrium is the forward direction: does staging **predict** production?

**So the test is a prediction, made in advance, then checked.** The vehicle is a real defect
([[B11j]] — voice ADD_CONTACT sends no `user_id`), not an artificial bug.

---

## Step 1 — the equal starting state, verified by ear

Wael called both lines and asked each to add a contact. **Both failed.** Equal starting point,
confirmed by the person, not by an API.

## Step 2 — fix deployed to staging ONLY

`04a61f2` on the voice server's `staging` branch: `ADD_CONTACT` now resolves the caller's id and
sends it. `main` untouched, production untouched. `npm test` 133/133.

## Step 3 — both lines called again

| | Result |
|---|---|
| **Staging** | `{ success: true, resourceName: 'people/c2404130318715850079' }` — **contact created** |
| **Production** | `{ error: 'No user found — provide JWT or user_id in body' }` — **nothing created** |

**⚠ And the step nearly failed for a reason that had nothing to do with equilibrium.** Wael reported
*"it worked on both platforms."* It had not. Production said *"I'll add that contact right away"* and
then silently failed, because voice actions execute **after** the speech is dispatched. **The user
surface could not distinguish success from failure.** Opened as [[B11k]].

**What settled it was in Wael's own screenshot, not in a log:** the created contact carries phone
**12345**, which is what staging was told. Production was told **1234**. No contact with 1234 exists.
The digits are the discriminator, and they are visible to him without trusting anything Claude read.

**Step 3 therefore stands as a pass, on evidence Wael can check himself.**

---

## ⭐ Step 4 — the prediction, recorded BEFORE promotion

**This document is committed before the promotion commit exists.** That ordering is the point: a
prediction written afterwards can be fitted to any result.

**Wael, 2026-08-21, verbatim:**

> *"After promotion, I'll call production, dictate a contact, and it will be created in Google
> Contacts with the digits I gave — the same as staging did."*

**What makes this a good prediction, and worth noting for future tests:** the pass condition is a
**contact bearing the exact digits dictated**, not what Naavi says. Step 3 proved her wording cannot
be trusted as a signal. This criterion is immune to [[B11k]].

**Pass:** a contact appears in Google Contacts with the dictated digits.
**Fail:** no contact, or a contact whose digits do not match what was dictated.

---

## Step 5 — promotion to production

*To be filled in when performed.*

## Step 6 — Wael calls production

*To be filled in with the result.*

---

## What a pass would and would not establish

**Would:** that a change validated on staging behaved the same way on production after promotion —
staging predicted production, for this change, through the full loop.

**Would not:** that staging predicts production for *every* change. One instance is one instance.
What it establishes is that the loop **can** close, which had never been demonstrated before today —
and that is the claim Phase 0 was written to test.

**Also worth stating:** the voice server repo is deliberately **out** of equilibrium between steps 2
and 5, `staging` ahead of `main`. That is the middle of the loop, not a defect, and it is the first
time this system has been in that state knowingly rather than by accident.
