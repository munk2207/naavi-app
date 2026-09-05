# FAQ — Mobile Stage, Phase 6: Technical Review (After Coding)

**Date:** 2026-09-04
**Item:** F25 Stage 2
**Architecture Reference:** `2026.09.03.17` — **re-confirmed current**, per Phase 1A's Version
Verification requirement. No newer revision has landed since Phase 1A recorded it earlier today.
**Governance:** v4.3, Phase 6.

Claude's self-review of its own implementation, prepared for external review. **Not an approval.**
**One defect was found in my own diff during this review and fixed** — §4.

---

## 1. What is being reviewed

Six files from Phase 2 §1, plus the Phase 6 correction. Nothing else.

```
supabase/migrations/20260904000000_faq_rate_limit_subject.sql   new,  73
supabase/functions/match-faq/index.ts                          +124
app/contact.tsx                                                 +86
app/report.tsx                                                  +92
lib/faq.ts                                                     −131  (deleted)
tests/catalogue/faq.ts                                         +141
```

**Isolation is strong where it matters.** No file under `naavi-voice-server/`, no other Edge
Function, no website file, no staff-portal file. `get-faq`, `manage-faq` and `check-staff` are
untouched.

---

## 2. Architecture impact — named, not left to inference

**Did it increase duplication?** **Yes, in one place, deliberately and previously approved.**
`faqCheckBlocks` is ~45 lines repeated in `app/contact.tsx` and `app/report.tsx`, identical apart
from the surface label — verified by diffing the two functions with the label normalised. This
mirrors the same accepted repetition between `report.html` and `contact.html`, and Phase 3 D1
recorded the decision and the condition for revisiting it: a third surface.

**Did it reduce duplication?** **Yes, and by much more than it added.** Content copies 2 → 1.
Matching implementations 2 → 1. 131 lines of hand-maintained FAQ deleted.

**Did it bypass Shared Core?** No. Both screens call `match-faq`; neither contains matching logic.

**Did it introduce another independent implementation?** No — it deletes one.

**Did it violate entry-point responsibilities?** No. Both screens became *more* like entry points:
they collect input, call one function, render the result.

**Did it change an API contract?** **The request shape only.** `match-faq` now reads an optional
`Authorization` header. **The response contract is unchanged** — which is what Stage 1 Phase 2 §5
fixed it in advance for, and this stage consumed it without needing an alteration. That prediction
held.

**Did it change a capability's ownership?** **No.** `match-faq` already owned matching and still
does; mobile became a consumer. §4's Ownership Change Rule does not apply — unlike Stage 1.

**Did it expand what counts as Protected Core?** **No.** It modifies two existing areas (API
contracts, Permissions) and adds nothing new to the list.

---

## 3. Architecture Drift Rule

**Outcome 3, carried from Phase 1A unchanged.** The Reference records `lib/faq.ts` as a surviving
content copy but does not record that mobile ran an *independent matcher with different semantics* —
a 3-word minimum and a threshold no single word could clear.

**Wael approved on 2026-09-04** that the Phase 8 reconciliation records this, not merely the content
duplication. Implementation did not stop, per v4.3.

**Phase 8 owes three edits:** `match-faq`'s §2 row gains mobile as a consumer; §5a's Priority 1d row
closes from two copies to one; and the second-matcher finding is recorded.

---

## 4. ⚠️ Defect found in my own diff during this review

**The suggestion panel's close button silently stopped working.**

The old code kept a `suggestionsDismissed` flag that the per-keystroke effect read:
`if (suggestionsDismissed) { setSuggestions([]); return; }`. That effect is what actually cleared
the panel. **Phase 4 removed the effect and left the flag with no reader** — so the close button set
a state nobody consulted, and the panel stayed on screen.

**How it was found:** by diffing `faqCheckBlocks` between the two screens after noticing an
asymmetry — `report.tsx` reset the flag and `contact.tsx` did not. The asymmetry was cosmetic; it
led to the real defect underneath, which was present in both.

**Fixed:** the button now clears the suggestions directly, the dead state is deleted from both
screens, and a comment records why it broke. Two assertions added.

