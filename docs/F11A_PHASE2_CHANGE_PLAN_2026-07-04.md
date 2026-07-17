# F11a — Phase 2: Change Planning

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. Builds on `docs/F11A_PHASE1_PROBLEM_DEFINITION_2026-07-04.md`. No code written. Touches Protected Core (Voice orchestration) — Phase 3 (ChatGPT review, pre-code) is mandatory and NOT waived for F11a (per the governance note in the holding-list entry).

---

## 0. Phase 3 Review — ChatGPT Response (2026-07-04)

**Outcome on Phase 1: "Approve — authorized to move to Phase 2."** ChatGPT's assessment: the Phase 1 document is evidence-based, identifies both the content gap and the deeper structural issue (§3.3, the cap/order bias), and avoids prescribing implementation details prematurely.

**Suggestion for Phase 2 (incorporated below):** separate the work into two independent architectural decisions rather than one combined plan:
1. **Capability alignment** — which scenarios should exist, which capabilities they demonstrate.
2. **Walkthrough mechanics** — maximum scenarios, ordering, randomization (if any), early termination rules.

ChatGPT's reasoning: these are different architectural concerns; treating them separately makes implementation easier to review and test. Incorporated as Track A and Track B below, replacing the single combined plan from the first Phase 2 draft.

## 0.1 Phase 3 Review, Round 2 — ChatGPT Response (2026-07-04)

**Outcome: "Approve, with one substantive recommendation."** Reviewed the Track A/B draft above. Full comment set and how each was resolved:

| # | ChatGPT comment | Resolution |
|---|---|---|
| 1 | Track A/B split is "exactly the right architecture" — no concerns. | No change. |
| 2 | Track A is the strongest section — reframing `bills`+`history` as `unified_search` is "significantly stronger marketing" because callers care that Naavi answered one question from multiple places, not which source it came from. | No change — confirms A.2/A.3 as written. |
| 3 | Refine the "strongest word" principle: not just "use the strongest word" but **"use the strongest accurate word that a first-time caller immediately understands."** Example: "Geofencing" is technically excellent but a caller may not know the word; "the moment you arrive somewhere" demonstrates the same mechanism while staying understandable. | **Incorporated — A.1 rewritten below**, elevating this exact sentence into the principle itself so it governs future script reviews, not just this one. |
| 4 | The 5-capability portfolio is "a much better portfolio" — Geofencing/Unified Search/Automatic Alerts are genuinely differentiated; Scheduling/Lists anchor the product in familiar territory before the unique ones. | No change — confirms A.2. |
| 5 | **Disagree with A.4's recommendation to drop `capture`.** Capture is the psychological bridge that explains *how Naavi learns* — without it, a caller hears search/reminders/geofencing but never learns how Naavi knows any of it. Recommendation: retain it, but reclassify it as a **foundational capability**, not a top-five differentiator. | **Incorporated — A.4 rewritten below.** Placement mechanism (own scenario vs. bridge line) still needs Wael's decision — see Open Decisions. |
| 6 | Track B split — "excellent separation, no concerns." | No change. |
| 6a | B.2: do **not** raise the cap to 5. Three is right for a cold caller. "Ensure the best three are always heard" rather than showing all five — first impression ≠ full product tour. | **Incorporated — B.2 resolved below: cap stays at 3.** |
| 6b | B.3/B.4: **no randomization.** Reasons given: deterministic testing, repeatable demos, marketing consistency, easier analytics. A deliberate order beats a random one. | **Incorporated — B.3/B.4 resolved below: fixed order, randomization off.** |
| 7 | Files-to-change scope is clear, tightly bounded, no concerns. | No change. |
| 8 | Regression section is "exactly the level of detail I'd expect before Protected Core work." | No change. |
| 9 | Strategic recommendation: optimize scenario order for **memorability** ("I didn't know software could do that") rather than feature category. If Geofencing produces a stronger reaction than Scheduling, Geofencing goes earlier even though Scheduling is more commonly used. | **Incorporated — new B.3.1 below**, and used to produce a concrete proposed order. |

