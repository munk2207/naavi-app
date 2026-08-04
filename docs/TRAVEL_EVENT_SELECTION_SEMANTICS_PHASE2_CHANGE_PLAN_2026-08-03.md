# Travel Event Selection Semantics (Ticket B) — Phase 2 — Change Planning

**Date:** 2026-08-03
**Governance version:** v4.0
**Phase 1A:** Closed, APPROVED — `docs/TRAVEL_EVENT_SELECTION_SEMANTICS_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-08-03.md`

**Binding scope statement (Wael, Phase 1A):** Eliminate redundant event re-selection inside RULE 7 so Claude uses the server's already-determined chronological ordering. No semantic changes to "meeting," "appointment," "class," or other event categories are authorized under this ticket.

No code written in this phase.

## Files that will change

**One file only** — verified directly this phase, not assumed:

| File | Classification |
|---|---|
| `supabase/functions/get-naavi-prompt/index.ts` (RULE 7's Step 0, `~line 699`, and the "NEXT / UPCOMING / SOONEST" section, `~lines 719-729`) | Shared Logic / Backend (prompt template text) |

**Explanation of the modification:** RULE 7 currently re-instructs Claude to independently walk every event, parse its start time, compare it to the current time, and pick the earliest — even though `naavi-chat/index.ts:998-1044` has already done exactly this in code (sort + drop-past-events) before the list ever reaches Claude. The fix: rewrite RULE 7's Step 0 and NEXT/UPCOMING/SOONEST instructions to state explicitly that the `## [user]'s upcoming schedule` list is already sorted chronologically ascending with past events already removed, and that for "next"/"soonest"/"upcoming"/"navigate-to-next" phrasing with no specific event named, Claude must take the list's first entry directly — no independent re-parsing, re-comparing, or re-filtering. The existing named-event branch ("the one the user named, if specific") is unchanged — that logic is not part of this defect. The new instruction will also state, as a positive rule rather than a prohibition (Wael's Phase 2 review, 2026-08-03): **for unnamed "next" requests, event selection is based solely on the chronological order of the supplied schedule; event title, category, or inferred event type must not override the first entry in that ordered list.** This operationalizes Wael's Problem B decision as an actual model instruction, not left as an implicit hope that removing the redundant reasoning alone suppresses it.

## Second location checked and ruled out — not a silent omission

Two other places carry independent copies of a "travel time" rule and were checked directly this phase, not assumed to be safe: `lib/naavi-client.ts` (mobile's fallback `buildSystemPrompt`, "RULE 4 — TRAVEL TIME") and `naavi-voice-server/src/index.js:1970-1972` (voice's fallback `buildVoiceSystemPrompt`, "RULE 7 — TRAVEL TIME"). Both were read in full. **Neither contains the elaborate step-by-step event-selection logic found in the canonical prompt** — both are short, generic "if asked about travel time, emit FETCH_TRAVEL_TIME" instructions with no walk/parse/compare/pick-earliest algorithm at all. Since the defect being fixed doesn't exist in either fallback, **no changes to those two files are needed for this ticket.** (This differs from CLAUDE.md's general "keep fallbacks in sync" guidance, which applies when a fix changes behavior the fallback also implements — here the fallback never implemented this behavior to begin with, so there's nothing to bring back into sync.)

## Risk classification: Medium

Not Low: this is Protected Core (Calendar integration) and takes effect immediately, live, on both mobile and voice simultaneously the moment it's deployed (Shared Core prompt, fetched fresh by both). Not High: it is a narrowly-scoped, prompt-only text change — no new code path, no schema change, no new dependency — with a well-understood, already-proven-correct data layer underneath it (Phase 1), and trivial rollback (revert the prompt's `PROMPT_VERSION`). Medium requires Phase 3 external review before coding, per governance — will be requested next.

## Planned regression tests (`tests/catalogue/calendar.ts`)

1. **Deterministic first-entry selection** — repeated "next event"/"next meeting" trials against a fixed, ordered schedule always select the first (chronologically earliest) qualifying entry.
2. **Negative semantic control** — confirms no event-type/category matching is applied for unnamed "next" requests (locks in Wael's Problem B decision at the test level, not just the prompt level).
3. **Named-event boundary test (added per Wael's Phase 2 review, 2026-08-03):** given an ordered schedule (e.g., 1. Gym class, 2. Team standup, 3. Dentist), a specific-name request — "Drive me to Team standup" — must select Team standup, not the chronologically-first entry (Gym class). This confirms the unnamed-branch simplification does not regress the separate, unchanged named-event branch.

## Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | Yes | Behavior change for any "next X" travel-time question via mobile chat. No mobile app code changes — the app fetches the same shared prompt live. |
| Voice | Yes | Same behavior change, same mechanism — voice fetches the identical shared prompt live (`naavi-voice-server/src/index.js:1883`). No voice code changes required (fallback ruled out above). |
| Shared Core | Yes | The only file being edited — `get-naavi-prompt/index.ts`. |
| Database | No | No schema, table, or migration changes. |
| Cron | No | Not touched. |
| API contracts | No | No request/response shape changes to any Edge Function. |
| Tests | Yes | `tests/catalogue/calendar.ts` gets new/updated regression tests (Rule 15a): deterministic first-entry selection, a negative control confirming no semantic-type behavior was (re)introduced, and a named-event boundary test (below). |

**Duplication note (Architecture Scope Rule):** The live calendar fetch itself (`naavi-chat` vs. voice's own `fetchLiveCalendarEvents`) remains Duplicated and is untouched by this change — this fix lives entirely in the Shared Core prompt layer sitting above both duplicated fetch implementations, so both consumers inherit the corrected reasoning without their own fetch code needing to change. Voice's separately-tracked gap (missing past-event filter, `task_2e209a35`) is explicitly out of scope here, per Phase 1A.

## Mandatory Architecture Impact Checklist

- Does this change modify Shared Core? **Yes** — `get-naavi-prompt/index.ts`.
- Does this change modify an Entry Point (mobile or voice translating logic)? **No.**
- Does this change introduce new duplication? **No.**
- Does this change eliminate existing duplication? **No** — the live-fetch duplication is a separate, untouched concern.
- Does this change modify Protected Core? **Yes** — Calendar integration (per governance §4's Protected Core list), which is why full Phase 1-8 with mandatory Phase 3 + Phase 6 external review applies.

## Regression Impact

- **Voice commands:** Not broken — only the travel-time/"next event" selection instruction changes; every other RULE in the shared prompt is untouched. Both mobile and voice consume the same shared RULE 7 prompt (Wael's Phase 2 review wording, 2026-08-03) — therefore this prompt change applies to both without requiring changes to either consumer.
- **Geofencing:** Not affected.
- **Gmail integration:** Not affected.
- **Calendar integration:** Affected — this is the target of the fix. The named-event branch of RULE 7 (Step 0's "the one the user named, if specific") is explicitly preserved unchanged; only the unnamed "next" branch's re-derivation is removed.
- **Reminders:** Not affected — governed by separate logic (`reminders` table / `SCHEDULE_MEDICATION`), not RULE 7.
- **SMS / call alerts:** Not affected — RULE 7 only governs the assistant's own travel-time speech and `FETCH_TRAVEL_TIME` emission, not alert firing (`evaluate-rules`, `report-location-event` untouched).
- **Onboarding:** Not affected.
- **Staging build:** Not affected — Edge Function-only deploy; no app rebuild or new AAB required to test this.

## Regression Matrix — consumer trace (found by searching, not recalled)

`get-naavi-prompt` has exactly two real callers in the codebase (verified by grep across the repo and the voice-server repo; all other 150+ matches for the string are documentation/comments, individually checked):

1. `supabase/functions/naavi-chat/index.ts` — mobile's Claude calls, all paths.
2. `naavi-voice-server/src/index.js:1883` — voice's Claude calls, with its own local fallback (`buildVoiceSystemPrompt`) on fetch failure — fallback ruled out above as not containing this defect, so it needs no change and cannot silently diverge on this specific behavior.

No other consumer exists. Both are covered by this single-file change with no further tracing needed.

## Phase 2 REOPENED — 2026-08-03 — Deterministic Pre-Selection

**Why reopened:** Phase 7 live testing (`docs/TRAVEL_EVENT_SELECTION_SEMANTICS_PHASE7_TESTING_2026-08-03.md`, once written) showed the marker-gated prompt design does not reliably hold in live use. Three phrasings that should be identical under Path A's explicit rule — "next event," "next meeting," "next appointment" — asked within about a minute of each other, produced three different real events. "Event" correctly took the literal first entry (Home reno walkthrough); "meeting" and "appointment" both skipped it in favor of a type-matching guess. The prohibition written into RULE 7 ("event title, category, or inferred type must not override the first entry") is not suppressing Claude's own tendency for those two words specifically. **Wael's decision: stop relying on prompt compliance for this decision — move it to deterministic code.**

**New design — deterministic pre-selection, mobile only:**

Precedent already exists in this exact file for exactly this shape of fix: the "B6e bypass" (`naavi-chat/index.ts:2070-2110`, 2026-05-26) intercepts calendar-read questions *before* Claude is ever invoked — deterministically fetches, filters, and builds the response in code, with zero LLM involvement, specifically because Claude was proven unreliable at a similar task ("what is on my calendar this week" misrouting despite explicit prompt rules).

The new fix follows the identical shape for the unnamed "next"-travel-time case:

1. **New deterministic classifier, explicitly specified (Wael's Phase 3 mandatory change, 2026-08-03) — not left as a general description:**
   - **Intercept:** "next meeting," "next appointment," "next event," "my next meeting," "drive me to my next appointment," "when should I leave for my next meeting," and the equivalent set already enumerated in RULE 7's own text ("soonest," "upcoming," "what's next," "navigate to my next X") — unnamed, generic-noun phrasing only.
   - **Do NOT intercept:** "Team standup," "Gym class," "dentist," "Bob meeting," "next Tuesday meeting," "meeting with Sarah" — anything naming a specific event, person, or date, even if it contains the word "meeting"/"appointment"/"event." These stay with Claude's existing named-event branch, unchanged.
   - Modeled on `isCalendarReadIntent` (`:496-501`) for structure, but a new, purpose-built regex — reusing `LIVE_CALENDAR_RE` or `isCalendarReadIntent` directly would over-match named events too.
2. **Single owner for event selection (Wael's Phase 3 mandatory change):** event selection must never be performed twice. The deterministic path owns unnamed "next" requests exclusively; Claude's named-event branch owns named requests exclusively. The two must not overlap — if the new classifier ever matched a named request, that would be a bug, not an acceptable double-check.
3. **Single source of truth (Wael's Phase 3 mandatory change):** the deterministic path calls `fetchLiveCalendarEvents` and consumes its already-sorted, already-past-filtered result **as-is** — array index `[0]`, no LLM decision. It performs **no additional sort, no additional filter, no duplicate logic** of any kind. This is the same list Path A already assumed was authoritative; the fix is having code trust it directly instead of asking Claude to.
4. **Address resolution, fixing B11a for this path in the same change:** read `location`, falling back to `description` when `location` is empty (today's live data confirmed every event in this dataset has its real address in `description`, not `location` — the field this code currently ignores). If neither field yields a usable address, do **not** guess — return a deterministic "I don't have an address for [title]. Where is it?" response, matching RULE 7's existing "say so and stop" intent but enforced in code instead of hoped-for from the prompt.
5. **When an address is resolved:** build the `FETCH_TRAVEL_TIME` action directly in code (destination, eventStartISO) and a deterministic speech string ("Your next [meeting/event/appointment — echo the user's own word] is [title] at [time]. Let me get the travel time."), returned immediately — same early-return shape as the B6e bypass, no Claude call for this request at all.

**Voice is explicitly out of scope for this reopened Phase 2, per the earlier "forget about voice" decision.** Voice keeps the marker-gated RULE 7 fix already shipped — imperfect, but not worsened, and not touched again here. RULE 7's Path A/Path B text in `get-naavi-prompt/index.ts` is **not reverted and not edited** — it remains live for voice and as mobile's own fallback for any travel-time phrasing this new classifier doesn't catch.

**Clarifying the reviewer's Implementation Boundary wording** ("no changes to... RULE 7 beyond removing the now-obsolete prompt dependency for this request path"): read literally, this could be taken as authorizing deletion of RULE 7's Path A instruction for mobile. **Not doing this** — RULE 7 is Shared Core, read by both mobile and voice; deleting Path A would regress voice, which still needs it and is explicitly out of scope this round. RULE 7 stays completely untouched in this implementation. Flagging this explicitly rather than silently resolving the ambiguity either way.

**Updated Files list:**
| File | Classification | Change |
|---|---|---|
| `supabase/functions/naavi-chat/index.ts` | Backend / Shared Logic | New deterministic classifier + early-return bypass, modeled directly on the existing B6e pattern. Address fallback (`location \|\| description`) added in the same function. |
| `tests/catalogue/calendar.ts` | Tests | New regression tests replacing reliance on live-trial non-determinism checks with deterministic assertions (see below). |

`get-naavi-prompt/index.ts` — **no further change** in this reopened phase; the Phase 2/4 marker-gated edit from earlier today stays as-is for voice.

**Updated risk: Medium, similar profile to the original plan** — one file gets a new, additive early-return block (doesn't modify existing branches), following an already-proven-safe precedent pattern in the same file. Named-event and voice paths are structurally untouched by construction (the new classifier explicitly excludes named-event phrasing, and voice doesn't call `naavi-chat` at all).

**Updated regression tests (Wael's Phase 3 mandatory change — final list):**
1. Unnamed "next event," "next meeting," and "next appointment" all return the **identical selected event** — a hard equality check, not a 3-trial probability sample, since the outcome is now deterministic by construction.
2. Named events still work — "Drive me to Team standup" continues to select Team standup specifically, confirming the classifier correctly excludes named phrasing and doesn't hijack Claude's branch.
3. Description-field address fallback — an event with an empty `location` but a real address in `description` correctly resolves that address.
4. No-address-found case — an event with neither field populated produces the deterministic "I don't have an address" response, never a guess.

---

## Wael's Phase 2 Review — 2026-08-03 — APPROVED with Mandatory Refinements

"Probably the cleanest Phase 2 you've produced" — one proven root cause, one file, one implementation, no schema, no API, no migrations, no architecture changes, explicit exclusions, explicit rollback. Three mandatory refinements, all applied above: (1) the semantic-matching instruction reworded as a positive chronological-order rule rather than a prohibition, (2) a named-event boundary regression test added, (3) the mobile/voice consequence stated explicitly as "both consume the same shared prompt" rather than "voice inherits it."

## Phase 2 Revision — 2026-08-03 — Resolving Phase 3's Mandatory Change

Phase 3 review (`docs/TRAVEL_EVENT_SELECTION_SEMANTICS_PHASE3_REVIEW_PACKAGE_2026-08-03.md`) returned **Approved with Mandatory Changes**: the original plan is safe for mobile (which guarantees sorted + past-filtered data) but not for voice (whose own independent fetch, per Phase 1A, never filters past events) — blindly trusting "the first entry is next" would make voice newly select an already-started event, a regression the original plan didn't account for.

**Wael's decision, 2026-08-03: "Forget about voice, we do not have a solution for it."** Fixing voice's fetch (the reviewer's Option 1) is explicitly out of scope — not deferred quietly, stated directly. Adopting the reviewer's **Option 2 — marker-gated trust** instead.

**Revised design:**
1. `naavi-chat/index.ts` (~lines 1344-1364): when the calendar portion of the schedule came from the proven-guaranteed path — `needsLiveCalendar` true and `fetchLiveCalendarEvents` actually ran, not the `opts.briefItems` fallback, which has no verified sort/filter guarantee this session — the `## [user]'s upcoming schedule` header text carries an explicit marker phrase confirming the guarantee (e.g., "— sorted chronologically, past events already removed"). When the client-supplied fallback path is used instead, the header is emitted exactly as it is today, unmarked.
2. `get-naavi-prompt/index.ts` RULE 7: the unnamed-"next" branch becomes conditional. **Marker present** → take the first qualifying entry directly (the positive chronological-order rule already approved). **Marker absent** → fall back to the existing walk/parse/compare instructions, preserved verbatim — today's behavior, unchanged, not worsened.
3. **Voice requires zero code changes.** Voice builds its own, independently-implemented calendar context text (`naavi-voice-server/src/index.js`, ~line 3043) — untouched by this change — so it will never emit the marker phrase. RULE 7 (shared) is *architecturally* set up so no marker means no shortcut. **This is not itself proof of safety (reviewer's mandatory clarification, 2026-08-03):** RULE 7 is still one shared, edited prompt — whether the marker-absent branch actually preserves the old behavior in practice, rather than the model accidentally applying the new first-entry shortcut anyway, must be confirmed by direct testing with the marker absent, not assumed from the prompt's structure alone. This is added as regression test 4 below.

**Updated Files list:** unchanged at two files — `get-naavi-prompt/index.ts` (RULE 7, now with a marker-gated conditional) and `naavi-chat/index.ts` (one conditional marker string added to the existing header-building logic). Still zero voice files.

**Updated risk: still Medium, arguably safer than the original plan** — the added conditional is small and localized, and it now structurally cannot make voice worse: absence of the marker reproduces today's exact behavior.

**Updated regression tests (`tests/catalogue/calendar.ts`) — final list per reviewer's mandatory test clarification, 2026-08-03, minimum 3 live trials each:**

1. Marker present: unnamed "next" selects the first supplied event.
2. Marker present: "meeting"/"appointment" wording does not override chronological order.
3. Marker present: a named-event request still selects the named event.
4. **Marker absent: RULE 7 does not use the new first-entry shortcut** — live-tested, not assumed from the prompt's conditional structure. This is the test that actually verifies voice's safety, replacing the earlier, too-strong "proven by construction" claim.
5. Marker is emitted only by `naavi-chat` after its own sort-and-past-filter step ran (a code-path check, confirming the marker never leaks onto the unverified `opts.briefItems` fallback path).

---

**Status (superseded by the Phase 2 REOPENED section above, 2026-08-03):** the marker-gated design below was implemented, reviewed, and deployed to staging, but Phase 7 live testing showed it doesn't reliably hold for "meeting"/"appointment" phrasing. Per Wael's explicit decision, Phase 2 is reopened with a deterministic pre-selection design (above) for mobile; the marker-gated fix stays live for voice only. Requesting Phase 3 re-review for the new design before Phase 4 implementation.
