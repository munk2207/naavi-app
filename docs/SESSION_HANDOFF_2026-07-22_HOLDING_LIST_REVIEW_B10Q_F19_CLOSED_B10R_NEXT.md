# Session Handoff — 2026-07-22

**Read this first, then `MEMORY.md`'s index.**

This session was a holding-list review — walking the open queue item by item, verifying claims against actual code and Wael's own live tests (not just trusting the doc), closing what's genuinely done, correcting fix directions where investigation was the wrong approach, and cleaning up stale bookkeeping. No new bugs were coded/fixed this session; this was audit + doc hygiene + one small investigation (the `useOrchestrator.ts` audit).

---

## Closed this session

### B10q — CLOSED, production, real live-call retest passed

Confirmed fully live end-to-end (mobile, voice, shared prompt) in production as of 2026-07-22 deployment (carried over from 2026-07-21 work). Wael's own live-call retest passed. Moved from Open Bugs to Closed Bugs table — the row had been sitting in Open with a stale "awaiting Phase 2 go-ahead" status despite already being deployed and tested.

### F19 — CLOSED (Track C was the last open piece)

Track C (mobile production promotion, build 311 + 3 dependent Edge Functions) closed 2026-07-21 but the F19 row itself was never updated to reflect it — found stale during this session's review, not self-caught at the time. Moved from Open Features to Closed Features.

### T1a — confirmed already correctly filed

Was flagged for a "move to closed" at the start of the session, but on inspection it was already correctly sitting in the Closed Tooling table. No action needed — false alarm caught before any edit.

### Tier 3 item #4 (confirmation-speech gaps / silent alert replacement) — CLOSED, contradicted by Wael's live test

Investigation initially found voice explicitly asks before re-enabling a disabled location alert, while mobile's code (`hooks/useOrchestrator.ts` `commitPending`) appeared to silently re-arm and only disclose after the fact. **Wael's direct mobile test contradicted that reading twice** — he was asked and answered no, then deleted the alert instead. Per "user test is ground truth," closed without further code investigation. Reopen if it resurfaces with new evidence.

---

## Real finding this session: F5c reopened

The Tier 2 audit item ("audit `hooks/useOrchestrator.ts` against B9z's, B10a's, and F5c's defect classes") was done — after the fact, since F19 Track C's production promotion had already shipped before this audit ran (noted, not re-litigated).

Results:
- **B9z** — not applicable to mobile. The fix was a DB-constraint-level change, covers all write paths automatically.
- **B10a** — mobile does NOT have voice's ordering bug. `hooks/useOrchestrator.ts:3406-3480` resolves the named recipient *before* the B4y self-default fallback, and hard-stops on an unresolved name rather than falling through to self.
- **F5c — real gap found.** Mobile's own create-time task-resolution code (`resolveTaskActions()` in `hooks/useOrchestrator.ts:66-90`, literally tagged `[F5c]` in its own logs) calls `lookupContact()` (`lib/contacts.ts:94-126`), which reads Google's single pre-picked "best guess" contact and never checks for multiple ambiguous matches. Same defect class as the original F5c bug (silently guessing instead of refusing), in a different code path the original fire-time fix never reached. **Folded into F5c as a reopened addendum** rather than a new ID — see the Closed Features table entry for full detail. Not yet fixed, no Phase 1 written.

---

## Fix direction changed: B9y

Wael's explicit call: stop trying to root-cause the STT digit mis-hearing itself — not productive, especially on voice. **New fix direction:** Naavi reads the captured phone number back digit-by-digit and requires an explicit yes/no before saving, so a mis-heard digit is caught at confirm time instead of landing silently wrong. Updated in both the priority-queue bullet and the table row. No Phase 1 written yet.

---

## Promoted: I5a → F22

Wael's explicit call: the List/Alert management gaps item (add items to a list from its details screen, navigate from an alert's "ATTACHED LIST" chip into that list, other gaps TBD) is "much more than an idea, it is a real function" and shouldn't stay hidden in the Ideas table. Renamed I5a → **F22**, moved from Ideas (Deferred) to Features (F) — OPEN, and added to the Tier 3 priority queue so it's visible for work ordering. Still not scoped in detail — needs its own Phase 1 to nail down the full set of management gaps before any code.

---

## Priority assessment given this session (Wael's own framing, confirmed)

B10r ranks above B9x/B10s/F5c's reopened gap because it presents **wrong information as fact** directly to Wael (a fabricated birth year), which is a trust violation in its own right — distinct from and worse than the other bugs, which are **functions silently failing to execute** (a message that should send doesn't). Misinformation presented as fact undermines trust in everything else Naavi says; a missing action is a narrower, more contained failure.

---

## Demo Mode removal (from earlier in session, still holding)

- **Client-side** (settings UI, orchestrator, helpers) — committed and pushed to `naavi-app` (`bab9e5d`), **held for the next APK build/submit**, not yet built.
- **Server-side** (`naavi-chat`) — committed, pushed, deployed to **both staging and production** (production deploy happened this session).

---

## ⭐⭐⭐ NEXT SESSION — start with B10r, and ONLY B10r

Reaffirmed by Wael 2026-07-22 as sole top priority (B10q, which shared the top slot with it, is now closed). **No Phase 1 written yet.**

### B10r — Naavi shows a fabricated birthday/anniversary year as fact

Live evidence: Fatma Elmehelmy's real Google Contact shows birthday Jan 15 **1948** and anniversary Dec 8 **1982**; Naavi's "Tell me about Fatma" answer showed "Jan 15, **2027**" / "Dec 8, **2026**" — month/day correct, year is Google Calendar's computed next-occurrence, presented with no indication it's a recurring/computed date.

Root cause of the exact phrasing: `get-naavi-prompt/index.ts:565`'s own worked example teaches Claude this "Name's birthday — Month Day, Year" format, including the misleading computed year.

**Fix direction (discussed, not yet formalized):** don't patch the Calendar adapter's output — extend the Contacts adapter (`global-search/adapters/contacts.ts:146`, `lookup-contact/index.ts`) to request the `birthdays` personField directly from Google People API (neither currently requests it). More reliable than the Calendar approach (the "populate calendar from contacts" setting is user-configurable and can silently break the Calendar path) and more accurate (shows the true origin data, no year-computation needed). Connects to CLAUDE.md Rule 18 (Naavi has no authority to reformat facts).

**Governance: Full Phase 1-8** (Calendar integration, Protected Core).

### After B10r

Holding list's own priority queue (`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`) is the single source of truth for what comes next — do not re-derive from memory. As of this session's cleanup, remaining Tier 1 items are B10m (Deepgram total-silence hang, escalated to Deepgram, awaiting their response) and B4b (blocked behind B10m). Tier 3 has B10c, B9a, B9m, B9y (new fix direction), B9x, B10s, and the reopened F5c gap, plus the newly-added F22.
