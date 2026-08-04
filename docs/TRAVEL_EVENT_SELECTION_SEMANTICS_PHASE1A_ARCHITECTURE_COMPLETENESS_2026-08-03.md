# Travel Event Selection Semantics (Ticket B) — Phase 1A — Architecture Completeness Review

**Date:** 2026-08-03
**Governance version:** v4.0
**Phase 1:** Closed, APPROVED — `docs/TRAVEL_EVENT_SELECTION_SEMANTICS_PHASE1_PROBLEM_DEFINITION_2026-08-03.md`
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, **Architecture Version 2026.07.18.4**, Last Verified 2026-07-18 — confirmed this is still the most recently dated file of this name; no newer revision exists.

## Answers to the mandatory Phase 1A questions

**What is the architectural owner of the affected capability?**
Two capabilities are in play, each with its own owner per Architecture Reference §2:
- RULE 7 (the event-selection reasoning itself) → `get-naavi-prompt` — row "Claude system prompt (non-classifier)."
- The live calendar fetch feeding RULE 7 → row "Calendar — reads (live event fetch)."

**Is the capability Shared Core, Duplicated, or Platform-specific?**
- RULE 7 → **Shared Core.** Genuinely shared — voice fetches the same Edge Function live, same bytes mobile uses.
- Live calendar fetch → **Duplicated.** `naavi-chat` and the voice server each independently call the Google Calendar API and independently sort/filter the result. No shared implementation.

**If duplicated, were all documented implementations investigated?**
No — one of the two was live-behaviorally tested; both were freshly code-verified.

**Which implementations were investigated, and which were not:**
- **`naavi-chat`'s `fetchLiveCalendarEvents`** (`supabase/functions/naavi-chat/index.ts:876-1074`) — **Freshly verified this session, both ways:** code read (sort at line 998, past-event filter at line 1032-1044) AND live-behaviorally tested (8+ trials each on "next event"/"next meeting"/"next appointment", `scripts/diag-calendar-context-controlled-trials.js`, `scripts/diag-b-next-event-extra-trials.js`, Phase 1 evidence).
- **`naavi-voice-server`'s `fetchLiveCalendarEvents`** (`naavi-voice-server/src/index.js:845-944`) — **Freshly verified this session, code only.** No live phone call was made as part of this investigation (Phase 0 scoped voice's live behavior out; that scoping is revisited below, not silently accepted).

**New finding from this fresh code verification, not previously documented anywhere in this project's records:** voice's `fetchLiveCalendarEvents` sorts chronologically (line 916, matching mobile's approach) but **has no equivalent to mobile's past-event filter.** Mobile's version explicitly drops any event whose start has already passed (`naavi-chat/index.ts:1032-1044`, with its own comment explaining this was done specifically to make "next meeting" deterministic). Voice's version (lines 909-936) sorts and deduplicates but never filters by current time — every event in the 7-day window is passed to Claude regardless of whether it already started.

**Stated precisely (Wael's Phase 1A review, 2026-08-03):** what is proven is that voice supplies Claude with a larger candidate set, because past events are not filtered server-side the way mobile's are. Whether this results in observable non-determinism on voice has not been tested and remains a separate, unverified question — not claimed here as "more exposure to the same mechanism."

**Does the documented problem scope match the Architecture Reference?**
Yes. Both rows above (Shared Core prompt, Duplicated calendar reads) match current code exactly — no drift found between the Reference's 2026-07-18 classification and today's fresh checks.

**Is any documented implementation excluded from investigation?**
Yes, explicitly, not silently: **voice's live behavioral testing remains excluded from this ticket's scope.** This is a deliberate declaration, not an oversight — justification below.

## Architecture Scope Rule / Cross-Repository Verification — explicit disposition

- RULE 7 fix (Phase 2, Problem A — determinism): **will land on voice automatically**, since RULE 7 is genuinely Shared Core. No separate voice implementation to change for this half.
- Voice's missing past-event filter: **a real, freshly-found, voice-specific gap in the Duplicated live-fetch implementation** — not the same defect as Ticket B's root cause (that one is a redundant-reasoning problem on top of an already-correct filter; voice never had the filter to be redundant with). Recommend **not** folding this into Ticket B — it's a different-shaped defect in a different owning implementation, and pulling it in would blur two distinct root causes into one change plan, which is exactly the kind of scope creep this project's own governance history (Tickets A/B/C's deliberate split, the phone-collision finding spun out separately) has repeatedly avoided for good reason.
- **Recommendation:** open this as its own, separately tracked item — "Voice's live calendar fetch has no past-event filter, unlike mobile's" — flagged now, not fixed now. Given RULE 7's Phase 2 fix will already reduce how much unaided reasoning Claude needs to do, this voice-specific gap may become lower-priority once Problem A's fix ships; worth re-assessing after Phase 2 lands rather than pre-judging its severity today.

## Independent Review Rule — both reviews

1. **Technical Investigation Review (Phase 1):** Passed — closed, APPROVED by Wael 2026-08-03, root cause proven with file:line citations, wording corrected per review.
2. **Architecture Completeness Review (this document):** Passed, with one explicit, justified exclusion (voice live-behavior testing) and one new finding surfaced rather than silently absorbed (voice's missing past-event filter).

Both reviews now pass — Phase 1 overall approval recommendation stands.

## Recommendation

**Phase 2 scope statement (Wael's exact wording, 2026-08-03 — binding for Phase 2):** Eliminate redundant event re-selection inside RULE 7 so Claude uses the server's already-determined chronological ordering. No semantic changes to "meeting," "appointment," "class," or other event categories are authorized under this ticket.

Phase 2's Change Impact Matrix should note RULE 7 is Shared Core (touches voice automatically) but the fix itself only needs implementing once, in `get-naavi-prompt`. Spin out the voice past-event-filter gap as its own follow-up item (`task_2e209a35`), not part of this change plan.

## Wael's Phase 1A Review — 2026-08-03 — APPROVED

"One of the cleanest investigations in the A/B/C series" — maintained strict separation between Shared Core (RULE 7), Duplicated implementation (mobile vs. voice fetch), observed behavior, and unverified architectural differences. Two editorial refinements applied above (Phase 2 scope statement tightened to explicitly forbid semantic changes; voice non-determinism claim softened to what was actually proven).

---

**Status:** Phase 1A CLOSED — APPROVED by Wael 2026-08-03. Proceeding to Phase 2, bound by the scope statement above.
