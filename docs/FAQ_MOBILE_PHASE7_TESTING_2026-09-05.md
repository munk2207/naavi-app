# FAQ — Mobile Stage, Phase 7: Testing

**Date:** 2026-09-05
**Item:** F25 Stage 2
**Phase 5:** approved with one open requirement — *"the six mobile scenarios still require testing on
a staging APK."* **Closed** — §2.
**Phase 7 review:** **APPROVED WITH 2 REQUIRED TESTS before production** — the signed-in identity
path, and the timeout under a deliberately slow response. **Both closed** — §3a. Wael explicitly did
not require driving the rate-limit ceiling from a device.
**Phase 6:** PASS / PASS / PASS, Approved with 2 mandatory changes.
**Environment:** **STAGING** (`xugvnfudofuskxoknhve`) throughout. **Nothing deployed to production;
no AAB built.**

---

## 1. What was tested, and on what

**Staging APK build 334** — `V57.99.5 (build 334)`, package `ca.naavi.app.staging`, installed on
Wael's Samsung. Confirmed from the Settings screen before any test ran, because a result from the
wrong build is worse than no result.

**Two builds were needed**, and the second exists because of what the first found:

| Build | Purpose | Outcome |
|---|---|---|
| **333** | First execution of the Stage 2 code | Core path worked; **Wael found the suggested question truncated** |
| **334** | The truncation fix | All scenarios passed |

**This was the first time any of this code had ever run.** Phase 5 said so plainly and it was true —
everything before this document was source assertions, a type-check, and tests of the function the
screens call.

---

## 2. Results — all seven, on a real device

| # | Scenario | Result |
|---|---|---|
| 1 | **Nothing happens while typing** | ✅ Text entered, waited **over a minute**, no panel. On build 331 a panel appeared within ~300 ms |
| 2 | **Suggestion appears on Send** | ✅ *"What is the phone number to call MyNaavi?"* — a question the old app could not offer at all |
| 3 | **The full question is readable** | ✅ Two lines, not truncated. **This is what build 334 exists for** |
| 4 | **The close button clears the panel** | ✅ Panel gone, text and severity untouched |
| 5 | **The ticket still files** | ✅ **Ticket #1163**, acknowledgement email received |
| 6 | **The deep link opens the right answer** | ✅ Opened `mynaavi.com/faq` with *"How do I delete an alert?"* expanded |
| 7 | **Contact support behaves identically** | ✅ Same panel, same flow, same deep-link behaviour |
| 8 | **No connection** | ✅ No suggestion; the form's normal network error. No offline fallback, per Q2 |

**Scenario 5 produced better evidence than was asked for.** The requirement was that the ticket
files. What arrived was the acknowledgement email — proving the whole chain end to end: app →
`ingest-ticket` → ticket row → Postmark → inbox.

---

## 3. ⚠️ What these tests did NOT prove

**The 4-second timeout is still unexercised.** Scenario 8 used airplane mode, and a dead network
fails in milliseconds — the abort never had to fire. Testing it properly needs a **slow** network,
not an absent one.

So the timeout remains **asserted in source and unproven in practice**. Recorded rather than counted
as covered, because "we tested offline" reads like it covers this and does not.

**The identity path was never exercised by a real signed-in user through the app.** It is proven for
anonymous callers, the anon key, and garbage tokens (Phase 5 §3c–d), all by direct HTTP. The app
sends a genuine session token, and that specific combination has not been observed end to end.

**The rate limit was never reached.** No test drove 20 requests in five minutes from one subject.
The counter is proven atomic under concurrency (Phase 5 §3b); the ceiling behaviour on a real
device is not.

---

## 3a. The two tests Wael required — both now PASSED

Phase 7 was approved with two required tests before production. §3 above records what was *not*
proven at that moment; this section closes both. **Build 335**, on Wael's device, 2026-09-05.

### Required test 1 — the signed-in identity path, end to end · ✅ PASSED