**Overall assessment:** approved to proceed to script-design (Phase 4 script doc), conditional on the adjustments above.

## 0.2 Phase 3 Review, Round 3 — ChatGPT Response (2026-07-04)

**Outcome: "Approve."** Reviewed the resolved plan (B.2/B.3/B.6 resolutions, A.4 bridge-line direction). Comment set and resolution:

| # | ChatGPT comment | Resolution |
|---|---|---|
| 1 | **Challenges the proposed order.** Agrees with ordering-by-memorability as a principle, but not with the specific sequence. A first-time caller's subconscious question is "why should I believe this assistant is different?" — the strongest answer is Unified Search, not Geofencing: "ask me about Dr. Smith" pulling from calendar+email+notes+contacts creates an immediate "wait... it searched everything?" moment that establishes Naavi *understands the caller's world*. Once that's established, Geofencing becomes more believable as an extension of that intelligence rather than sounding like "just another reminder feature." Escalation: *it knows everything → it knows where I am → it acts without me asking.* | **Incorporated — B.3.1 rewritten below.** Order changes from `Geofencing → Automatic Alerts → Unified Search` to **`Unified Search → Geofencing → Automatic Alerts`**. |
| 2 | Confirms bridge-line-for-Capture is the better solution (vs. its own scenario) — but the bridge line must be **exactly one sentence**. Risk: turning it into an explanation. People remember demonstrations, not explanations. Suggested line: *"Everything I show you comes from remembering what you tell me and organizing it automatically."* Then move straight into the first scenario — don't linger. | **Incorporated — A.4 updated below** with the one-sentence constraint and the suggested line as the Phase 4 script-doc starting point. |
| 3 | New recommendation: document an explicit **emotional progression** the scenario sequence should follow, not just capability coverage — e.g. Curiosity → Surprise → Trust → Action(reminder). Gives future script revisions a design target beyond feature checklisting. | **Incorporated — new B.3.2 below.** |
| 4 | Elevate "the strongest possible 'I didn't know software could do that' moment" from a passing recommendation to a **governing Design Principle**, worded so it's a testable question for future reviews: *"maximize the probability that a first-time caller experiences at least one genuine 'I didn't know software could do that' moment before the reminder offer."* | **Incorporated — new Guiding Design Principle section below**, placed ahead of Track A/B so it governs both. |
| 5 | Agrees with B.6 — Track B resolving into configuration rather than a code change is "exactly the kind of simplification I like seeing before implementation." | No change. |

**Overall assessment:** plan approved as mature enough for script-design, with the order change in #1 as the one substantive revision.

---

## Guiding Design Principle (adopted 2026-07-04, ChatGPT Phase 3 Round 3)

**Every default walkthrough must maximize the probability that a first-time caller experiences at least one genuine "I didn't know software could do that" moment before the reminder offer.**

This is the test every future script revision gets held against: *does this change increase or decrease that probability?* It supersedes optimizing for raw capability coverage (Phase 1's original framing was "only 1 of 5 capabilities has a clean demo match" — true, but coverage alone isn't the goal; the emotional reaction is).

---

## Track A — Capability Alignment

*Decides: which scenarios exist, what each demonstrates, how each is worded. Does not decide how many play, in what order, or when the walkthrough ends — that's Track B.*

### A.1 — Content principle (Wael 2026-07-04, refined by ChatGPT Phase 3 Round 2)

**Principle: use the strongest accurate word that a first-time caller immediately understands.**

Original framing (Wael, 2026-07-04): naming and framing must use the strongest correct word for each capability, not the softest one that technically covers it. Example: the current scenario is internally called `location` and is gated with "Hear how I can text someone when you arrive somewhere?" — that is technically Geofencing, but "location" undersells it.

Refinement (ChatGPT, Phase 3 Round 2): "strongest" is not the same as "most technical." "Geofencing" is technically excellent, but if Hera literally said "let me show you geofencing," many first-time callers wouldn't know the word — that would be a comprehension failure disguised as strength. "The moment you arrive somewhere..." demonstrates the exact same mechanism while staying immediately understandable. The word chosen must clear both bars at once: strongest, *and* instantly clear to someone who has never heard it before.

