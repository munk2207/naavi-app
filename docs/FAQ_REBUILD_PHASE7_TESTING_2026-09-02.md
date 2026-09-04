# FAQ Rebuild — Phase 7: Testing

**Date:** 2026-09-02
**Item:** F25
**Phase 6:** Approved with 3 mandatory changes. #1 and #2 closed; **#3 is this document.**
**Environment:** staging (`xugvnfudofuskxoknhve`). **Nothing committed, pushed, or deployed to production.**

> ## STATUS: HELD — awaiting Wael's authorisation to deploy to production
>
> **Phase 7 review returned HOLD** on 2026-09-02: the staff-facing surface is completely untested, and it cannot be tested from staging because the staff portal points at production.
>
> **The required next step is a production deployment — which a review can recommend but cannot authorise.** The plan, its blast radius and its rollback are in §6. Nothing is deployed until Wael says so.

---

## 1. Mandatory change #3 — `check-staff`'s existing consumers

Phase 3's review corrected my claim that unmodified code "cannot regress". `manage-faq` becomes `check-staff`'s **fifth** consumer, and adding a consumer changes a function's operating conditions even when its code is untouched.

**Static verification**

| Check | Result |
|---|---|
| `check-staff/index.ts` modified? | **No** — `git diff HEAD` returns nothing |
| Any consumer's call site changed? | **No** — no `+`/`−` line in `index.html`, `support.html` or `admin.html` touches `check-staff` |
| `add-staffer` (the fourth consumer) modified? | **No** |

**Live behaviour of the unmodified function**

| Input | Result |
|---|---|
| No token | HTTP 200, `authorized=false` |
| Garbage token | HTTP 200, `authorized=false` |
| Service-role key | **HTTP 401** — correctly refused |

**One asymmetry worth recording, because it is deliberate and could look like a bug later.** `check-staff` refuses the service-role key; `manage-faq` **accepts** it, as its documented second auth path for the one-time migration — the same dual-auth pattern `manage-voice-pin` already uses (CLAUDE.md Rule 4). This is not a new exposure: service-role bypasses RLS everywhere and is server-only. But the two functions have deliberately different auth surfaces, and that should not be "fixed" by someone who notices it out of context.

**What remains untested and cannot be tested from here:** a real staff sign-in through the OTP flow, and the portal home, `/support` and `/admin` loading for an authenticated staffer. Those need the production deploy — §4.

---

## 2. Automated testing — full suite

`npm run test:auto`, which runs the drift gate first and then the whole catalogue.

### 2a. Drift gate

**It failed first, correctly**, and that is worth recording rather than smoothing over:

```
DRIFT CHECK FAILED — 46 new difference(s) since the baseline
```

**All 46 were F25 objects.** Verified by filtering: every `✗` line names a `faq_*` table, index or RLS flag, and **no difference exists that F25 did not create**. This is the deliberate case CLAUDE.md describes — work on staging not yet promoted — so it was recorded, not reverted:

```
npm run drift:check -- --write-baseline
Baseline written: 112 accepted differences

re-run: No new drift. Staging and production have not separated further.
```

### 2b. Full catalogue

```
Naavi Auto-Tester — 595 tests
✓ 592 passed   ✗ 0 failed   ⨯ 1 errored   ⧗ 0 timed out   ○ 2 skipped
Duration: 591.8s
```

**All 20 F25 tests passed.**

**⚠️ This is not "100% green", and it should not be reported as such.**

**The one error: `calendar.sync-atomic-response-contract` — "This operation was aborted."**

Diagnosed rather than re-run until it agreed with me:
- The test lives in `tests/catalogue/calendar.ts` and **references no F25 object** — no `faq`, no `get-faq`, no `match-faq`, no `manage-faq`.
- F25 changed no calendar code, no calendar table, and no shared function calendar uses.
- Run in isolation it **passes in 28.7 seconds** — long enough to be aborted when the full suite is under load.

**Conclusion: a pre-existing timeout flake in a slow calendar test, unrelated to this work.** It is not claimed as fixed and it is not claimed as caused by F25; it is claimed as unrelated, on the evidence above.

**The two skips are pre-existing, self-documenting coverage gaps** — `calendar.travel-planning-outcome-level-chain` needs a "dentist appointment" in the test account, and `b10r.contacts-birthday-real-year-not-calendar-computed` needs a specific named contact. Neither is F25's.

---

## 3. Manual validation performed

Governance requires manual validation for end-to-end integrations; passing automated tests alone is not sufficient. What was exercised by hand, in a browser against staging:

| Scenario | Result |
|---|---|
| FAQ page loads from the database | 23 of 23 rendered, status "23 answers" |
| Every published anchor resolves | 23/23, including the 12 the mobile app deep-links |
| Deep link `#privacy` | found, opened, scrolled into view |
| Category filter | dropdown populated from the database; "Calls & briefings" → 4 |
| Search, plain word | "password" finds *What does MyNaavi remember?* — a word in neither its question nor its answer, matched through the AI's search terms |
| Search, no match | "zzzz" → 0, with the contact-support fallback |
| **Search defect found and fixed here** | "PIN" returned **5** because substring matching hits `ty`**`pin`**`g`. Changed to word-prefix matching: now 2, and half-typed "aler" still finds all 12 alert answers |
| Website Report form, on Send | *"I want to add my daughter to my community but I cannot work out how"* → **How do I add someone to my MyNaavi Community?** with a working link. That phrase scores **zero** under keyword matching, and the website has no matching at all today |
| Second Send must still submit | It did — reached `ingest-ticket`, refused only by the existing `origin_not_allowed` control because the test ran on localhost. **The FAQ check did not block it.** |
| Database unreachable | All 23 answers stay on the page, anchors intact, controls hidden. **Better than before §10**, where a failed fetch showed an error and nothing else |
| Save with no deploy hook | HTTP 200 — a missing hook cannot cost a staffer their answer |
| Staleness reporting | `state: unknown`, `hook_configured: false`, page reachable, `rebuild_now` → `hook_not_configured`. Unknown is never dressed up as healthy |

---

## 4. What cannot be tested yet, and why

**The staff portal page has never been used by anyone, including me.** `staff.mynaavi.com` points at **production**, where `manage-faq`, `get-faq`, `match-faq` and the four tables do not exist. Opening the page today would authenticate and then fail every call.

**This is the largest untested surface in the item.** Everything about it — the editor, the save flow, the reclassify button, the publish-status banner, the "Make this an FAQ" hand-off from a ticket — is verified only by reading the code and by testing the functions it calls.

**Wael's own validation is blocked by the same thing.** The six scenarios in Phase 5 §5 all begin at a surface pointing at production.

**Both unblock with one step: deploying the migration and the three functions to production.** That needs Wael's explicit instruction, which staging-first reserves entirely for him.

**Sequencing, unchanged from Phase 2 §7:** functions and migration to production → staff portal usable and testable → Wael's manual pass → only then the website pushed, because its pages go live the moment they are pushed and there is no staging to catch a mistake.

---

## 5. Verdict

**Automated: PASS**, with one pre-existing unrelated flake named rather than hidden, and the intentional staging drift recorded rather than reverted.

**Mandatory change #3: CLOSED** for everything reachable without a production deploy. The remaining piece — a real staff sign-in exercising the portal's three existing pages — is listed in §4 and must happen after deployment.

**Manual: PARTIAL.** The customer-facing surfaces are verified in a browser. **The staff-facing surface is not verified at all**, and this document does not pretend otherwise.

**Phase 8 is not authorized by this document.** Merge additionally requires the Architecture Reference reconciliation, which Phase 1A and Phase 6 both record as a hard precondition — covering the FAQ, the staff portal and the ticket system.

---

## 6. Phase 7 review outcome — HOLD, 2026-09-02

**Verdict returned: HOLD — production/manual validation required.** The staff-facing surface remains completely untested, including authenticated portal operation and the FAQ editor and save flow. **Do not proceed to Phase 8.**

**The review's stated next step is to authorise deployment of the migration and the three functions to production.**

### Why that step is not taken in this document

**A review can recommend a production deployment. It cannot authorise one.**

CLAUDE.md's staging-first rule is explicit: production is read-only unless Wael says otherwise, and rule 7 requires *"clear explicit approval from Wael to deploy to production."* Rule 1 requires explicit approval before any state-changing action. Neither is satisfied by a reviewer's recommendation, however sound — and Wael has already corrected this project once, on 2026-09-02, for treating a reviewer's "proceed" as clearance: *"The reviewer opinion does not provide the authorization to move, I do."*

**So this document records the request and the plan, and stops.** Status: **awaiting Wael's authorisation.**

### The deployment being requested, in order

1. **The migration** — creates four new tables on production. **Additive only:** no existing table altered, no column changed, nothing dropped.
2. **The three functions** — `get-faq`, `manage-faq`, `match-faq`. All new; nothing that exists today calls them.
3. **The 23 answers** migrated into the production tables, with the same word-for-word comparison printed rather than asserted.
4. **The staff portal pushed** — this is the step that makes `staff.mynaavi.com/faq` exist, and therefore the step that makes Wael's testing possible at all.

### What changes for anyone using MyNaavi today

**Nothing.** The website continues to serve the current FAQ page, because the website is pushed **last**, after Wael's testing. The mobile app is untouched. No existing function, table or column is modified.

**The one visible effect** is inside the staff portal: a **FAQ** tile on the home page, and a **"Make this an FAQ"** button on tickets. Visible only to authenticated staff.

**One deliberate consequence of the Phase 6 secret placement:** production's `manage-faq` holds `VERCEL_DEPLOY_HOOK_URL`, so a save on production will trigger a website rebuild. Until the website is pushed, that rebuild redeploys the current `main` unchanged — harmless, and it is the mechanism working as designed.

### Rollback

Revert the staff-portal push and delete the three functions. The four tables may stay: nothing reads them until the website is pushed, and they are additive.

### What Wael tests once it is deployed

The six scenarios in Phase 5 §5 — write a question and see it appear, edit one and see it re-sorted, turn a ticket into an FAQ, search the page, submit a support form and see the suggestion, and confirm a known deep link still lands.

### Then, and only then

The website is pushed last, because its pages go live the moment they are pushed and there is no staging environment to catch a mistake first.
