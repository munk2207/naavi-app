# Travel Event Selection Semantics (Ticket B) — Phase 3 — External Technical Review Package

**Date:** 2026-08-03
**Governance version:** v4.0
**For:** External Technical Reviewer (ChatGPT), per governance §1 and §3 Phase 3.
**Prior phases (full detail on request):** Phase 0 (Intent), Phase 1 (Problem Definition), Phase 1A (Architecture Completeness), Phase 2 (Change Plan) — all in `docs/TRAVEL_EVENT_SELECTION_SEMANTICS_PHASE*_2026-08-0[2-3].md`.

This package is a condensed submission per governance §14's Cost-Aware AI Collaboration.

## What's broken

Two related but distinct behaviors in RULE 7's event-selection reasoning (`get-naavi-prompt/index.ts`), live-tested against staging today with a real, correctly-synced calendar (8 trials per key phrase, fresh conversation each time):

1. **Non-determinism.** "Drive me to my next event" — no type-semantics involved — selected the correct, chronologically-earliest event 6/8 trials and an incorrect, later event 2/8 trials. Same underlying data every call.
2. **An undocumented type filter.** "Drive me to my next appointment" consistently (8/8) skipped a chronologically-earlier "meeting"-titled event in favor of a later "appointment"-titled one — a real, reproducible distinction RULE 7's text never asks for.

## Root cause (proven for #1, one inferential step for #2 — see Phase 1's exact wording)

