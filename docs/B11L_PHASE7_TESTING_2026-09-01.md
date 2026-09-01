# B11l — Phase 7: Testing

| | |
|---|---|
| **Item** | B11l — *"text me"* resolves to a stranger, and the confirmation card labels him *"me"* |
| **Date** | 2026-09-01 |
| **Governance** | `AI_DEVELOPMENT_GOVERNANCE.md` v4.3, §3 Phase 7 |
| **Build under test** | Staging APK **331** · Supabase staging `xugvnfudofuskxoknhve` |
| **Status** | Awaiting Wael's approval to proceed to Phase 8. |

---

## 1. Automated — full suite, against STAGING

**Environment read from the banner before trusting the result**, per
`feedback_verify_test_env_before_trusting_gate`.

```
Naavi Auto-Tester — 575 tests
✓ 547 passed   ✗ 0 failed   ⨯ 15 errored   ⧗ 0 timed out   ○ 13 skipped
Duration: 473.8s
```

**Zero failures. All 12 B11l tests green.**

### 1a. The 15 errors are one root cause, and it is not this change

**The staging gates account's Google token is dead.** Verified directly, not inferred:

```
lookup-contact  user ae1f3438 (mynaavi2207@, the gates account)
  -> HTTP 500  {"error":"Token refresh failed: {"error":"invalid_grant",
                "error_description":"Token has been expired or revoked."}}

lookup-contact  user f1bc46b8 (robert.esm.2207@)
  -> HTTP 200
```

**Same code, same function, same moment — one account works and one cannot reach Google
at all.**

Every errored test needs Google through that account, and they fail in two shapes:

| Shape | Tests | Mechanism |
|---|---|---|
| `lookup-contact: expected 2xx, got 500` | `session-2026-08-13` relationship-word (2), `b10w` (2), `calendar` (2), `prompt-regression` (1) | The token refresh itself fails |
| Location rule dropped — *"expected truthy, got null"* | `b10j` negative controls (6), `b10r` (2) | **B9x's recipient resolution fails closed and drops the rule**, which is the correct behaviour when a contact cannot be verified |

**The second shape is worth naming: those tests are not broken, they are observing a
safety mechanism working.** With Google unreachable, `resolveLocationRecipient` cannot
confirm who "Bob" is, so it refuses to save the alert rather than guessing. That is
precisely what B9x built and what B11l extends.

**Not caused by this change:** no file in this diff participates in OAuth token refresh,
and the identical code path returns 200 for another account on the same project.

### 1b. ⚠️ Consequence that outlives this item

**Gate 1 cannot reach 100% green on staging while that token is dead**, and CLAUDE.md
Rule 15 makes a 100% green `test:auto` a hard prerequisite for any **production AAB**.

**This does not block B11l**, which is staging-only by Phase 0. It does mean that the day
someone wants B11l — or anything else — in a production build, this must be fixed first.
**Reported, not made into an item** (Wael's ruling, 2026-09-01: no new items).

---

## 2. Manual validation — mandatory, and done on device

Governance §3 Phase 7: *"Passing automated tests alone is not sufficient."*

**All performed by Wael on build 331, on `wael.aggan@gmail.com` — the account where the
defect reproduces.** `lookup-contact "me"` returns **9 contacts with a stranger on top**
there; that is what makes these tests meaningful rather than ceremonial.

| # | Test | Result |
|---|---|---|
| 1 | *"Send a text message to me saying hi"* | Card: **`To: you (+16137697957)`** — his own number. Delivered |
| 2 | *"Email me saying help"* | Card: **`To: you (wael.aggan@gmail.com)`**, **no manual-entry prompt**. Delivered |
| 3 | *"Text Bob saying goodnight"* | Card: **`To: Bob (+13433332567)`** — **name *and* number**. Delivered |
| 4 | Send confirmation, by ear | **Naavi's voice**, not the phone's |

**Delivery confirmed at the data layer, not from the screen:**

```
6:34:17 p.m. EST  email -> wael.aggan@gmail.com   "help"
6:35:10 p.m. EST  sms   -> +13433332567           "Goodnight."
```

**Both went exactly where the card said they would. That is Phase 0's Success Criteria 1
and 2, demonstrated on the account that reproduces the bug.**

### 2a. Compound auto-send — attempted, not reached

Three device attempts, three different routes, **none of them the silent no-card send**:
a time alert; a correct card (`To: you (+16137697957)`, fix engaged on a compound
request); and one that **silently dropped the message**.

**Recorded as unreached, not as passed.** Phase 6 §4 carries it as an invalidated planning
assumption.

### 2b. Still unvalidated

| | Why it does not block |
|---|---|
| **Voice-confirm-to-send** — saying "yes" instead of tapping | Routes through the same `handleSend` verified four times by tap |
| **A contact genuinely named "Me"** | Accepted edge case, recorded at Phase 3. The card would display `To: you`, making the interpretation visible |

---

## 3. Regression check — the areas Phase 2 named

| Area | Result |
|---|---|
| Voice commands | **Unaffected** — voice never calls `naavi-chat`; no changed file is read by it |
| Geofencing · Calendar · Reminders · Onboarding | **No change.** Calendar test errors are §1a's token, not this diff |
| Gmail | **No change** |
| SMS / call alerts | **Alerts unchanged.** Draft sends differ only where `to` is a self-reference token |
| **Ordinary contacts** | **Verified twice on device** — Bob resolved and delivered, card showing name and number |
| **Relationship words** | **Not verifiable on the gates account** (§1a). Verified by source assertion — `"my wife"` is absent from the token set — and by live server call earlier in this item, which returned `to="wife"` untouched |
| Staging build | Builds 329, 330, 331 |

---

## 4. What Phase 7 establishes, and what it does not

**Establishes:** the defect no longer reproduces on the account where it reproduced; the
card names the matched contact and sends where it says; ordinary contacts are unaffected;
575 automated tests run with zero failures.

**Does not establish:** that compound auto-send is safe — it was never reached. That the
classifier reliably routes *"text me"* to a draft — that needs ≥3 trials per the
Non-Determinism Rule and only two user-facing observations exist. That the suite is
production-gate-ready — §1b.

**Recommendation to Wael: Phase 7 passes for a staging-scoped item.** Every criterion
Phase 0 set is met and demonstrated. The gaps above are named rather than absorbed.
