# T12 — Phase 7: Testing Record

**Work item:** [[T12]] — Voice environment equilibrium
**Date:** 2026-08-21
**Status:** **INCOMPLETE — automated half green, live checks not run.** Phase 7 cannot close, and
Phase 6's approval was explicitly conditional on it.

---

## 1. Automated — GREEN on staging

**Final run, 2026-08-21, banner-confirmed `Testing against: STAGING (xugvnfudofuskxoknhve)`:**

```
Naavi Auto-Tester — 528 tests
✓ 522 passed   ✗ 0 failed   ⨯ 0 errored   ⧗ 1 timed out   ○ 5 skipped
Duration: 456.6s
```

**All six T12 tests pass**, including the T0 gate, which was correctly red before `create-contact`
was repaired:

```
t12.create-contact.service-role-body-userid-resolves … PASS
t12.boundary.excludes-comment-only-mentions          … PASS   (voice platform, Gate 2)
t12.parity-check.declares-itself-not-proof           … PASS
t12.parity-gate.wired-into-pre-push                  … PASS
t12.deploy-wrapper.refuses-uncommitted-source        … PASS
t12.parity.normalization-ignores-formatting          … PASS
```

**The 1 timeout is not a defect.** Two runs produced timeouts in *different* prompt-regression tests
(`chain-store-tim-hortons`, then `b6d-display-uses-numbers-not-bullets`), both at the 30s cap. That
pattern is LLM latency, not a broken assertion.

**The 5 skips are environmental** — the test account has no qualifying calendar event and no contact
with a birthday on file. Each skip states its own reason and its coverage gap.

### 1a. Three runs, and what changed between them

| Run | Result | Cause of the non-green |
|---|---|---|
| 1 | 520 pass / 2 error / 1 timeout | one real defect (T0 gate), one defect in a T12 test |
| 2 | 507 pass / 8 error | **all eight** downstream of one expired Google token |
| 3 | **522 pass / 0 error** | — |

**Between runs 1 and 3 two things were fixed** — `create-contact` was repaired on both environments
(turning the T0 gate green legitimately, not by weakening it), and a defective assertion of mine was
corrected. **Neither fix touched a test to make it pass.**

### 1b. The token incident, and the three ways I mischaracterised it

Run 2's eight errors all traced to `invalid_grant — Token has been expired or revoked`. Recorded
because the misreadings are more instructive than the incident:

1. **I reported it as "staging's token expired."** It was **production's** stored token. Staging's
   worked, verified by direct probe.
2. **I framed it as an environment-parity hazard** — two projects sharing one OAuth client, so
   authorising on one could revoke the other. **Wael's correction:** Google authorises an *account*.
   If a credential is used in a hundred places and access is revoked, everything stops. That is
   ordinary OAuth, not an architectural finding, and writing it up would document the obvious as a
   discovery.
3. **I said "the account's Google connection is dead."** The account is fine and proved it — staging
   authenticated as `mynaavi2207@gmail.com` against Google and returned a real contact. What is
   rejected is **one stale row** in production's `user_tokens`, last written 11 August, while
   staging's row for the same account was rewritten the same evening.

**And the deeper correction, also Wael's:** probing both environments never tested the account at
all. One successful call anywhere answers "is the account authorised?" Testing the second only
reports which stored copy is current — bookkeeping. With a hundred environments it would be a
hundred copies of the same answer.

**The pattern in all three: an account-level fact given an environment-shaped meaning it does not
have.** Same error as reading a duplicate phone-number row as a test hazard on a number that has
worked across ten videos.

**What actually follows, and it is one line:** production's `user_tokens` row for
`mynaavi2207@gmail.com` needs a fresh token before **Gate 1 can be run against production**. That is
a prerequisite for a production AAB. It is not a defect and needs no item.

---

## 2. Live checks — the part Phase 7 exists for

**None of these has been run.** Boot checks proved the deployed functions *load*; they do not prove a
real send completes, and Phase 6 approved on that condition.

| # | Check | Verifies | Status |
|---|---|---|---|
| 1 | **Voice call → SMS alert, both lines** | `send-sms` guard genuinely inert on production | **DONE** — both delivered; staging sent from its own number, the deliberate caller-ID divergence |
| 2 | **Production call → add a contact** | the promoted B11j fix; step 6 of the equilibrium test | **NOT RUN** |
| 3 | **Demo line "stop"** (1-888-916-2284) | D4 — `receive-demo-sms-reply`, which was a 404 on production | **NOT RUN** |
| 4 | **A push notification** | D3's added `user_settings` read did not break delivery | **NOT RUN** |
| 5 | **Mobile regression pass** | mobile calls three functions redeployed today | **NOT RUN** |

**Check 3 has a real consequence to state before it is run:** it now writes a genuine `demo_optouts`
row for the calling number, because D4 fixed the path that previously wrote nothing. Before D4 the
promise *"you won't hear from us again"* was false; now it is true.

---

## 3. What Phase 7 has already produced that was not on its list

Both found by Wael on a phone, neither by any automated gate:

- **[[B11k]]** — Naavi reports success for actions that failed. Voice executes actions *after*
  dispatching speech, so the outcome cannot reach the caller. Twelve state-changing actions are
  exposed, including `DELETE_EVENT` and `DELETE_MEMORY`. **Mobile is unaffected and fixed this in
  V57.8** — the same defect, solved on one surface and never mirrored.
- **[[B11j]] confirmed and closed by promotion** — voice ADD_CONTACT sent no `user_id`. Fixed on
  staging, validated, promoted.

**This is the pattern worth carrying:** 528 automated tests, three gates and two external reviews
passed over both. A person dictating a contact into a phone found them in an afternoon.

---

## 4. Condition for Phase 7 to close

Checks 2–5 run, with results recorded here. **Check 2 in particular is judged against the prediction
recorded in `c3d6b5e` before the promotion existed** — a contact bearing the exact digits dictated,
not what Naavi says.

Phase 8 remains blocked on the Architecture Reference updates the Phase 6 review made a hard merge
precondition.