`naavi-chat/index.ts:998-1044` (`fetchLiveCalendarEvents`) already sorts events chronologically and drops past events **in code**, before Claude ever sees them — confirmed by the function's own comment: *"Doing it server-side makes 'next meeting' answers deterministic."* RULE 7 (`get-naavi-prompt/index.ts:699`, `:719-729`) nonetheless re-instructs Claude to independently re-walk, re-parse, and re-compare every event's start time and re-derive "the earliest" itself — duplicating work already done correctly in code. This redundant re-derivation is the proven mechanism for the non-determinism (LLM re-parsing isn't guaranteed reproducible) and is the most likely origin of the type-filtering side effect (the redundant reasoning step creates room for an interpretive move RULE 7 never asked for) — stated as inference for that second half, not direct proof, per Wael's own Phase 1 correction.

## Proposed fix (single file, no alternatives rejected — the narrowest possible framing was reached directly)

Rewrite RULE 7's Step 0 and "NEXT / UPCOMING / SOONEST" sections in `get-naavi-prompt/index.ts` to state explicitly that the `## [user]'s upcoming schedule` list is already sorted chronologically ascending with past events already removed, and that for unnamed "next"/"soonest"/"upcoming" phrasing, Claude must take the list's first entry directly — no independent re-parsing, re-comparing, or re-filtering. Stated as a positive rule: **event selection for unnamed "next" requests is based solely on the chronological order of the supplied schedule; event title, category, or inferred event type must not override the first entry in that ordered list.** The existing named-event branch ("the one the user named, if specific") is explicitly unchanged.

**Product-scope boundary, decided by Wael, not open for this review to revisit:** no semantic event-type matching ("next appointment" ≠ "next meeting") is authorized under this ticket. Simpler was chosen deliberately over "smarter."

## Architecture position (Phase 1A, freshly verified this session)

- RULE 7 itself → `get-naavi-prompt` — **Shared Core**, genuinely shared (Architecture Reference §2, version 2026.07.18.4, confirmed current). Both mobile and voice consume the identical prompt live — this single-file fix reaches both without either consumer's own code changing.
- The live calendar fetch feeding RULE 7 → **Duplicated** (`naavi-chat` and voice server each independently implement). Untouched by this fix; already proven correct on mobile's side (Phase 1); voice's side has its own, separately-tracked gap (no past-event filter at all — `task_2e209a35`), explicitly out of scope here.
- Checked for hidden duplicates before finalizing scope: mobile's fallback (`lib/naavi-client.ts`, "RULE 4 — TRAVEL TIME") and voice's fallback (`naavi-voice-server/src/index.js:1970-1972`, "RULE 7 — TRAVEL TIME") were both read in full — **freshly verified this session** — neither contains the walk/parse/compare/pick-earliest logic being fixed; both are short generic instructions. No changes needed there; this is not a silent gap, it was checked and ruled out.

## Isolation / hidden coupling

RULE 7 is one instruction block inside one large shared prompt. The named-event branch shares the same "Step 0" numbering as the unnamed branch being changed — the plan explicitly preserves that branch's wording untouched, and Phase 2 added a dedicated regression test ("Drive me to Team standup" against an ordered schedule including an earlier "Gym class") specifically to catch any accidental bleed between the two branches. No other RULE in the prompt references event ordering or "next" semantics.

## Assumptions this plan is making (please stress-test these)

1. That telling Claude to trust an already-correct pre-sorted list, rather than re-deriving order itself, is sufficient to eliminate the observed non-determinism — vs. some other mechanism (e.g., structured tool output, deterministic pre-selection in code before Claude is invoked at all) being more reliable. The current plan stays prompt-only per the Medium-risk, single-file framing Phase 2 established; open to challenge if the reviewer believes prompt instructions alone can't reliably suppress this class of LLM behavior.
2. That stating the chronological-order rule as a positive instruction (rather than a negative "don't do X" prohibition) is sufficient to prevent the model from still applying semantic type-matching out of habit, given it isn't proven why the model does this today (Phase 1's acknowledged inferential step).
3. That no other RULE elsewhere in the shared prompt independently instructs event-type interpretation that could re-introduce this behavior through a different path — not exhaustively re-verified this session beyond confirming RULE 7 itself is the only place event-selection logic for travel-time requests lives.

## Evidence plan (Phase 2, three regression tests, minimum 3 trials each per Non-Determinism Rule)

1. Deterministic first-entry selection — repeated "next event"/"next meeting" trials against a fixed schedule always select the earliest qualifying entry.
2. Negative semantic control — no event-type matching for unnamed "next" requests.
3. Named-event boundary test — "Drive me to Team standup" against an ordered schedule (Gym class, Team standup, Dentist) selects Team standup, not the chronologically-first entry.

## Implementation authorization boundary

Staging deployment only, matching this session's established staging-first discipline. Production is explicitly out of scope for this authorization pending completed staging evidence and Wael's own separate approval.

## What we're asking you to evaluate

Per governance §3 Phase 3 and §13 Gate 3/4: the assumptions above, architecture correctness (Shared Core / Duplicated framing, fallback exclusion), isolation/hidden coupling (named-branch preservation), and implementation strategy (prompt-only positive-rule fix vs. any stronger enforcement mechanism you'd recommend). Please conclude with one of the three permitted decisions (Approved / Approved with Mandatory Changes / Rejected) and, if not Rejected, the Implementation Boundaries Confirmed statement per §3 Phase 3.

---

## Reviewer Decision — received 2026-08-03 — APPROVED WITH MANDATORY CHANGES

**Critical issue identified, confirmed accurate:** the proposed "take the first entry directly" instruction is safe for mobile (guaranteed sorted + past-filtered) but not for voice (sorted, but never past-filtered per Phase 1A) — the shared prompt change could cause voice to select a past event simply because it sorts first. Mandatory: choose a safe design before coding — either (1) add the same past-event filtering guarantee to voice's fetch, or (2) mark the calendar context as sorted-and-past-filtered and gate RULE 7's first-entry trust on that marker being present. Minimum 3 trials required for: unnamed-next selects first valid future event; appointment/meeting wording doesn't override chronological order; named-event request still selects the named event; voice does not select an already-started event.

**Resolution — Wael's decision, 2026-08-03:** Option (1) is explicitly out of scope ("forget about voice, we do not have a solution for it"). Adopting Option (2), marker-gated trust — full design in the Phase 2 Revision, `docs/TRAVEL_EVENT_SELECTION_SEMANTICS_PHASE2_CHANGE_PLAN_2026-08-03.md`. Voice requires zero code changes under this design: it never emits the marker (its own calendar-context code is untouched), so RULE 7 automatically falls back to today's existing, unmodified instructions for voice — the reviewer's fourth required test ("voice does not select an already-started event") is satisfied by construction, since voice's behavior doesn't change at all, not by a new voice-side filter.

**Implementation Boundaries now confirmed, per the revised design:** `get-naavi-prompt/index.ts` (RULE 7, marker-gated conditional) and `naavi-chat/index.ts` (one conditional marker string in the existing schedule-header logic). No voice files. No other files. Staging only, per the original authorization boundary.

---

## Reviewer Decision on Resubmission — received 2026-08-03 — APPROVED WITH MANDATORY TEST CLARIFICATION

**Confirmed a valid, scope-controlled solution.** The marker-gated design resolves the original concern without modifying voice: mobile emits the marker only when its schedule is confirmed sorted and past-filtered; RULE 7 trusts the first entry only when that marker is present; voice emits no marker and remains on the existing selection instructions.

**Mandatory clarification, accepted and applied:** do not state voice safety is "proven by construction" until the marker-absent branch is actually tested. RULE 7 is still one shared, edited prompt — the test must confirm the marker-absent branch preserves the *previous* behavior rather than accidentally inheriting the new first-entry instruction. The Phase 2 Revision's regression test list was corrected accordingly — the earlier "by construction" wording is retracted, replaced with a live-tested requirement.

**Required staging tests (now Phase 2's canonical test list, min. 3 trials each):**
1. Marker present — unnamed "next" selects the first supplied event.
2. Marker present — "meeting"/"appointment" wording does not override chronological order.
3. Marker present — a named event still selects the named event.
4. Marker absent — RULE 7 does not use the new first-entry shortcut.
5. The marker is emitted only by `naavi-chat` after its own sort-and-past-filter step.

**Implementation Boundaries Confirmed:**
- `supabase/functions/get-naavi-prompt/index.ts` — marker-gated RULE 7 instructions.
- `supabase/functions/naavi-chat/index.ts` — conditional marker in the existing calendar-context header.
- Required regression tests under `tests/catalogue/`.
- No voice-server changes. Staging deployment only.

**Authorized next step (reviewer):** Phase 4 implementation, after the marker-absent regression test is incorporated into the plan — done, above.

---

**Status:** Phase 3 CLOSED — Approved with Mandatory Test Clarification, applied. Per governance §3's Phase-Gate Approval Rule, this reviewer verdict is not itself authorization to begin Phase 4 — awaiting Wael's own separate, explicit go-ahead.

---

## Phase 3 Resubmission — 2026-08-03 — Deterministic Pre-Selection Redesign

**Why this reopens Phase 3, not just Phase 4:** the marker-gated design above was implemented, approved, deployed to staging, and then failed its own Phase 7 live validation — "next event" correctly took the literal first entry, but "next meeting" and "next appointment," asked within a minute in the same live conversation, both skipped it for a type-matching guess. The explicit prohibition in RULE 7 isn't reliably suppressing this for those two words. Wael's decision: stop relying on prompt compliance for this specific decision; move it to deterministic code. Full design in the Phase 2 REOPENED section, `docs/TRAVEL_EVENT_SELECTION_SEMANTICS_PHASE2_CHANGE_PLAN_2026-08-03.md`.

**What's broken (the thing the new design fixes):** for unnamed "next"/"soonest"/"upcoming" travel-time requests, event selection currently depends on Claude following a textual instruction not to apply semantic type-matching. Live-proven: it doesn't, for at least two of the three tested words.

**Proposed fix:** a new deterministic classifier and early-return bypass in `naavi-chat/index.ts`, modeled directly on the existing "B6e bypass" (`:2070-2110`, shipped 2026-05-26) — which already intercepts a different calendar question ("what's on my calendar this week") before Claude for the identical reason: Claude was proven unreliable at a task the server could just compute. The new bypass: detect unnamed "next"-travel-time phrasing, take the already-sorted-and-filtered live fetch's first entry directly in code, resolve its address (`location` falling back to `description` — also fixes B11a for this path), and either return a deterministic travel-time response or a deterministic "I don't have an address" response — no LLM call for this request shape at all.

**Architecture position:** `naavi-chat` is Mobile's entry point into Shared Core — this bypass is entry-point-side logic (a routing/formatting decision, same category as the existing B6e bypass), not new business logic invented outside the established pattern. Named-event travel-time requests are explicitly excluded from the new classifier and remain with Claude, unchanged. Voice is untouched — it doesn't call `naavi-chat`, and the marker-gated RULE 7 fix stays live for it, per the standing "forget about voice" decision. `get-naavi-prompt/index.ts` is not further modified in this round.

**Isolation / hidden coupling:** the new classifier must not overlap with the named-event branch, the existing B6e calendar-read classifier, or `LIVE_CALENDAR_RE` in a way that double-handles or misroutes a request — needs explicit non-overlap verification in Phase 4 evidence, the same discipline B6e's own classifier already demonstrates is achievable in this file.

**Assumptions to stress-test:** (1) that a regex-based classifier can reliably distinguish "next meeting" (unnamed) from "Team standup" (named) — the existing named-event branch and RULE 7's own STEP 0 already draw this line in the prompt; the new classifier must draw it the same way in code. (2) That bypassing Claude entirely for this request shape doesn't lose any desirable behavior Claude currently provides beyond event selection (e.g., natural phrasing) — mitigated by keeping the speech template simple and echoing the user's own word ("meeting"/"event"/"appointment") rather than inventing new phrasing.

**Evidence plan:** deterministic equality assertions (not probabilistic 3-trial checks) — repeated calls with identical input must produce byte-identical output, by construction. Plus the address-fallback test and the no-address-found test.

**Implementation authorization boundary:** staging only, same as before.

---

## Reviewer Decision on Deterministic Redesign — received 2026-08-03 — APPROVED WITH MANDATORY CHANGES

**"Architecturally stronger than the previous solution."** Deterministic work belongs in deterministic code; the server now decides, Claude only speaks. Root cause addressed (Claude removed from this decision entirely, not just given a stronger instruction), extends the existing B6e pattern rather than inventing a new one, and — despite adding code — actually *reduces* runtime uncertainty (`server chooses event → travel` vs. the old `server → Claude chooses event → travel`).

**Mandatory changes, all applied to the Phase 2 doc above:**
1. **Classifier specified explicitly** — exact intercept/do-not-intercept examples added, not left as a general description.
2. **Single owner for event selection** — explicit statement added: deterministic path owns unnamed requests, Claude owns named requests, no overlap, never performed twice.
3. **Regression tests tightened** — unnamed next event/meeting/appointment must return the identical selected event (hard equality, not probabilistic), plus a named-event-still-works test.
4. **Single source of truth** — explicit statement added: the deterministic path consumes `fetchLiveCalendarEvents`'s existing ordered result as-is, no additional sort or filter logic, no duplicated logic.

**Risk:** Medium retained (Protected Core), though the reviewer noted the redesign is actually lower runtime risk than the marker-gated version despite adding code.

**Implementation Boundaries Confirmed:** deterministic unnamed-event classifier in `naavi-chat`, deterministic first-event selection using the existing ordered list, travel-time response generation for this path, regression tests. No changes to voice, Google fetch logic, calendar sorting, named-event handling, or production deployment. On the RULE 7 boundary wording specifically — clarified in the Phase 2 doc that RULE 7 is not being edited at all in this round, to avoid any voice regression; see that doc for the full reasoning.

**Reviewer's overall ranking of all three approaches considered this ticket:** prompt-only rule (failed live validation) < marker-gated prompt (better, still relied on LLM compliance) < deterministic pre-selection (best architecture, recommended for implementation).

---

**Status:** Phase 3 CLOSED — Approved with Mandatory Changes, all applied. Per governance §3's Phase-Gate Approval Rule, this reviewer verdict is not itself authorization for Phase 4 — awaiting Wael's own separate, explicit approval.
