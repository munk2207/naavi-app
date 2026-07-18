# B10j — Phase 3: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3. Subject: `docs/B10J_PHASE2_CHANGE_PLAN_2026-07-17.md`, reviewed and **Approved conditioned on two items** (validate wording against ≥15 examples; require classifier-regression evidence in Phase 5). This document resolves the first condition with direct empirical evidence, finalizes the exact wording for both files, and formalizes Implementation Boundaries.

Required because the plan touches Protected Core (Layer 2 classifier + Path B system prompt, shared across every alert type and both surfaces) and is classified High Risk.

---

## 1. Condition 1 resolved — empirical validation against 15 existing single-action phrasings, done live, not assumed

**Method:** rather than reasoning abstractly about whether the proposed wording could over-match, the CURRENT, unmodified, deployed classifier was called directly (`naavi-chat` on staging) with 15 real single-action location phrasings plus the 2 known compound (positive-control) phrasings. Each call's outcome was read from `client_diagnostics`' `f15-layer2-action-branch` marker — an existing diagnostic that fires precisely when `classifyIntent` returns `level: 'action'` for a `SET_ACTION_RULE`-family intent, giving a direct, unambiguous signal of what Layer 2 actually decided, not an inference from the final response shape. **No `action_rules` row was created by this test** — `naavi-chat` only returns the classification/action JSON; the actual DB insert happens client-side in `useOrchestrator.ts`, which this test never invokes.

**Result — all 15 negative controls confirmed stable at `level=action, intent=SET_ACTION_RULE, trigger=location`:**
1. "Alert me when I arrive at Costco"
2. "Text Bob when I arrive at 50 Elm Street"
3. "Email Bob when I arrive at 50 Elm Street"
4. "Text me at +16135551234 when I arrive at 50 Elm Street"
5. "Call me at +16135551234 when I arrive at 50 Elm Street"
6. "Remind me with Bob's kid Sam when I arrive at Bob's home"
7. "Alert me when I arrive at the office"
8. "Text Sarah when I leave home"
9. "Notify me when I arrive at Shoppers Drug Mart"
10. "Let me know when I get to the gym"
11. "Text my wife when I arrive at work"
12. "Alert me when I leave the office"
13. "Email Sarah when I reach work"
14. "Text Bob when I arrive home"
15. "WhatsApp me when I arrive at Costco"

This establishes the exact baseline Phase 5 must reproduce after the wording change — all 15 must still return this identical marker.

**Positive controls — an important, unplanned finding:** the two known compound phrasings did **not** behave identically to each other on repeated live calls. "When I arrive home remind me to lock the door and send sms to bob saying i'm home" hit the action branch again (consistent with the earlier live reproduction in Phase 1). But "Remind me when I arrive home to lock the door AND send SMS to Bob" — phrased closer to the prompt's own time-trigger worked example, and the exact phrase Wael used live in Phase 1 — returned **no** `f15-layer2-action-branch` marker at all on this test call, meaning Layer 2 did NOT force it through the action branch this time (it either went to `chat`/Path B, or a different Level-A intent).

**Why this matters, stated precisely (revised per review feedback — see §8):** repeated live calls produced inconsistent Layer-2 outcomes for the identical compound phrasing despite no intentional code changes in between. The specific cause is not established here — possible sources include classifier non-determinism, subtle request normalization, hidden context differences, preprocessing, upstream routing differences, or diagnostics instrumentation differences; none of these have been individually ruled out. What is established, and is empirical evidence rather than speculation: **single-call verification is insufficient, and repeated trials are required. Phase 5 must run each control phrasing multiple times (recommend 3 trials minimum for the compound/positive controls) and report the distribution, not just one outcome.** This applies to both the pre-fix baseline (already partially inconsistent, per this finding) and the post-fix verification.

---

## 2. Final wording — `naavi-chat/index.ts:1668`, appended immediately after the existing "CRITICAL EXCEPTION" sentence