**⚠️ And the first version of that test was wrong in an instructive way.** It asserted the string
`suggestionsDismissed` appears nowhere — which failed against my own comment explaining the defect.
A test that forbids naming a problem would have forced the explanation out of the code. Narrowed to
assert the *state* is gone, not the word.

**This is the third defect this session that lived in a state I built and never looked at** — after
the faded Publish button and the empty-result message in Stage 1. The pattern is not "test more";
it is that I verify the path that works and skip the ones that do not.

---

## 5. Invalidated planning assumptions

Recorded per the Invalidated Planning Assumption Rule — each a **planning** miss, not an
implementation error or a scope cut.

**5a. Phase 2 did not anticipate that removing the effect would orphan the dismiss control.** It
listed the debounce as something to remove and treated `suggestionsDismissed` as part of it. It was
not: the flag also served a button that Phase 2 never mentioned. *Why it didn't hold:* the plan
described what to delete, and nothing required tracing what else read it.

**5b. Phase 3's A5 proposed a 4-second timeout as a written constraint; it needed a mechanism.**
`invokeWithTimeout` is for `supabase.functions.invoke`, and these screens use raw `fetch` to send
their own headers. `AbortController` was used instead. Not a deviation from the intent, but the plan
named a helper that did not fit the call it was constraining.

---

## 6. Regression risk

| Area | Assessment |
|---|---|
| **The live website's support forms** | **Tested directly against the deployed function** (Phase 5 §3c): no credentials → 200, matched. The highest-value regression in the change, and the one most likely to be assumed rather than checked |
| `get-faq`, `manage-faq`, `check-staff` | Not modified |
| The staff portal and the website | No file touched |
| Voice | No file touched; no FAQ logic exists there |
| `faq_rate_limit` | Column renamed; `match-faq` is its only reader and writer, verified by search |
| **The rate limiter itself** | **Strictly better than before this change** — it previously failed open silently and lost counts under concurrency. Both fixed and measured |
| **The two app screens** | ⚠️ **Unproven on a device.** Source and function verified; the screens have never run. Wael's Phase 5 ruling makes a staging APK a release precondition |

---

## 7. Test coverage

**36 F25 cases** (30 before this stage). 32 ran green in the real runner against staging; the six
added since are file-level and run in a scratch harness — **14/14 there, which is a narrower claim
than it sounds and is stated as such.**

**Gaps, disclosed rather than left implicit:**

1. **The two screens have no executable test.** They are React Native; the runner cannot reach them.
   Everything asserted about them is a source assertion. **This is the largest gap in the stage**,
   and it is exactly where the Phase 6 defect lived — a source assertion would not have caught a
   button wired to dead state either, until one was written for it afterwards.
2. **The 4-second timeout is asserted in source, never exercised.** No test makes `match-faq` hang.
3. **The identity path is proven for anonymous, anon-key and garbage tokens, but never for a real
   signed-in user** — that needs a live session, which needs the app.

---

## 8. Four verdicts

**Technical Review: PASS.** The implementation matches the amended plan. One defect was found in
this review, in my own code, and fixed with a regression test.

**Architecture Completeness: PASS**, with the duplication in §2 named and previously approved.
Duplication reduced on net; no Shared Core bypass; no ownership change; no expansion of Protected
Core.

**Governance Compliance: PASS.** Phases 0–5 approved by Wael with corrections recorded rather than
absorbed. Phase 3's seven mandatory changes all resolved. Rule 15a satisfied. Staging-first held —
**nothing deployed to production, no AAB built.** Part G's record correction was completed before
Phase 4, as instructed.

**Overall Recommendation: APPROVED WITH MANDATORY CHANGES.**

Two items, both narrow:

1. ⚠️ **The six mobile scenarios must be exercised on a staging APK before release** — Wael's
   Phase 5 open requirement, and §7's gap 1 is the reason it matters more than usual: the screens
   are the least-verified part of this stage and have already hidden one defect.
2. **Phase 8 owes three Architecture Reference edits** (§3), including the second-matcher finding
   Wael approved recording.

**Not blocking, recorded for Wael:** the full staging suite's one error
(`prompt-regression.comparison-chatgpt-single-mention`) is **not F25's** — it passes on production
and fails on staging, measured directly. It does mean a staging run cannot be reported as Gate 1.
