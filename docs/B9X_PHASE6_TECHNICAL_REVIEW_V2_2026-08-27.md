# B9x — Phase 6: Technical Review v2 (after coding, against what actually shipped)

| | |
|---|---|
| **Item** | B9x — an alert meant for another person silently fires to the user instead |
| **Date** | 2026-08-27 |
| **Commit under review** | **`d8fc080`** |
| **Supersedes** | `B9X_PHASE6_TECHNICAL_REVIEW_2026-08-27.md`, which reviewed `fc71146` |
| **Architecture Reference** | **2026.07.18.13** (revision 13, authored by this item) |
| **Deployed** | Supabase **staging** only. Production untouched. |
| **Status** | **APPROVED FOR CLOSURE — external reviewer, 2026-08-27.** See §9. |

---

## 1. Why this exists — the standing verdicts describe code that no longer exists

Phase 6 returned **PASS / PASS / PASS, approved with conditions** — against **`fc71146`**. Live
testing then proved `fc71146` **never executed** on the path B9x is about. What is deployed and
tested now is `d8fc080`: a shared helper, a second call site, three additional tests.

**That implementation has never had an after-coding review.** And **Phase 3 v2's verdict never
returned**, so its boundary was never signed off either — Phase 4 v2 was coded on Wael's explicit
instruction with that review open, flagged at the time and recorded in the commit.

Closing B9x on the existing verdicts would mean closing it on an assessment of the wrong build. This
package asks for one verdict on the real one, and absorbs the outstanding boundary question.

---

## 2. What changed between the two builds

| | `fc71146` (reviewed) | `d8fc080` (shipped) |
|---|---|---|
| Structure | inline block | `resolveLocationRecipient()` helper |
| Call sites | **1** — Path B only | **2** — Path B **and** the Universal gate's immediate-emit |
| Reached in practice | **never** — 0/3 live trials | **yes** — 4/4 live drops, all at Site B |
| Tests | 11 | 14 |
| Behaviour contract | — | **unchanged**; only reach changed |

**No behaviour in the approved table moved.** All six `resolve-recipient` outcomes, the
self-override short-circuit first, the wrong-channel fail-closed case Phase 6 required, ambiguity
asking for the full name, `task_actions` untouched.

---

## 3. Live evidence (Phase 7, full record in `B9X_PHASE7_TESTING_2026-08-27.md`)

| Test | Trials | Result |
|---|---|---|
| *"Send sms to Abdyn when I arrive at the office"* — unknown name | **3** | **Refuses, saves nothing.** `fc71146` returned `{"to":"Abdyn"}` on all three. |
| *"Alert me at Costco"* — no recipient | **3** | Saves, single turn. Exemption intact. |
| *"…send an email to hussein.test@example.com"* | 1 | **`to_email` populated, saved in one turn.** The success path. |
| Self-override / `DRAFT_MESSAGE` / compound refusal | 1 each | All correct |
| Static suite | — | **14/14** |

**The success-path test is the defect prevented, not just a positive control.** Before `d8fc080` that
request saved with `to` set and `to_email` empty; at fire time `report-location-event:765` computes
`noRecipient` **true** and `:772` calls it a self-alert. That is the 19 July mechanism exactly.

**Deployment verified by downloading the deployed source back**, per Architecture Reference §0d — two
call sites present in what is running. **Which site executed was read from logs**, not assumed.

---

## 4. Architecture — revision 13

**Outcome 2 under the Architecture Drift Rule**, as Phase 6 v1 determined. The update is done, in
this work item, as the hard merge precondition required:

- **§2b** — recipient resolution has **three** creation-time call sites, not two.
- **§2e (new)** — *a location alert is built in TWO places inside `naavi-chat`*, with which is
  reached when, and the record that eleven static tests, a clean type check and two external reviews
  all passed over a fix sitting on the wrong one.

**Version check:** Phase 1A recorded 2026.07.18.12. Nothing intervened before revision 13, which this
item authored. **Confirmed, not assumed.**

**Unchanged:** ownership is still Shared Core; ADR 0001 is **not** resolved; Protected Core is not
expanded; no API contract, schema, migration or cron change.

---

## 5. What is NOT proven — stated so no verdict rests on it

1. **Gate 1 was not run.** `npm run test:auto` defaults to production and its fixtures delete rows.
   "Tests pass" means the B9x suite.
2. **Site A — not exercised. Not failed.** It never ran. Three attempts couldn't reach it because
   `get-naavi-prompt:1217` files a third-party send on that route into `task_actions`, which Phase 6
   excluded. Its check is a guard on a shape that path rarely produces.
