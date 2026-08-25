# Session Handoff — 2026-08-25

**B11o shipped to production and closed. B9x is next, and Wael has said so explicitly.**

---

## ⭐⭐⭐ START HERE — B9X, AND NOTHING ELSE FIRST

**Wael, closing this session: *"next session start with the priority - B9x."***

The standing instruction from 2026-08-24 still binds: **the only work is the priority list.** Findings go to the general list; work stays on the item. **And since 2026-08-25 you may not even write a finding into that list without asking first — see Rule 1b below.**

### What you already know about B9x, so you do not re-derive it

**The bug, in Wael's terms:** you set an alert meant to text somebody else. Naavi never worked out who that person was. When it fires, the message comes to **you** instead. Nothing warns you. The other person never hears from you, and you believe they did.

**The root cause is already located — B9x is the only item on the priority list where that is true:**

> `supabase/functions/evaluate-rules/index.ts:825` computes `noRecipient = !toPhone && !toEmail`, feeding `isSelfAlert` at `:830`. **It cannot distinguish "no recipient was ever specified" from "a recipient was named but never resolved."**

**Rule 17 is already satisfied** — two independent live reproductions exist, plus code confirmation. You do not need to reproduce it again before opening Phase 0.

**⚠️ Check this early, in Phase 1A, because it may double the change.** The Architecture Reference lists `evaluate-rules` and `report-location-event` as **duplicated fan-out logic** — Priority 1b, three confirmed drift incidents, held together only by a code comment saying "keep both in sync." **B9x's row cites `evaluate-rules` alone.** If `report-location-event` collapses the same two states, the fix lands twice. Checkable in minutes; unchecked today.

**Governance: full Phase 0–8.** `evaluate-rules` is Protected Core twice over — Action Rules and Notification routing.

---

## The priority list — Wael's order, set 2026-08-25