**Method, chosen so the result could not be talked around:** the rate-limit table was emptied, and
the bucket a signed-in caller *should* produce was computed in advance —
`sha256('user:d5128ca3-ff73-4693-a758-6d3746cb8a0d')` = `a12859ecc7649b24…`, Wael's staging account.
Then one Send from the app, with text no one had used, so it would miss the cache and reach the
counter.

```
rate-limit rows: 1
   a12859ecc7649b24…  count 1   <-- Wael's account
your phrase reached match-faq? YES — result: no_match
```

**The app sent its session token, `match-faq` verified it, and counted him as a person rather than
as an address.** That is the carrier-NAT problem — the reason Q3 was asked at all — proven on a real
device rather than inferred from source.

The send itself behaved correctly: `no_match`, because no published answer covers French or Spanish,
so the ticket filed with no suggestion.

### ⚠️ The first attempt at test 1 failed, and finding out why found a defect

The first run produced **zero** rate-limit rows. Not an identity failure — `match-faq` was never
called at all. `faqChecked` is per screen, and Wael had already pressed Send on that screen twice.
See §4c; the defect is the more valuable half of this test.

### Required test 2 — the 4-second timeout under a slow response · ✅ PASSED

**Airplane mode could never prove this** — a dead network fails in milliseconds and the abort never
fires. A genuinely slow response was needed.

**Method:** `match-faq` gained an env-gated delay (`MATCH_FAQ_TEST_DELAY_MS`), set to 8000 on
**staging only**. Gated on a variable rather than a temporary edit, so production is a no-op **by
construction** rather than by remembering — the alternative was committing a deliberately broken
function to `main` and trusting nobody deployed it. Measured before the test: staging **9,944 ms**,
production **1,740 ms**.

**Result, from Wael:** *"4 seconds, no panel, ticket sent."*

The lookup was abandoned at the timeout, the suggestion was skipped, and the ticket went through —
even though staging would have found a match given ten seconds. **A slow matcher cannot hold a
customer on a Send button.**

**Cleanup, verified rather than assumed:** the secret was unset **and** the function redeployed,
because `TEST_DELAY_MS` is read at module scope and a warm instance would have kept the old value.
Staging measured back at **1,569 ms** afterwards, and `secrets list` shows the variable gone.

