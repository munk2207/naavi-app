# F11a — Phase 1: Problem Definition

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1. No code written. This document formalizes the gap analysis already captured as raw material in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` (F11a entry) and adds one additional structural finding found during this Phase 1 pass (§3.3).

---

## 1. What exactly is broken?

The 1-888-91-NAAVI demo line's scenario walkthrough content does not represent Naavi's own self-described strongest capabilities. It was built around whatever was easiest to script at the time (F2b, 2026-07-01), not validated against what Naavi itself says it's best at.

## 2. What evidence proves the problem?

**Evidence A — the current demo content (direct source read).**
`naavi-voice-server/src/voice/scenarioWalkthrough.js:13` defines the fixed scenario set:
```
const DEMO_SCENARIO_ORDER = ['today', 'bills', 'history', 'location', 'capture'];
```
Scenario bodies at `scenarioWalkthrough.js:18-54`:
- `today` — reads back 3 calendar events + a weather heads-up (read-only).
- `bills` — reads back 3 email-derived bill amounts (single domain: email).
- `history` — reads back one past service record from memory/knowledge (single domain: knowledge).
- `location` — describes a location-triggered SMS-on-arrival alert.
- `capture` — describes a REMEMBER-style fact capture + recall.

**Evidence B — Naavi's own self-described top 5 capabilities.**
Documented in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` (F11a row) and `project_naavi_demo_capability_alignment_policy` memory: Wael asked Naavi directly, zero-context, "what are your top 5 capabilities" on 2026-07-04. Naavi's answer, as recorded by Wael in those two documents:
1. Geofencing / location alerts
2. Cross-system retrieval (contacts + calendar + email + notes searched at once — e.g. "ask about Dr. Smith")
3. Proactive automation / alerts (email-triggered, weather-triggered, time-based — e.g. "alert when Sarah emails", "text you if it rains tomorrow")
4. Calendar / scheduling (creating events, medication scheduling)
5. Lists / tasks (create, add/remove, list-to-alert connection)

**Note on evidence type:** Evidence B is a product-owner-reported test result, not a file/log/screenshot on disk. No raw transcript file exists — the holding-list entry and memory file are Wael's own written record of that test, produced same-day. Per governance §6, a documented result from the Product Owner's own direct test is treated as valid evidence here; it is explicitly flagged as the one piece of evidence in this document that isn't a file path, log line, or test-suite result. If a higher bar is wanted before Phase 2, Wael could re-run the zero-context question and paste the verbatim reply — not required to proceed, since this is Wael's own instruction, not an AI-derived inference.

**Evidence C — the mapping between A and B (direct comparison, not inference).**

| Naavi's capability (Evidence B) | Demo scenario (Evidence A) | Match quality |
|---|---|---|
| 1. Geofencing / location alerts | `location` | Clean match |
| 2. Cross-system retrieval | `bills` (email only), `history` (knowledge only) | Weak — each is single-domain, not cross-system |
| 3. Proactive automation (email/weather/time-triggered) | none | Not represented |
| 4. Calendar/scheduling (create events, schedule medication) | `today` (read-only calendar recap) | Weak — no creation/scheduling shown |
| 5. Lists/tasks | none | Not represented |

Only 1 of 5 self-described capabilities has a clean demo match. 2 of 5 aren't shown at all. 2 of 5 are shown in a materially weaker form than Naavi's own pitch.

## 3. What is the root cause?

**3.1 — Content selection root cause.** The demo's 5 scenarios were authored during the original F2b build (`docs/F2B_SCENARIO_WALKTHROUGH_SCRIPT_2026-07-01.md`) without a check against Naavi's own capability self-description — that self-description didn't exist as a documented artifact until Wael ran the zero-context test on 2026-07-04, after F2b had already shipped to production (`docs/F2B_PRODUCTION_PROMOTION_APPROVAL_2026-07-02.md`). The scenario set was authored, then the validation source came into existence one session later. This is a sequencing gap, not a coding defect — confirmed by file evidence above (F2b script doc predates the capability-comparison memory by 3 days).

**3.2 — Confirmed, not "probably."** This is stated as a proven root cause because both halves of the comparison (Evidence A: the actual shipped code; Evidence B: Naavi's own documented self-description) are on file and were read directly for this document, not paraphrased from memory.

**3.3 — Additional structural finding (new evidence found during this Phase 1 pass, not previously in the holding-list entry).**
`naavi-voice-server/src/index.js:6815`: `const DEMO_MAX_SCENARIOS = 3;`
The walkthrough always advances through `DEMO_SCENARIO_ORDER` in the same fixed sequence — confirmed at `index.js:7127` (`atCap = newPlayed >= DEMO_MAX_SCENARIOS`) and `index.js:7179` (`idx + 1` on decline) and `index.js:7233` (`idx + 1` on "another example"). There is no shuffling or reordering logic anywhere in `scenarioWalkthrough.js` or the three route handlers in `index.js` that call it.

Consequence: a caller who says "yes" to every gate hears `today` → `bills` → `history` (3 played), hits the cap at `index.js:7130`, and is transitioned straight to the reminder flow. `location` (idx 3) and `capture` (idx 4) are **structurally never reached** on the most common call path (a caller answering yes throughout). The one clean capability match (`location`) and one of the two entirely-unrepresented capabilities' closest analog (`capture`, related to knowledge/notes) sit at the end of a list that the cap-of-3 cuts off before reaching.

This means the problem isn't only "which 5 scenarios were chosen" — it's compounded by an ordering/cap mechanism that makes the weakest-aligned scenarios (`today`, `bills`, `history`) the default-heard set and the strongest-aligned one (`location`) the least-heard.

## 4. What alternatives were considered?

- **Do nothing / leave as-is.** Rejected by Wael — this is the explicit next-session priority (`project_naavi_demo_capability_alignment_policy` memory, 2026-07-04), not a deferred item.
- **Add the 2 missing capabilities (automation, lists) as new scenarios 6 and 7, keep the existing 5 untouched.** Would fix the "not represented at all" gap but not the ordering/cap problem in §3.3, and would grow the walkthrough beyond the "3-5 scenarios" scope Wael specified in the holding-list entry. Not selected as the sole fix — needs to be weighed against a full rewrite in Phase 2.
- **Full rewrite of the scenario set + reconsider `DEMO_MAX_SCENARIOS`/ordering together.** Addresses both the content gap (Evidence C) and the structural bias (§3.3) in one pass. This is the direction implied by the holding-list entry's scope note ("rewrite the demo's scenario content... around these 5 validated capabilities") but Phase 2 needs to decide explicitly whether ordering/cap logic is in scope or a separate follow-up item, since the holding-list note only mentions content, not the cap mechanism.

**Root cause status: proven** for §3.1/3.2 (content selection) and §3.3 (structural ordering bias) — both backed by direct file citations above. No fix is proposed in this document; that is Phase 2.

---

**Next step:** Phase 2 — Change Planning (files that will change, risk classification, regression impact across the 8 required areas, and an explicit decision on whether the `DEMO_MAX_SCENARIOS`/ordering mechanism in §3.3 is in scope for this change).
