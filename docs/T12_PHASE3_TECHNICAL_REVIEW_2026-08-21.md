# T12 — Phase 3: Technical Review Record (Before Coding)

**Work item:** [[T12]] — Voice environment equilibrium
**Date:** 2026-08-21
**Reviewer:** ChatGPT (External Technical Reviewer, Governance §1)
**Prompt submitted:** `docs/T12_PHASE3_REVIEW_PROMPT_2026-08-21.md`

## Decision

# Approved with Mandatory Changes

Per Governance §13: **only the listed mandatory changes may be performed; nothing else.**

---

## Mandatory Change 1 — T0 is a hard gate before ANY deployment

**Reviewer:** *"4.1 / T0 must be a hard gate before any deployment. Establish `create-contact`
behavior first. D1 cannot proceed without a conclusive result."*

**Status: APPLIED** — Phase 2 §7, new gate block.

**What changed.** The submitted plan gated only **D1** on T0, and allowed D2, D3 and D4 to run
first. **All four deploys are now blocked until T0 returns a conclusive result.**

**Why the reviewer was right, recorded because the original ordering looked reasonable.** T0 asks
whether a service-role caller resolves a user against committed `HEAD`. If the answer is no,
ADD_CONTACT is already broken on production — which falsifies the assumption that *"production ==
`HEAD` is a healthy baseline."* That assumption is load-bearing for **every** deploy in the plan, not
just D1. Running D2–D4 first would have built equilibrium on a baseline not yet known to be sound.

**"Conclusive" is now defined in the plan:** the service-role + body-`user_id` case exercised against
the project running `HEAD`, with status and body recorded in the Phase 5 evidence package. Reading
the code is not conclusive.

---

## Mandatory Change 2 — the manifest is never proof of equilibrium

**Reviewer:** *"The manifest cannot itself be called proof of equilibrium. `parity:verify`, which
downloads and compares actual deployed source, is the authoritative evidence. T8 must pass before T12
can claim Voice Staging = Voice Production."*

**Status: APPLIED** — Phase 2 §4b, new binding block.

**Four consequences now written into the plan:**

1. `parity:check` is a **tripwire, not evidence**. It may catch divergence; it may never be cited as
   demonstrating equality.
2. `parity:verify` is the **only authoritative source**, and its result rewrites the manifest from
   reality rather than trusting it.
3. **T12 may not claim Voice Staging = Voice Production on any basis other than a passing
   `parity:verify` at T8** — not the manifest, not the deploy log, not this plan having been
   followed.
4. **The tooling must enforce this, not rely on discipline:** `parity:check`'s own output must state
   that it is not proof of equilibrium and name `parity:verify` as the authority.

**Why this matters beyond T12:** the project has produced a confidently wrong parity comparison three
times — `ezbr_sha256` (15 false positives of 20), raw-hashed function bodies (one space made
identical functions differ), and truncated cron commands. **A trusted-but-unverified manifest would
have been the fourth.**

---

## Non-blocking findings — reviewer's explicit rulings

| Issue raised (prompt §4) | Reviewer's ruling |
|---|---|
| 4.3 dirty-tree enforcement without CI | **Acceptable within current scope** |
| 4.4 `send-sms`'s ten consumers | **Targeted regression coverage, not exhaustive per-consumer tests** |
| 4.5 rollback by redeploying prior source | **Acceptable** |
| 4.6 `send-push-notification` DB read | **Decision stands unless Phase 5 shows material impact** |

Note on 4.6: this preserves Wael's Phase 1A instruction and Phase 2 §3 — Phase 5 must still measure
push latency before and after. The ruling is that the *decision* stands, not that the measurement is
waived.

---

## §14 Claude Implementation Handoff

- **Decision** — Approved with Mandatory Changes.
- **Mandatory Changes** — the two above. Nothing beyond them is authorized under this decision.
- **Architecture Requirements** — preserve the Voice-only equilibrium model.
- **Regression Requirements** — targeted Voice and notification paths.
- **Scope Restrictions** — no Edge Function source changes; no Mobile expansion; no CI; no expansion
  to all 82 functions.
- **Verification Checklist** — **T0 must pass. T8 authoritative parity must pass.**

## Implementation Boundaries Confirmed

- **Authorized:** only the files, tooling and deployments defined in the approved Phase 2 plan.
- **No additional files** are approved beyond those listed in Phase 2 §1.
- **No opportunistic refactoring** is approved.
- **No architectural changes** are approved beyond what Phase 2 describes.
- **Explicitly excluded:** Edge Function source modification, mobile parity work, CI introduction,
  and extending enforcement to the 50 non-voice functions.

## Deferred Architectural Decisions

Carried unchanged from the review prompt §5, none approved for this implementation: deploying Edge
Functions from CI; extending parity enforcement to all 82 functions; moving the
`send-push-notification` guard query inside the `enforced` check.

---

## ⭐ This document does NOT authorize Phase 4

Per Governance §3's Phase-Gate Approval Rule, a reviewer's verdict is one input Wael weighs — it is
never authorization to proceed. **Phase 4 does not begin, and no Phase 4 document is drafted, until
Wael gives his own separate explicit go-ahead for the Phase 3 → Phase 4 transition.**

This rule has been violated four times in this project (2026-07-15, 07-17, 08-15, 08-20). It is
restated here in the document itself for that reason.