*(A production reading of 6,864 ms during cleanup briefly looked alarming and was a cold start —
production runs `match-faq` v1, which contains no delay code. Five fresh calls: 2272, 2021, 1607,
1593, 1650 ms. Recorded because the check's own 4-second threshold produced a false alarm.)*

### Not required, and still not proven

**The rate-limit ceiling was never reached from a device.** Wael's ruling: not required — the atomic
counter is directly tested (Phase 5 §3b). Stated so a later reader does not mistake this for
coverage.

---

## 4. ⭐ Two defects were found by using the product, neither by any test

**4a. The suggested question was truncated.** Both screens rendered it with `numberOfLines={1}`.
Measured against the published set: **8 of the 26 questions exceed one phone line**, the longest at
58 characters. Wael saw *"What is the phone number to call …"* on build 333.

**Not cosmetic — mechanism.** A customer who cannot read the question cannot judge whether it
answers them, so they press Send. Deflection is the entire purpose; an unreadable panel deflects
nobody. Fixed in build 334, test added.

**4b. The close button had silently stopped working.** Found by me at Phase 6, in my own diff — but
**only confirmed fixed when Wael pressed it on 334.** Fourteen source assertions passed while that
button did nothing.

**4c. ⭐ The FAQ check ran once per SCREEN, not once per ticket.** The most valuable finding of this
phase, and it surfaced only because required test 1 failed first.

`faqChecked` flipped true on the first Send and never reset, and `setSuccess(true)` swaps to the
"Thanks" view **inside the same component** — so the screen never unmounts. **A customer filing a
second ticket in one sitting got no check at all.**

**Measured, not inferred.** Wael filed three tickets on build 334 and **only the first was ever
offered an answer.** Ticket #1164 — *"Does naavi work when i am traveling abroad"* — is what it
costs: no suggestion, and a ticket in the inbox.

**Confirmed by discrimination, same app and account, four minutes apart:** at 11:32 without leaving
the screen, `match-faq` was never called; at 11:36 after backing out, it was called, resolved the
identity, and returned `no_match`.

**Fixed by resetting the flag when the text changes**, which is what makes "per submission" true.
Two presses without editing still send, so nobody is trapped.

**⚠️ And the website had the identical defect, live** — `faqChecked` set once per page load, under a
comment claiming *"only ever ask once per submission attempt"*. It was neither. **I inherited both
the bug and the false comment when I mirrored the behaviour into the app.** Outside Stage 2's scope;
fixed on Wael's explicit instruction, 2026-09-05, and verified in a browser on both pages.

**So the sequence is worth stating plainly: the defect was on the website, I copied it into the app,
Wael found it on the app, and the fix went back to the website.** The mobile testing paid for a live
web fix.

**The pattern across all three, and across Stage 1's six:** every one lived in a state I had built
and never looked at. Not a testing-volume problem. I verify the path that works and skip the ones
that do not.

---

## 5. Automated testing

**The F25 suite ran green in the real runner against staging at Phase 5** — 32/32, banner verified.
Six cases have been added since (the close button, the truncation, and B12c's four assertions),
bringing the catalogue to **37**. Those six have been exercised in the file-level harness only.

**The full staging suite at Phase 5 was 604/607** — one error, `prompt-regression.comparison-chatgpt-single-mention`, **measured as not F25's**: it passes on production and fails on staging. Two skips, both pre-existing.

**⚠️ This is not "100% green" and must not be reported as such.** Gate 1 for a production AAB runs
against production and is a separate exercise from anything in this document.

---

## 6. Work that happened during this phase, outside Stage 2

**B12c — the FAQ match cache was never invalidated.** Found while copying three answers to staging so
the app would see what the website sees: the ChatGPT answer was published and the matcher still
returned *"What is MyNaavi?"* to a phrase probed minutes earlier.

`faq_match_cache` is keyed on the customer's words alone, with no expiry — a question asked before
its answer was written returned the old miss permanently. **Worst exactly where this product is
strongest:** ticket in, answer written, next customer still gets the miss.

Approved by Wael as a **Fast** item — no schema change, no contract change, none of the twelve
Protected Core areas. `manage-faq` now empties the cache on create, update, deactivate and
reactivate. Verified live on staging: cache works, save empties it, next ask is re-evaluated.
Poisoned rows cleared — production 9 → 0, staging 15 → 0.

**⚠️ The ID in the approval was wrong.** B12h was proposed and B12h already existed — the
duplicate-alert item. Renamed **B12c**. The description Wael approved is unchanged. Recorded because
proposing a taken ID is precisely what Rule 1b exists to prevent, and it happened in the sentence
asking for approval.

---

## 7. Verdict

**Automated: PASS**, with the qualifications in §5 stated rather than smoothed.

**Manual: PASS.** All seven scenarios exercised on a real device by Wael. **Phase 5's open
requirement is closed.**

**Both of Wael's required tests: PASSED** — §3a. The signed-in identity path resolved to his own
account's bucket on a real device, and the timeout abandoned a deliberately slowed lookup at four
seconds and filed the ticket.

**Still not proven, and not required:** the rate-limit ceiling from a device. Wael's ruling — the
atomic counter is directly tested.

**Builds used:** 333 (first execution), 334 (truncation fix), 335 (per-submission fix). Three
staging APKs, no gates, exactly as the two-phase build process intends.

**Phase 8 is not authorised by this document.** Merge additionally requires the three Architecture
Reference edits Phase 6 §3 records:

1. `match-faq`'s §2 row gains mobile as a consumer
2. §5a's Priority 1d row closes — two copies of the FAQ content become one
3. The Outcome 3 finding: mobile ran a **second matcher with different semantics**, not merely a
   second copy — which Wael approved recording on 2026-09-04

**Production deployment and the AAB remain unauthorised and out of scope.**