3. **The contact-lookup route to the success branch is untested.** Proven via a literal address only.
4. **Two contacts sharing a name — untested.**
5. **Reproduction 2 — not fixed**, cause unproven, out of scope since Phase 0 v3.

---

## 6. ⭐ Three unverified claims made during this work, and what they cost

Recorded because a governance-compliance verdict should see them, and because the pattern is the
point:

| Claim | Reality | How it surfaced |
|---|---|---|
| *"Both reproduction rules are still enabled and will misdeliver"* | Both were `one_shot` and had **already fired**, disabling themselves. `last_fired_at` was in the row all along. | Only when `select=*` was read before deleting |
| *"The staging Google account has no contacts"* | The **connection was broken** — `invalid_grant`. Inferred from five invented names returning `not_found`. | **Wael challenged it** |
| *"Neither of us has watched one fire"* | Wael had, and has video. | **Wael corrected it** |

**None was a code defect. All three were inference presented as observation** — the failure mode
CLAUDE.md's five levers exist to catch, and the same shape as the Phase 1A error that made
`fc71146` unreachable. **The first claim materially misinformed a decision Wael then made.**

---

## 7. Two findings recorded, neither made into an item (Rule 1b)

1. **A broken Google connection is reported as "contact not found."** `resolve-recipient:96` returns
   `not_found` when the lookup returns nothing **or fails**. Naavi says *"I don't have a contact
   named X — save them to your contacts first"* when the contact exists and the connection needs
   reconnecting. **The refusal is right; the reason is false.** Predates B9x, affects voice
   identically, and now sits under B9x's own new message.
2. **`lookup-contact` searches My Contacts only** (`people:searchContacts`), not auto-collected
   "Other contacts".

---

## 9. ⭐ Review outcome — **PASS / PASS / PASS, APPROVED FOR CLOSURE** (2026-08-27)

**The re-review was confirmed necessary:** the earlier verdict covered `fc71146`, while what is
deployed and tested is `d8fc080`. *"Closing B9x against the old review would therefore have been
incorrect."*

| Verdict | Result |
|---|---|
| Technical Review | **PASS** — behaviour contract preserved while reachability was corrected; deployment verified from downloaded deployed source rather than assumed |
| Architecture Completeness | **PASS** — revision 13 documents the three resolver call sites and the two construction sites; **the Phase 8 merge condition is satisfied** |
| Governance Compliance | **PASS, with the recorded exception** — coding while Phase 3 v2 was open *"was done on your explicit instruction and recorded rather than concealed. That is a governance exception, but it does not invalidate the technical evidence."* |
| Overall | **APPROVED FOR CLOSURE** |

**Phase 3 v2 is settled, and no retroactive verdict is needed.** The shipped architecture *"is exactly
the boundary that Phase 2 v3 established: one shared helper, two call sites, location-gated,
behaviour contract unchanged"* — and the live evidence validates the implementation rather than only
its plan.

**The unproven cases in §5 do not block closure.** Site A is acceptable unexercised *"because the
defect-bearing live path has been identified and exercised"*; the contact-name and duplicate-name
routes are useful additional coverage, not essential; Reproduction 2 was already excluded. **Gate 1
stays honestly unclaimed** — *"I would not run a test suite configured against production with
destructive fixtures merely to satisfy the label."*

### ⭐ On §6 — the ruling is **do not add process**

The three unverified claims *"deserve attention"*, but the reviewer explicitly declined to add a rule
or a phase: they share one cause already identified after the first failure — **evidence scope did
not justify the breadth of the conclusion.** The lesson is to stay a single sentence:

> **A verification claim must state what was directly observed separately from what was inferred from
> it.**

*"That is enough; adding more process around the same principle risks creating paperwork rather than
improving verification."*

**Recorded so a later session does not propose the rule again as though it were an oversight.** It was
considered and declined.

---

## 8. What the reviewer was asked to decide

1. The four verdicts against **`d8fc080`**: Technical Review · Architecture Completeness ·
   Governance Compliance · Overall Recommendation.
2. Whether the outstanding **Phase 3 v2** boundary — one helper, two call sites, gated to location —
   is satisfied by the shipped code, or needs its own pass.
3. Whether §5's unproven items are acceptable for closing B9x, given the defect is proven fixed on
   the path that carries it.
4. Whether §6 warrants any process change beyond what Phase 2 v3 §2 already records.