| | | |
|---|---|---|
| **1** | **B9x** | A third-party alert silently fires to the user instead. Root cause located. |
| **2** | **B11m** | Naavi answers *"what reminders do I have?"* without looking anything up. `action_types` empty in the log; she asserted "none" while an enabled rule fired two minutes later. |
| **3** | **B10c** | **Central item for ALL time issues** (Wael's decision, 2026-08-25). Two instances. |
| **4** | **B11l** | *"text me"* resolves to a stranger and the card labels him **"me"**. Verified on production. |
| **5** | **S2** | The PIN cannot tell which of two people sharing a phone is calling. |

**All five require full Phase 0–8.** Every one lands in a Protected Core file — and the Architecture Reference marks the **entire** voice server file, not selected functions. **There is no light-path item on this list.**

**On the order, recorded because it was asked for and differs from mine:** asked to assess by criticality, I ranked **B11l first** — it is the only one that reaches a real third party, on production, one tap away, with a label that actively lies. Wael ranked it fourth. **His order may cost nothing**, because B11l is mobile: it cannot ship without a production AAB, which cannot happen while Gate 1 is red from the parked [[B11z]]. Items 1–3 are backend and voice, and deploy directly.

---

## What shipped

**[[B11o]] — deleting a calendar event by phone. It had never worked, on either branch.**

`DELETE_EVENT` was the only one of eleven cases in `executeAction` that never resolved a caller, so the request reached `delete-calendar-event` with no `user_id`, took its JWT branch — which carries no user filter because it expects RLS to narrow `user_tokens` — and `.single()` failed against every google token row. 4 rows on staging, 5 on production.

**Promoted with [[B11k]], as a dependency and not a convenience.** Production had no `outcome_report.js`; it spoke first and executed afterwards, discarding the result. B11o alone would have shipped the identity fix with an **inert** no-match guard, reinstating the exact false success its own Phase 3 reviewer had refused. **B11k is the larger of the two for users** — production had been reporting success on failed actions across eleven action types.

**Live on production:** voice `5dff3d5`, deployed **2026-08-25 10:56 AM EST**. That deploy also released 1-888-91-NAAVI. Phase documents: `B11O_PHASE0…PHASE8`.

**Still open, excluded twice:** `DELETE_MEMORY` carries the same false-success shape at `src/index.js:4671`. Ruled out of B11o by Wael at Phase 0 and independently by the Phase 3 reviewer. **It is currently recorded only inside B11o's closed-archive entry**, which is a thin place for a live defect to live. **Ask Wael whether it should have its own row — do not create one.**

---

## ⭐ Three rules added today, all from Wael's corrections

**These are in CLAUDE.md and bind every session.**

**Rule 13a — a question you need answered gets its own message.** Not appended to a status report, not the last line of a test summary. *"If you want me to answer, DO NOT put a question within another subject."* **And silence is not a "no"** — an unanswered question is open, not declined. Origin: a real defect was raised twice as a trailing numbered option and dropped both times; a review then found **seven** findings marked "for the general list" with **none** actually added to it.

**Rule 1b — never create a tracked item without explaining it first and getting clear approval.** *"I did not agree on anything called B12b, and I do not know what it is."* A general "add them" is **not** approval for rows Wael has not read. Six rows (B12b–B12g) were minted from findings and all six were deleted.

**Holding-list rule 5 amended — reopening a closed item is Wael's decision, not the session's.** Surface the contradiction with evidence; leave the row alone. Origin: this session read B10x's archived row, concluded from a section heading that it had *"never been closed and never fixed,"* and proposed restoring it. **B10x had shipped.**

---

## ⭐ Three things learned today that were not written down anywhere

**1. There is a better deployment check than the Architecture Reference documents.**

§0d says to confirm from a running container's log line, and correctly warns that the `/` route and the `commit=` marker are April literals proving nothing. **Add to that list: counting `[Boot]` lines.** A three-minute poll returned a stable count of 3 and would have read **identically had nothing deployed at all.**

**What works — decisive and immediate:**

```bash
railway deployment list --service <service> --json
```

It carries `commitHash`, `status` and `createdAt`. Match the hash against what you pushed. Used for both the staging and production deploys today.

**2. Pointing Gate 2 at staging requires swapping four values in `tests/.env`.**

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `TEST_USER_ID` → their `STAGING_*` equivalents. Shell env vars do **not** work — dotenv overrides them (`voice_env.ts` documents that trap in its own header).

**Back the file up first and verify the restore.** The suite performs live deletions before any test runs, and a file left pointing at staging is a silent landmine for every future run. **Read both banner halves** — they must both say STAGING.

**3. Gate 2 has three broken tests, and they are not new.**

`voice-pin.set-with-service-role-succeeds`, `set-rejects-non-4-digit-pin`, `verify-correct-pin-returns-match-true`. The function requires a **6-digit** PIN (`manage-voice-pin:46,161`, `PIN_SET_RE = /^\d{6}$/`); the tests still expect **4**. `tests/catalogue/voice-pin.ts` has not been touched since [[S1]] made that change on 2026-08-19.

**Full Gate 2 result against staging, 2026-08-25:** 51 passed, **0 failed**, 3 errored, 4 correctly skipped. **Wael approved the production promotion knowing the three stand.** They are explained and unrelated — which was deliberately not called "green."

---

## Holding list changes today

- **B11o** — closed, moved to the archive with its full record.
- **B10f** (staging alerts firing late) — **closed on Wael's direct observation**, not on a proven root cause, and the row says so. The T2 cron-auth repair is recorded next to it as **NOT** this item's cause: T2's symptom was alerts not firing *at all*, a month later. **If late firing returns, B10f's own cause is still unknown.**
- **B10c** — rewritten as the **central item for all time issues**. Instance 1 is its original confirm-turn recomputation, preserved verbatim; instance 2 is the 6 PM contradiction found today.
- **F23** — considered for folding into B10c and **rejected**, cross-referenced both ways with the reasoning on each end. B10c collects defects where Naavi states a time *wrongly*; F23 is a coverage gap where she was never taught a city. Folding it in would make B10c permanently unclosable.
- **B12b–B12g** — deleted. Never authorized.
- **The never-delete rule gained its scope:** it covers work that started or has history. **A suggestion that was rejected is deleted outright** — closing it would file it as legitimate finished work, which is a false history.

---

## The pattern worth carrying, which is Wael's

**Four process failures happened in B11o. He caught all four; the process caught none.**

Phase 1A was drafted before Phase 1's own live test had run. No Phase 4 document existed until he asked — *"where is Phase 4"*, the same question he asked during B10m in July, and [[B11x]] skipped it too. Six holding-list rows were created without his approval. A real defect was raised twice as a trailing option and dropped.

**All four are the same shape: something recorded, or asked, in a place where nothing forced it to be acted on.** Three now have mechanical remedies rather than good intentions.

**And the counterweight, also his.** Twice today he refused to accept work that looked finished:

- Offered the no-match guard as "defensive, source-tested, accept it" — **"I want the airbag to work."** Two live attempts could not reach it; it was eventually proven by executing the shipped source against a payload captured live from staging. **An accepted gap would have shipped a guard nobody had ever seen fire.**
- Told that a test had passed, he was told back that it had not tested what it was meant to. **Both times, refusing the comfortable answer produced the real one.**

**A related correction worth keeping:** *"I have no idea about mechanism, I just did what you asked me to do, YOU can check the mechanism."* Two of his calls were spent on a test design that could not reach what it was testing. **Verifying an internal mechanism is not the Product Owner's job.**
