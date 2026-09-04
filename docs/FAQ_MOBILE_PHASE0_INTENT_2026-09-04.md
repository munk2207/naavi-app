# FAQ — Mobile Stage, Phase 0: Intent Approval

**Date:** 2026-09-04
**Status:** **APPROVED WITH 4 DECISIONS — Wael, 2026-09-04.** All four incorporated; see the approval
section at the end.
**Item:** **F25 Stage 2.** Wael's decision Q4, 2026-09-04: this extends F25's existing row rather
than minting a new ID — *"This is explicitly Stage 2 of the FAQ work and completes the duplication
removal deferred by Stage 1; a new ID adds little value."* No new holding-list row is created
(Rule 1b satisfied by not creating one).
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v4.3, Phase 0.
**Architecture Reference:** `2026.09.03.17`

**Why this is a new Phase 0 rather than a continuation.** F25's Phase 0 lists under Out of Scope:
*"Any mobile app change. `lib/faq.ts` is untouched; the app's support forms keep their current 12
keyword entries. No AAB, no Play release, no gates."* Scope is locked (Governance Rule 0.2), so the
mobile work needs its own approved intent — it cannot inherit one that excluded it.

**The deferral condition is met.** Wael, 2026-09-02: *"we will wait until finish this build and test
on the web forms before we establish what exactly the scope on mobile."* The web stage is live and
tested. Wael chose the direction on 2026-09-04: **the app calls `match-faq` directly and
`lib/faq.ts` is removed.**

---

## User Intent

The app's Contact and Report forms should suggest the same answers, matched the same way, as the
website — so a customer describing a problem in the app is offered the answer instead of filing a
ticket about something already answered.

---

## The problem, measured

| Observation | Source |
|---|---|
| `lib/faq.ts` holds **12** questions | 12 `slug:` entries in the file |
| **26** are published | production `get-faq`, 2026-09-04 |
| So the app cannot suggest **14** of them | set difference |
| Its own header instructs a human to keep it in sync, and nothing enforces it | `lib/faq.ts:6-12` |
| One matching word can never qualify | `scoreEntry` scores 1 per keyword hit + 0.5 per title word; threshold is 2 (`lib/faq.ts:116`) |
| Consumers | `app/contact.tsx:31`, `app/report.tsx:32` — the only two importers |

This is the third copy F25 set out to remove and deliberately left in place. Removing it takes
duplication from two copies to one, which is what the Duplicated → Shared Core ownership change
approved on 2026-09-02 was for.

---

## ⚠️ Two findings that change the shape of this, found while drafting

**1. The app matches as the user TYPES. The website matches on SEND.**

`app/contact.tsx:48-53` and `app/report.tsx` run `suggestFaq` on a 300 ms debounce on every
keystroke. That is free today because the matching is local arithmetic.

`match-faq` is an AI call. It costs money per call and took **1265 ms** measured against production
on 2026-09-04. F25's Phase 0 settled this for the web deliberately — *"Matching runs on Send, not
per keystroke"* — and Phase 3 rejected routing the FAQ page's own box through it for the same
reason.

**So this is not a like-for-like swap. Moving the app to `match-faq` changes WHEN suggestions
appear**, from live-as-you-type to once, on Send. That is a real change to how the screen feels and
it needs Wael's decision, not an implementation choice.

**2. Local matching works offline. `match-faq` does not.**

`suggestFaq` needs no network. A customer on a bad connection gets suggestions today and would get
none afterwards. The form itself already requires a network to submit, so the ticket cannot be
filed offline either — but the suggestion disappearing is a real, if narrow, loss.

---

## Success Criteria

1. **The app's Contact and Report forms suggest from all published answers**, not 12 — demonstrated
   against a question whose answer is among the 14 the app cannot currently see.
2. **The four phrases F25 measured behave on mobile as they do on the web**, including
   `"I want to add my daughter to my community"`, which scores **0** under the current keyword
   matcher.
3. **`lib/faq.ts` is deleted** and nothing imports it.
4. **A failed or slow match never blocks the ticket.** The form submits regardless — the same floor
   the website holds.
5. **The 12 existing deep links still open the right anchor.**

---

## In Scope

- `app/contact.tsx` and `app/report.tsx` — call `match-faq`, render its results, keep the deep-link
  behaviour
- Delete `lib/faq.ts`
- Auto-tester coverage per Rule 15a
- Whatever `match-faq` needs to serve a mobile caller safely (see Open Questions)

## Out of Scope

- **Any change to the website or the staff portal.** Both are live and working.
- **Any change to `match-faq`'s response contract.** It was fixed in advance to allow exactly this
  reuse without an API redesign; if this stage needs the contract changed, that is a finding worth
  stopping for.
- **The voice surface.** No FAQ logic exists there.
- **A new FAQ browsing screen in the app.** Help → Frequently asked already opens the website and
  inherits the rebuilt page with no release.
- **Production deployment or a Play release** — separate approval, and AAB 332 is in Google's review.

---

## Constraints

- **Staging first.** Any Edge Function change deploys to `xugvnfudofuskxoknhve` first.
- **This requires a mobile release**, so the full gate sequence applies: `test:auto` green, voice
  regression, Firebase Test Lab, then the production AAB. Nothing here shortcuts that.
- **`match-faq` rate-limits per IP.** Mobile traffic arrives behind carrier NAT, so many customers
  can share one address — see Open Questions.
- **No answer text is generated.** The matcher selects from published answers, on mobile as on web.

---

## Completion Criteria

1. A question answered by one of the 14 the app cannot currently see is suggested in the app.
2. All five Success Criteria demonstrated as actual output, not asserted.
3. `lib/faq.ts` gone; no import of it anywhere.
4. `npm run test:auto` green, including new regression tests.
5. The Architecture Reference updated in this same work item — §2's FAQ rows gain mobile as a
   consumer, and §5a's FAQ-content duplication row closes from two copies to one.

---

## Decisions — answered by Wael, 2026-09-04

**Q1 — When do suggestions appear? → ON SEND.** *"Do not make paid AI calls while typing."*
The per-keystroke debounce in `app/contact.tsx:48-53` and `app/report.tsx` is removed, not retuned.
Both surfaces now match at the same moment, for the same reason F25's Phase 0 chose it for the web.

**Q2 — No connection → no suggestion.** *"Submission follows the form's existing network-failure
behavior. No special offline FAQ fallback."* The suggestion is an aid, not a gate: it is absent
when it cannot be produced, and the form behaves exactly as it does today when the network fails.
**This forecloses a local fallback copy** — which matters, because a local copy is precisely the
thing this stage exists to delete.

**Q3 — Do NOT simply raise the IP limit.** *"Carrier NAT makes IP-only limiting unsuitable for
mobile; Phase 1 should investigate a mobile-safe rate-limit identity before implementation."*
This is now a **required Phase 1 investigation**, not an implementation detail — see Phase 1 §3.
Raising the ceiling is explicitly rejected as the answer: it would weaken the control for every
caller in order to accommodate one class of caller.

**Q4 — Extend F25; no new ID.** *"This is explicitly Stage 2 of the FAQ work and completes the
duplication removal deferred by Stage 1; a new ID adds little value."* F25's existing holding-list
row and its FOR WAEL'S EYES line are updated when this stage closes; no row is created.

---

## Phase 0 approval

**APPROVED WITH 4 DECISIONS — Wael, 2026-09-04.** All four are incorporated above, and Q1 and Q2
change the In Scope list as follows: the per-keystroke matching is **removed** rather than adapted,
and **no offline fallback is built**.

Proceed to Phase 1.