```
This exception covers single-action location alerts only — the entire
message names at most ONE recipient (yourself, or exactly one third
party) with no separate self-reminder component. It does NOT cover a
message that ALSO contains an independent self-reminder task ("remind
me to [task]") together with a distinct third-party send verb ("and
text/email/call [name] [message]") — that is 2 distinct actions (a
self-reminder + a third-party notification) and must classify as chat,
exactly like the identical shape already does for time-triggered
requests. e.g. "Remind me when I arrive home to lock the door AND send
SMS to Bob" -> chat (2 actions). Contrast with single-action location
phrasing that stays action: "Text Bob when I arrive home" (one
recipient, no self-reminder) -> action. "Alert me when I arrive at
Costco" (self only) -> action. "Remind me with Bob's kid Sam when I
arrive at Bob's home" (self-reminder content mentions a name but is
not a send TO that person) -> action.
```

**Why the three contrastive examples are included directly in the wording (resolving Phase 2's open question (b) — yes, add guardrails):** each one is drawn directly from the empirical negative-control corpus in §1, chosen specifically because each represents a distinct way a naive reading of "self-reminder + third party" could over-match: a single-recipient send with no self-reminder at all; a pure self-alert with no third party; and a self-reminder whose *content* happens to mention a person's name without sending them anything. Naming these directly in the prompt, next to the new rule, matches this file's own established pattern of contrastive guardrail examples (e.g. the PRONOUN RULE block, B9l's phone-shaped-name example) and gives future prompt edits a concrete anchor to check against, not just an abstract principle.

---

## 3. Final wording — `get-naavi-prompt/index.ts`, new section placed immediately after the location-alert block (near line 1905, following B10h's `body`-forwarding fix)

```
LOCATION SELF-ALERT PRIMARY RULE: When a location-alert request also
includes a distinct third-party send ("and text/email/call someone"),
the PRIMARY action must remain a self-alert -- do NOT put the third
party's phone/email as the primary to_phone/to_email. Structure it as:
action_config.body = the user's own reminder text; action_config.
task_actions = [{type:'send_sms'|'send_email', to_name, body: the
third party's message}]. Mirrors the existing time-trigger SELF-ALERT
PRIMARY RULE above (line 625), applied to location triggers.
e.g. "Remind me when I arrive home to lock the door AND send SMS to
Bob" -> trigger_type='location', location='home', direction='arrive',
action_config={body:'Lock the door.', task_actions:[{type:'send_sms',
to_name:'Bob', body:"I'm home."}]}.
```

**Placement confirmed not to disturb existing text:** this is a new, self-contained block inserted after the existing location-alert section ends and before whatever section currently follows it — no existing line is edited, moved, or reflowed. Phase 4 must diff-confirm this (acceptance criterion 5, carried over from Phase 2) — every existing worked example and rule, for every trigger type, remains byte-identical.

---

## 4. Whether `prompt-regression.ts`'s current test set is sufficient — resolved: no, new tests are required

`tests/catalogue/prompt-regression.ts` already makes live calls to `naavi-chat` and asserts on response shape (confirmed by direct read — the `expect2xx(status, 'naavi-chat')` pattern recurs throughout, meaning this suite already exercises the real, deployed classifier, not a mock). This confirms live-classifier testing is an established, already-used pattern in this codebase's test suite — Phase 4 should add to it, not invent a new mechanism.

