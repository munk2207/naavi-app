# Session Handoff — 2026-08-24, evening

**B11x is fixed and in production.** Three other items were opened, taken too far, and parked on Wael's call.

---

## ⭐⭐⭐ STANDING INSTRUCTION — THE PRIORITY LIST IS THE ONLY WORK

**Wael, closing this session: *"The ONLY work that we will focus on is the priority list."***

That is not a preference for this week. It is the correction for what went wrong tonight, and it binds until Wael says otherwise.

**The only work is the five items in the priority list** — `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, top table.

**Nothing else gets started.** Not the parked items. Not the older B11f / T4 / S1 threads. Not documentation tidy-ups, not memory compaction, not test-tooling improvements, and **not anything discovered along the way.**

### ⭐ What to do when you find something — and you will

Investigating a real bug surfaces other real bugs. That is what happened tonight: one cost question produced B11y, B11z and B12a in a chain, each one genuinely a defect, none of them worth the evening.

**When you find something:**

1. **Write it into the general list** with the evidence, so it is not lost.
2. **Go back to the priority list item you were on.**
3. **Do not open a Phase 0 for it. Do not investigate it "briefly first." Do not fix it because it is small.**

**Finding a defect is not the same as it being worth fixing now.** The general list is where findings go; the priority list is where work happens. If something found is genuinely more urgent than a priority item, **say so to Wael and let him move it** — the list is capped at 5 and moving in means moving something out. That is his call, not the session's.

---

## ⭐ Start here — one check, then the priority list

### 1. The measurement nobody has yet

Open **https://platform.claude.com/usage** — filters `naavi-edge-functions-2026-05`, Model **Haiku 4.5**, **View by Day**.

**Look for the flat line breaking.** Before 8:00 PM EST on 2026-08-24 the hourly bars sat at a steady ~1.21M tokens, overnight included. After it they should drop and become **uneven** — what remains is two people actually using Naavi, which is spiky.

**If it is still flat, B11x did not work** and that matters more than anything else in this document. Every test measured the *mechanism*; this is the only thing that measures the *outcome*.

### 2. Then go to the priority list

`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, top table. Five items, all real user-facing bugs:

| | |
|---|---|
| **B11o** | Deleting a calendar event by phone has never worked |
| **B11l** | "text me" resolves to a stranger, labelled "me" — one keystroke from messaging the wrong real person |
| **B9x** | A location alert meant for someone else silently fires to the user instead |
| **B11m** | Naavi answers "what reminders do I have?" without looking anything up, and got it wrong on a live call |
| **S2** | The PIN cannot tell which of two people sharing a phone is calling |

---

## What shipped

**[[B11x]] — every email was re-sent to Claude on every sync.** All eight governance phases, staging then production.

- **Root cause:** `sync-gmail:362` fires classification on `if (!error && !isMarketing)`, and `!error` is true for an UPDATE exactly as for an INSERT.
- **Fix:** guard the *classifier*, not the caller. `extract-email-actions` is now idempotent per `(user_id, gmail_message_id)`; emails producing no action write a **sentinel row** (`action_type` NULL) where they previously wrote nothing at all.
- **Production:** `extract-email-actions` v33, `backfill-email-actions` v24, 2026-08-24 ~7:12 PM EST. `sync-gmail` untouched.
- **Verified live on production**, not assumed: a real already-classified message returned `{"action":null,"reason":"already_classified"}` and its row was not rewritten.

**Two things a future session must not do:**

1. **Never run `DELETE FROM email_actions WHERE action_type IS NULL` while the fix is live.** It would clear the exact records the guard depends on and silently reinstate B11x.
2. **Widening `ACTIONABLE_KEYWORDS` no longer applies retroactively.** Use the forced backfill path — documented at the array's own declaration, which is where whoever widens it will actually be reading.

Phase documents: `B11X_PHASE0…PHASE8`, all `_2026-08-24.md`.

---

## ⭐ What was parked, and why — do not restart these

Wael, end of session: *"Kill all those and put them in the general pool, we are wasting our time, when we have items on the priority list that are REAL bugs."*

**He was right, and the reason is worth keeping.** The session was asked **one** question — *is my account set up to save money* — and that was answered and shipped as B11x. Everything after it was defects found while looking, each leading to the next:

```
B11x  →  Phase 1A traced sync-gmail's callers   →  B11y
      →  Phase 5 ran the full test gate         →  B11z  →  investigating it  →  B12a
```

**None of the three is a cost item.** Each is real, each is documented, none was worth the evening.

| Item | Stopped at | Why it was parked |
|---|---|---|
| **B11y** | Phase 0 | B11x already removed its cost. Residue is ~5 users of Gmail API calls. Nothing user-visible. |
| **B11z** | Phase 1A (PASS) | A **wording** defect — Naavi names the competitor twice and hedges. No cost or performance impact. |
| **B12a** | not started | A ~3-line test-tooling fix. No user impact. |

**Their phase documents stand — resume from where each stopped, do not re-investigate.**

### Two facts on B11z that must not be lost

1. **It is live on production**, verified by direct call. The public 1-888-91-NAAVI demo line currently tells callers *"I can't verify this from a live source right now"* on an answer Naavi is entirely confident about.
2. **Gate 1 stays red while it is open, so the next production AAB is blocked.** Whoever needs a mobile build has to fix this first. **That is the moment to reprioritise it — not before.**

---

## Corrections made this session, so they are not re-derived

1. **The Architecture Reference said `sync-gmail` was "cron-driven."** It has **five** triggers, two of which silently sync every active user. That one word cost four months and three migrations — every attempt to control this pipeline's cost cut the cron cadence, because the cron is what the map showed. **Now revision 11, §2d.**

2. **A ~$930/month projection was inflated roughly 2× and is corrected at every source.** The 19-hour measuring window also contained this session's own test runs — the 543-case suite twice, plus three trials of a `naavi-chat` test. Actual billing: **$357.68 from 1–24 August ≈ $15/day.** The flat hourly line and the root cause are unaffected; only the size of the prize was overstated.

3. **The credit "emergency" was not one.** Auto-reload was already configured — at $5, top up to $15 — verified in the Console. There was never an outage risk, and the balance had reloaded on its own while it was being described as critical. **Wael was right to challenge the $500 recommendation.**

4. **`AGENTS.md` is deleted and now gitignored.** Deleting it twice did not hold because nothing in this repo creates it — an external agent tool writes it by convention. The gitignore is the enforcement.

5. **Prompt caching is not a cost lever for Naavi and should not be reopened.** `cache_control` is set at every call site; five of six cached blocks sit under Haiku 4.5's 4,096-token minimum and write nothing. No configuration fixes that, and padding prompts to reach it pays the write premium on filler.

---

## The pattern worth carrying forward

**Every genuine defect this session came from running something, not from reading something.**

- B11x's root cause came from reading source — but its *size* only became real when the Console showed a flat overnight line.
- B11y came from a grep that governance **forced**, not from suspicion.
- B11z came from running the full test suite, which nobody would have run for a backend-only change if Rule 15 had not required it.
- The `not_actionable` gap — the one that would have made B11x *look* fixed while the expensive branch kept billing — was caught by **implementation**, not by either review.

**And the counterweight, which is Wael's:** a process that keeps finding things will keep following them. Four items deep, the work had drifted from a cost question to how Naavi words a sentence. **Finding a defect is not the same as it being worth fixing now.**
