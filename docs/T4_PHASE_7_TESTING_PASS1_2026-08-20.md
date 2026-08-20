# Phase 7 — Testing — T4 Pass 1 — Definition Parity

**Date:** 2026-08-20
**Governance version:** v4.0
**Environment:** **staging only** — Naavi Staging (build 327) and the staging voice line `+1 343 504 1572`
**Status:** Plan written. Awaiting Wael's testing.

---

## 1. What actually needs testing, and why it is not obvious

This change added no feature and no screen. Governance's mandatory manual categories — voice, notifications, screen behaviour, permissions — are not directly touched.

**But there is one real risk, and only a human using the product can find it.**

Staging now **rejects** rows it used to accept: 19 columns became `NOT NULL`, six of them `user_id`. If any code path has been quietly saving a row without one of those values, **it will now fail** — and Gate 1's 512 tests did not catch it, because they passed with zero failures.

**The valuable inversion:** production has enforced these constraints all along. So if something breaks on staging now, **it has been broken on production the whole time** and nobody knew. A failure here is not a regression caused by this work — it is a pre-existing production bug this work made visible.

That is what Phase 7 is looking for.

## 2. What automated testing already covered

Gate 1, full run against staging: **512 tests, 507 passed, 0 failed.** No test in the suite writes a row missing one of the tightened values.

Manual testing covers the paths the harness does not reach — the real app, saving real things.

## 3. The tests — each one is just "use the product"

Every test writes to a table this migration tightened. **Passing means it saves without an error.**

| # | Do this | Writes to | Now enforced |
|---|---|---|---|
| **T1** | **Add a contact** in the app — a name and a phone number | `contacts` | `name`, `user_id` |
| **T2** | **Save a note** — three-dot menu → Notes, or ask Naavi to remember something as a note | `naavi_notes` | `title`, `user_id` |
| **T3** | **Set a reminder** by voice — *"remind me to call the dentist tomorrow at 3"* | `reminders` | `datetime`, and `user_id` now defaults |
| **T4** | **Create a calendar event** — *"put dentist Friday at 4 in my calendar"* | `calendar_events` | `title`, `user_id`, `google_event_id` |
| **T5** | **Ask Naavi to remember something** — *"remember my wife's birthday is April 15"* | `knowledge_fragments` | `type`, `content`, `user_id`, `source`, `classification` |
| **T6** | **Open the app and let it sit a minute**, then check email search works | `gmail_messages` | `user_id`, `gmail_message_id` |
| **T7** | **Confirm notifications still register** — open the app fresh; if it asks about notifications, allow | `push_subscriptions` | `endpoint`, `auth`, `p256dh`, `user_id` |

**T5 is the one I would watch hardest.** `knowledge_fragments` had *five* columns tightened, more than any other table — including `classification` and `source`, which now also carry defaults. If anything saves a fragment without setting those, it fails now.

## 4. What a failure looks like, and what it means

**You would see:** Naavi saying she could not save something, an error in the app, or an action that silently does not appear afterwards.

**If that happens, do not work around it — tell me what you did.** It is likely a genuine defect in a write path that has been failing on production all along, and finding it is worth more than this migration was.

**It is not:** something to be fixed by loosening the constraint back. Production enforces it; staging matching production is the correct state.

## 5. Production is not being tested, deliberately

The migration was a **no-op on production** — proven, zero rows changed. Nothing there behaves differently than it did this morning, so there is nothing new to test.

## 6. Results

| Test | Result | Notes |
|---|---|---|
| T1 contact | | |
| T2 note | | |
| T3 reminder | | |
| T4 calendar event | | |
| T5 remember | | |
| T6 email | | |
| T7 notifications | | |

## 7. Not authorized by this phase

Phase 7 passing does not close Pass 1 — Phase 8 does, on Wael's own word. And Pass 1 closing does not complete T4: **T5 and Pass 2 remain open.**
