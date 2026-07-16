# F19 Track B — Phase 3: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3. Reviewer: ChatGPT (External Technical Reviewer). Subject: `docs/F19_TRACKB_PHASE2_CHANGE_PLAN_2026-07-15.md` (1c implementation plan, 1d decision point, 1e investigation plan). Required because 1c touches Protected Core (Voice orchestration) and was classified High Risk.

Two review rounds occurred before Phase 4 (implementation) began.

---

## Round 1 — review of the original Track B Phase 2 draft

**Verdict:** "I would approve this Phase 2 document to proceed to Phase 3." — approval was conditional on one addition, not unconditional; treated as Round 1 rather than final sign-off.

**What the reviewer praised:**
1. The three-way split itself — "The biggest improvement over many engineering plans is that it does not try to force all three findings into code changes: 1c → implementation plan. 1d → explicit decision point. 1e → investigation plan. That separation substantially reduces the chance of solving the wrong problem."
2. 1c's minimalism — "no schema changes, no runtime logic changes, no resolver changes, only improving Claude's instructions for populating an already-existing field. That matches the Phase 1 evidence." Also approved reusing mobile's exact wording rather than inventing new phrasing: "Reusing a known-good pattern is generally lower risk than creating two different behaviors for mobile and voice."
3. The regression analysis — "correctly identifies the true risk: not breaking recipient resolution, but accidentally causing Claude to populate `to` when the user is actually referring to themselves. That is exactly the regression I would worry about."
4. 1d's decision-point framing — "the strongest improvement from the earlier version... Instead of saying 'we fixed 1d,' the document now says verify after 1c. That is evidence-driven engineering... I particularly like that it defines: trigger, reassessment question, next action depending on outcome... That makes it auditable."
5. 1e's scoping — "The logging is intentionally scoped as temporary diagnostic instrumentation rather than permanent telemetry. That is good governance. You are collecting only the information needed to isolate the problem before changing behavior."

**One request:** "I would add one explicit acceptance criterion for 1c... that gives Phase 5 something objective to verify." Provided the shape directly: four criteria covering the fix itself and the two regression cases (self-alert, self-override).

**One wording suggestion (§6):** strengthen "High Risk" to explain *why* a text-only change still counts — "High Risk because prompt behavior changes globally across every voice interaction, even though only descriptive text is modified."

---

## Response — Phase 2 revised

Both were adopted directly into `docs/F19_TRACKB_PHASE2_CHANGE_PLAN_2026-07-15.md`: a 4-item "Acceptance criteria" subsection was added under §2, and §6's risk statement was rewritten to state explicitly why a text-only change to this file is still Protected Core / High Risk.

---

## Round 2 — final review

**Verdict:** "Decision: Approved." Scored across six categories — Phase 1 alignment, Implementation scope, Regression planning, Acceptance criteria, Governance compliance (all ✅), Hidden assumptions (None identified) — with an explicit "Ready for Phase 4: Yes."

**One optional enhancement, explicitly non-blocking:** add a fifth acceptance criterion covering the unresolved-contact path — "'Text UnknownPerson when I arrive at Costco' should follow the existing unresolved-contact behavior (ambiguity/not-found flow) and must not silently fall back to a self alert... That would give complete coverage of: success, self, no recipient, unresolved recipient." Framed explicitly as optional: "This is not required before implementation... It isn't necessary to proceed, but it would make the verification suite even more complete."

---

## Review resolution table

| Review finding | Action taken | Status |
|---|---|---|
| Acceptance criteria missing for 1c | Added 4-item list to Phase 2 §2 (success case + 3 regression guards) | Closed |
| Risk wording should explain *why* text-only = High Risk | Rewrote Phase 2 §6 with explicit reasoning | Closed |
| Fifth criterion (unresolved contact) | Added as criterion 5 — full coverage of success/self/no-recipient/unresolved | Closed |
| 1d treated as fix vs. decision point | Already correctly framed in Phase 1/2 as a reassessment step, not a fix | Accepted (no change needed) |
| 1e logging scope (temporary vs. permanent) | Already scoped correctly as temporary diagnostic instrumentation | Accepted (no change needed) |

---

## Implementation boundaries confirmed

Added per Round 2 reviewer observation — "a process enhancement, not something missing from this document," making explicit a discipline already followed in practice, so Phase 6 can audit against it directly rather than infer it:

- **Authorized:** `naavi-voice-server/src/anthropic_tools.js` — the exact wording in Phase 2 §2, applied verbatim to `set_location_rule_chain` and `set_location_rule_address` only.
- **No additional files approved.** No other file in `naavi-voice-server` or elsewhere was authorized for this round.
- **No opportunistic refactoring approved.** Nothing else in `anthropic_tools.js` (the chain-brand enum, other tool definitions, `ACTION_CONFIG`'s other fields) is in scope, however tempting to clean up while the file is open.
- **No architectural changes approved.** No new fields, no resolver/logic changes, no changes to how `set_action_rule` vs. the two location tools route.
- **1d and 1e explicitly excluded from this authorization** — 1d has no approved implementation at all (decision point, not yet triggered); 1e has no approved implementation (investigation plan only, not yet executed).

Only the Phase 2 implementation scope above is authorized. Phase 4 must be checked against this list, not against what "seemed reasonable while in the file."

---

## Outcome

**APPROVE.** All five acceptance criteria are in place, risk classification is explicit and justified, and no hidden assumptions were identified across two review rounds. Phase 4 (implementation) proceeded with Wael's explicit go-ahead: the exact approved wording (§2 of the Phase 2 plan) was applied to `naavi-voice-server/src/anthropic_tools.js`, verified syntactically valid (`node -c`), diffed against the plan to confirm an exact match, and committed locally (`0d78050`). Not yet pushed/deployed — Railway auto-deploys from `main` on push, so for the voice server (unlike Supabase Edge Functions) the push itself is the deploy step, pending separately.

1d and 1e were not implemented in this round, per their own Phase 2 framing — 1d awaits reassessment after 1c is deployed and verified; 1e's logging plan has not been executed.