**Phase 4 must add, as new registered tests (not just re-run this document's diagnostic script):**
1. All 15 negative-control phrasings from §1, each asserting the response still corresponds to a direct `SET_ACTION_RULE` action (single-action location), not a `chat`-routed response — regression protection for the exact corpus this document validated.
2. The 2 positive-control phrasings from §1, each run **3 times** (per §1's non-determinism finding), asserting that a majority of runs now produce the self-primary + `task_actions` shape rather than the third-party-primary + `tasks`-merged shape.
3. At least one genuinely new compound phrasing not in this document's corpus (to catch overfitting to the exact tested wording), e.g. "Remind me to take my pills when I get to the office and text my daughter I made it in."

---

## 5. Implementation Boundaries Confirmed

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3's Implementation Boundaries requirement:

- **Authorized files, exactly:**
  - `supabase/functions/naavi-chat/index.ts` — the classifier wording addition in §2 above, appended immediately after the existing "CRITICAL EXCEPTION" text at line 1668. No other line in this file's classifier prompt is touched.
  - `supabase/functions/get-naavi-prompt/index.ts` — the new self-contained section in §3 above, inserted after the existing location-alert block. No existing rule or worked example in this file is edited.
- **No additional files are approved.** Not `hooks/useOrchestrator.ts`, `report-location-event/index.ts`, `evaluate-rules/index.ts`, `_shared/alert_body.ts`, or `naavi-voice-server/src/index.js` — Phase 1 §2.3/§2.4 already confirmed these are not defective in themselves and need no change (Phase 2 §1 reaffirmed this).
- **No opportunistic refactoring is approved.** No other part of either prompt string is reorganized, reworded, or "cleaned up" while these files are open for this change.
- **Test additions are approved and required** (§4) — new entries in `tests/catalogue/`, registered in `tests/runner.ts`, per Rule 15a.
- **Explicitly excluded from this authorization** — each would need its own Phase 1/2/3:
  - Teaching the deterministic path (`buildActionConfirm`'s location branch) to detect this pattern directly, instead of routing to Path B (Phase 2 §5, considered and not chosen).
  - Any defense-in-depth hardening of `buildAlertBody`/`report-location-event` against merging `tasks` into a third-party-only body (Phase 1 §5 / Phase 2 §5, deferred).
  - The same compound-request check for `contact_silence` or `weather` triggers (Phase 1 §5, untested, out of scope).

---

## 6. Outcome

**Implementation is authorized only within the boundaries defined in §5, using the exact wording in §2/§3.** No code has been written under this document. Phase 4 (Implementation) must include the test additions specified in §4, run each 3 times where noted, and report the distribution of results, not a single pass/fail — per §1's non-determinism finding. Phase 5 (Evidence Package) and Phase 6 (Technical Review After Coding) follow, per governance — neither has started.

---

## 7. Deferred recommendation, not part of this fix (per reviewer's strategic note)

The reviewer's non-determinism finding was assessed as significant enough to warrant a standing governance rule beyond this one fix: *"Prompt-based classifier changes require repeated execution of positive-control cases (minimum three trials) because single executions have been shown to produce inconsistent routing during live validation."* **Not adopted into `CLAUDE.md`/`AI_DEVELOPMENT_GOVERNANCE.md` here** — the reviewer explicitly framed this as a follow-up for after this project closes, and any change to the governance doc itself is its own decision requiring Wael's separate go-ahead, per the Phase-Gate Approval Rule. Flagged here so it isn't lost, not enacted.

---

## 8. Phase 3 review record (2026-07-17)

Reviewer feedback received via Wael. Rated 9.9/10 — "the strongest Phase 3 document in the B10 series so far... doesn't just discuss implementation, it actually reduces uncertainty before coding by collecting new evidence. That is exactly what a Technical Review should do."

One revision adopted:

1. **§1's non-determinism attribution softened.** "Classifier calls at temperature 0 are not perfectly deterministic in practice" replaced with a more precise statement: repeated live calls produced inconsistent Layer-2 outcomes despite no intentional code changes, with the specific cause explicitly left unestablished (possible sources listed: classifier non-determinism, request normalization, hidden context differences, preprocessing, upstream routing, instrumentation differences — none individually ruled out). The actionable conclusion (single-call verification is insufficient, repeated trials required) is unchanged, since it doesn't depend on knowing which of those sources is responsible.

Reviewer's stated assessment: praised for resolving Phase 2's validation requirement with actual live evidence rather than an assertion of safety; the non-determinism finding itself singled out as "a far more important discovery than B10j itself," with a strategic recommendation to eventually formalize a governance rule about it (§7 above — flagged, not enacted, per the reviewer's own framing as post-project follow-up). Implementation Boundaries (§5) specifically praised as leaving "essentially no room for implementation drift... exactly how Protected Core work should be constrained." Test additions (§4) praised as "genuine regression engineering," specifically the requirement for a novel, untested compound phrasing to check for overfitting.

**Verdict: Approved.** One editorial recommendation, adopted above; no other changes requested.

**This is the reviewer's assessment of the document's quality — it is not, by itself, authorization to begin Phase 4.** Per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3): Phase 4 begins only when Wael says so explicitly, in a separate instruction, regardless of this review verdict.

---

## 9. Status

**Phase 3 drafted and reviewed 2026-07-17, including live empirical validation of the required 15-example corpus, revision above adopted.** Phase 4 has NOT started and will not start until Wael gives explicit, separate approval for that specific transition.