**How this applies:**
- Internal scenario keys/labels (code comments, planning docs, this document) use the strongest correct technical term — `geofencing`, `unified_search`, `automatic_alerts` — because that's for us, not the caller.
- What Hera actually *says* to the caller stays plain-spoken and concrete per the existing script style (CLAUDE.md target-audience rules): name the mechanism through a vivid, understandable moment ("the moment you land," "the second that email arrives," "before you even ask"), never the jargon word itself.
- This refined principle governs every future script review for this line, not just this one round.

### A.2 — Target capability set (renamed per A.1, replaces the 5 in Phase 1 Evidence C)

| # | Old label (Phase 1 Evidence B) | Renamed per strength principle | Mechanism it must demonstrate |
|---|---|---|---|
| 1 | Geofencing / location alerts | **Geofencing** | Arrival/departure-triggered action — already the strong word; scenario `location` already uses this mechanism, only the gate/body wording is being sharpened. |
| 2 | Cross-system retrieval | **Unified Search** | One question answered by pulling from more than one source at once (calendar + email + notes + contacts) — not a single-domain lookup. |
| 3 | Proactive automation | **Automatic Alerts** | Naavi acting on its own when a condition is met (email arrives, weather changes, time passes) — with zero further input from the caller after setup. |
| 4 | Calendar/scheduling | **Scheduling** | Naavi *creating or booking* something (an event, a recurring medication time) — not reading a calendar back. |
| 5 | Lists/tasks | **Lists** | Naavi managing a list (create, add, remove) and optionally wiring it to an alert. |

### A.3 — Scenario-by-scenario plan

*Direction only — final wording is Phase 4 (Implementation), reusing the existing script-doc-first discipline (`docs/F2B_SCENARIO_WALKTHROUGH_SCRIPT_2026-07-01.md` pattern: write the script doc, get it confirmed line-by-line, then encode it in `scenarioWalkthrough.js`).*

| Scenario key (was) | Scenario key (proposed) | What changes | Why |
|---|---|---|---|
| `today` | `scheduling` | Currently read-only calendar recap. Rewrite so Naavi demonstrates *creating* something (e.g., "say you told me to schedule your blood pressure pill for 8am every day — I'd set it up right then, no app, no typing") instead of reading a fixed list back. | Phase 1 Evidence C: current version is a weak match for capability #4 (read-only, no creation shown). |
| `bills` | retired as a standalone scenario; folded into `unified_search` | Single-domain (email-only) lookup. | Phase 1 Evidence C: doesn't demonstrate cross-system retrieval, only email. |
| `history` | retired as a standalone scenario; folded into `unified_search` | Single-domain (knowledge-only) lookup. | Same reason — the two narrowest scenarios become the ingredients of one stronger one. |
| *(new)* | `unified_search` | One scenario that pulls from two-plus sources in a single answer (e.g., a question whose answer combines a calendar entry, an email amount, and a saved note) instead of `bills` and `history` each demonstrating exactly one source. | Directly demonstrates capability #2 as Naavi itself describes it — "searched at once," not two separate single-source demos. |
| `location` | `geofencing` (rename only, mechanism already correct) | Sharpen the gate/body wording per A.1 — name the trigger plainly and confidently. Mechanism itself (arrival-triggered SMS) stays. | Already the one clean match (Phase 1 Evidence C) — lowest-risk item, wording polish only. |
| `capture` | retained — reclassified as **Foundational**, not top-5 | `capture` (REMEMBER-and-recall) doesn't map to any of the 5 top capabilities on its own — but per Phase 3 Round 2, it answers a question the other 5 don't: *how does Naavi know any of this?* Placement mechanism (own gated scenario vs. folded into the opening bridge line) is open — see A.4. | ChatGPT Phase 3 Round 2: Capture is the psychological bridge explaining how Naavi learns; dropping it would leave callers hearing search/reminders/geofencing with no explanation of the mechanism behind all of them. |
| *(new)* | `automatic_alerts` | New scenario demonstrating a trigger the caller never has to check on — e.g., "say you told me: if it's going to rain tomorrow, text me the night before — I'd watch that for you, no need to ask again." | Phase 1 Evidence C: capability #3 has zero representation today. |
| *(new)* | `lists` | New scenario demonstrating list creation/management — e.g., "say you told me to start a Costco list and add milk and eggs — next time you call, I'd have it, and I could even text it to you." | Phase 1 Evidence C: capability #5 has zero representation today. |

Net result: 5 scenarios (`scheduling`, `unified_search`, `geofencing`, `automatic_alerts`, `lists`), one per capability, each named and worded per A.1.

### A.4 — Resolved: `capture` is retained as a Foundational capability, not dropped

**Reversed from the first Phase 2 draft per ChatGPT Phase 3 Round 2.** The original recommendation was to drop `capture` to make room for the two genuinely missing capabilities. ChatGPT disagreed: Capture isn't competing for a top-5 slot, it's explaining the mechanism underneath all five — it's the answer to "how does Naavi know this?" Dropping it removes that explanation entirely, not just one example among several.

**Resolved per ChatGPT Phase 3 Round 3 — option 2 (bridge line), with a hard constraint: exactly one sentence.**

Round 2 left the placement mechanism open between (1) Capture as its own gated scenario or (2) folded into the opening bridge line. Round 3 confirmed the bridge line is the better solution, but flagged the failure mode: turning it into an explanation. People remember demonstrations, not explanations — so the line states the mechanism once and then moves immediately into the first scenario (Unified Search, per B.3.1), no lingering.

**Starting point for the Phase 4 script doc** (ChatGPT's suggested wording, to be confirmed line-by-line like the rest of the script): *"Everything I show you comes from remembering what you tell me and organizing it automatically."* — said once in `getWalkthroughBridgeLine()` (`scenarioWalkthrough.js:108-114`), immediately followed by the Unified Search gate. No yes/no gate of its own, no cap interaction.

---

## Track B — Walkthrough Mechanics

*Decides: how many scenarios play per call, in what order, whether order is randomized, and what ends the walkthrough. Independent of which 5 (or 6) scenarios exist — this track would need the same decisions even if Track A content were left untouched.*

### B.1 — Current mechanism (evidence, from Phase 1 §3.3)

`naavi-voice-server/src/index.js:6815`: `DEMO_MAX_SCENARIOS = 3`. Traversal is fixed-order, always `idx + 1` (`index.js:7127`, `7179`, `7233`), no shuffling anywhere in `scenarioWalkthrough.js` or the three route handlers. A caller who says "yes" throughout hears only the first 3 array entries and never reaches the last 2 — confirmed by direct code read, not inferred.

### B.2 — Resolved: maximum scenarios stays at 3

**Resolved per ChatGPT Phase 3 Round 2** (reversed the first draft's "raise to 5" option). Reasoning: three is right for a cold caller; the goal is the strongest possible first impression, not a full product tour. Rather than showing all 5 capabilities to every caller, the walkthrough should guarantee the *best three* are always heard — see B.3.1 for which three and why. A caller who wants more can still say so at the closer (existing `getCloserLine()` mechanism, unchanged); the two not in the default three aren't deleted, just not front-loaded.

### B.3 — Resolved: fixed order, no randomization

**Resolved per ChatGPT Phase 3 Round 2.** Randomization was the first draft's other open option; ChatGPT recommended against it for four reasons: deterministic testing (a fixed manual-test script — same pattern as `docs/F2B_SCENARIO_WALKTHROUGH_PHASE2_2026-07-01.md` §8 — requires a known order), repeatable demos (Wael or anyone else calling to check the line hears the same thing), marketing consistency (the "best three" should always be the best three, not whichever three chance selects), and easier analytics (comparing call-completion rates across scenarios requires a stable order). A deliberately chosen fixed order beats a random one on every axis that matters here.

### B.3.1 — Resolved: ordering by narrative arc, not raw novelty ranking

**New per ChatGPT Phase 3 Round 2** (strategic recommendation #9), **revised per ChatGPT Phase 3 Round 3.** The document previously optimized implicitly for "show all five capabilities" — ChatGPT reframed the goal as the Guiding Design Principle above, which is not the same as raw novelty ranking. Round 2's first attempt ranked purely by how surprising each mechanism is in isolation (`Geofencing → Automatic Alerts → Unified Search`). Round 3 corrected this: order also has to answer the caller's subconscious first question — *"why should I believe this assistant is different?"*

**Round 3 reasoning:** Unified Search answers that question first — "ask me about Dr. Smith" pulling from calendar + email + notes + contacts in one answer produces an immediate "wait... it searched everything?" reaction, establishing that Naavi *understands the caller's world*. Only once that's established does Geofencing land as a believable extension of that intelligence, rather than sounding like "just another reminder feature." The sequence tells a coherent escalating story: *it knows everything → it knows where I am → it acts without me asking.*

**Resolved fixed order: Unified Search → Geofencing → Automatic Alerts → Scheduling → Lists**, with the cap-of-3 default path landing on Unified Search, Geofencing, and Automatic Alerts, and Scheduling/Lists available only if the caller explicitly wants more.

### B.3.2 — New: emotional progression as an explicit design target

**New per ChatGPT Phase 3 Round 3.** The walkthrough is organized around capabilities (good for engineering) but scripts also need to satisfy an emotional arc (needed for the Guiding Design Principle to actually land). Documented so future script revisions have a target beyond feature coverage:

| Stage | Scenario (per B.3.1's default 3) | Target emotion |
|---|---|---|
| First | Unified Search | Curiosity — "wait, it searched everywhere?" |
| Second | Geofencing | Surprise — it knows where I physically am and acts on it |
| Third | Automatic Alerts | Trust — it watches things for me, unprompted, reliably |
| Closer | Reminder offer | Action — caller is now willing to give it a real task |

Phase 4's script doc should be checked against this table, not just against A.2/A.3's capability descriptions.

### B.5 — Early termination rules

Current behavior (evidence: `index.js:7156-7192`, `7217-7220`): caller can say "no" at any gate (advances to next scenario, doesn't count toward the cap) or say anything matching `DEMO_MOVE_TO_REMINDER_RE` at a closer (jumps straight to the reminder flow). This part of the mechanism is not implicated by Phase 1's findings and is not proposed to change — listed here only so Track B is a complete accounting of the mechanics ChatGPT flagged, not because a problem was found with it.

### B.6 — Resolved (moot): Track B requires no `index.js` changes

With B.2 resolved to "keep cap at 3" (already the current value of `DEMO_MAX_SCENARIOS`, `index.js:6815`) and B.3 resolved to "fixed order, no randomization" (already the current traversal mechanism — no shuffling logic exists to remove), **Track B's decisions don't require touching `index.js` at all.** The only artifact of Track B's work is the specific *order* of scenario keys — and that array (`DEMO_SCENARIO_ORDER`) lives in `scenarioWalkthrough.js`, the same file Track A already changes for its new key names. So the original B.6 question ("ship Track A and B together, or separately?") is moot: there is no separate Track B change to sequence — Track B's output (the confirmed order from B.3.1) is simply the content of an array Track A was rewriting anyway. The two tracks stayed conceptually independent (per ChatGPT's original suggestion) even though they resolve into one edit.

---

## Files that will change

| File | Classification | Track | Change |
|---|---|---|---|
| `naavi-voice-server/src/voice/scenarioWalkthrough.js` | Backend (Protected Core: Voice orchestration) | A + B | `DEMO_SCENARIO_ORDER` array contents replaced with the 5 new keys **in the resolved B.3.1 order** (`unified_search, geofencing, automatic_alerts, scheduling, lists`). `DEMO_WALKTHROUGH_SCENARIOS` gate/body text rewritten per the confirmed script (new script doc written and confirmed before this file changes, same discipline as F2b), checked against B.3.2's emotional-progression table. Opening bridge line (`getWalkthroughBridgeLine()`, lines 108-114) gets the one-sentence Capture line per A.4. No structural/function changes — same shape (`gate` + `body` per key). |
| `docs/F11A_SCENARIO_SCRIPT_<date>.md` (new) | Documentation | A | New script doc, line-by-line confirmed wording, same pattern as `F2B_SCENARIO_WALKTHROUGH_SCRIPT_2026-07-01.md` — written and confirmed before any code changes in Phase 4. |

**No changes to:** `naavi-voice-server/src/index.js` (per B.6 — `DEMO_MAX_SCENARIOS` stays 3, traversal logic already fixed-order with no shuffling to remove), `buildDemoWalkthroughGateTwiml`'s branching logic, the `/voice/demo/walkthrough/gate` and `/voice/demo/walkthrough/closer` route handlers, the reminder flow, SMS/consent logic, `getDemoEnvironment.js`, any Edge Function, any migration, any database table.

## Risk classification

**Medium** — touches Protected Core (Voice orchestration) and is live on a public production phone line (1-888-91-NAAVI), but scope is now narrower than the first Phase 2 draft: content + array-order changes in a single file (`scenarioWalkthrough.js`), zero changes to `index.js`'s routing/cap logic (B.6). No new routes, no new parsing logic, no new Edge Functions, no new database writes, no change to the reminder-creation backend. Same shape of change as the original F2b Phase 4 script build, which shipped successfully under the same classification.

## Regression impact

| Area | Impact | Why |
|---|---|---|
| Voice commands | **AFFECTED** | Scenario content and array order change in `scenarioWalkthrough.js` (Protected Core) — demo-only routes, real users' voice commands untouched. No routing/cap logic in `index.js` changes (B.6). |
| Geofencing | Not affected | The *demo scenario* about geofencing changes; the real `hooks/useGeofencing.ts` / OS-level geofencing system is untouched. |
| Gmail integration | Not affected | `unified_search` scenario content is scripted narration, not a live Gmail read — same as the current `bills` scenario. |
| Calendar integration | Not affected | `scheduling` scenario content is scripted narration, not a live calendar write — same pattern as current `today`. |
| Reminders | Not affected | Reminder flow (parsing, confirmation, creation, cron firing) is downstream of the walkthrough and untouched. |
| SMS / call alerts | Not affected | No change to Recap SMS, consent disclosure, or reminder SMS. |
| Onboarding | Not affected | |
| Staging build | **AFFECTED (staging first, per CLAUDE.md staging-first rule)** | New scenario content deploys to the demo line on staging Twilio number before production promotion, same as F2b/F2i precedent. |

## Resolved (all Phase 2 architectural questions closed)

- ~~A.4 drop-or-keep~~ → keep `capture`, reclassified as Foundational.
- ~~A.4 placement~~ → opening bridge line, exactly one sentence, then straight into the first scenario.
- ~~B.2 cap~~ → stays at 3.
- ~~B.3/B.4 randomization~~ → no randomization, fixed order.
- ~~B.3.1 order~~ → `Unified Search → Geofencing → Automatic Alerts → Scheduling → Lists`.
- ~~B.6 sequencing~~ → moot, resolves into one `scenarioWalkthrough.js` edit.

No open architectural decisions remain. Every item raised across Phase 1 and three Phase 3 review rounds is resolved above with a file:line or explicit rationale.

## Next step

Waiting on Wael's go-ahead to begin the Phase 4 script doc — writing the actual gate/body wording for `unified_search`, `geofencing`, `automatic_alerts`, `scheduling`, `lists`, and the one-sentence Capture bridge line, checked against the Guiding Design Principle and B.3.2's emotional-progression table, line-by-line confirmed the same way `docs/F2B_SCENARIO_WALKTHROUGH_SCRIPT_2026-07-01.md` was. That script doc gets one more Phase 3 pass (wording specifically, not structure) before any code in `scenarioWalkthrough.js` is touched.
