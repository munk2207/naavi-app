# F19 Track B — Phase 3: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3. Reviewer: ChatGPT (External Technical Reviewer). Subject: `docs/F19_TRACKB_PHASE2_CHANGE_PLAN_2026-07-15.md` (1c implementation plan, 1d decision point, 1e investigation plan). Required because 1c touches Protected Core (Voice orchestration) and was classified High Risk.

**Four review rounds total.** Rounds 1-2 (below) reviewed the original Phase 2 draft and gated 1c's implementation (already shipped — see Outcome). Round 3 reviewed the Phase 2 *revision* — 1d's live-test procedure and 1e's widened, barge-in-inclusive investigation plan. Round 4 (added this revision) reviewed Round 3's own output and added the logging removal criteria.

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

---

## Round 3 — review of the Phase 2 revision (1d procedure + widened 1e investigation)

**Context:** submitted after 1c shipped, deployed, and was verified live twice, and after Phase 1's second revision (§2f) surfaced the barge-in/STT truncation finding. Subject: the revised §4 (1d — turned from a scheduled question into a concrete 5-step live-test procedure) and revised §5 (1e — logging widened to capture a `[Barge-in]` boolean per turn, explicitly combined with a parallel reproduction of `project_naavi_deepgram_first_word_truncation`).

**Governance assessment:**

| Area | Assessment |
|---|---|
| Historical integrity | ✅ Excellent |
| Scope control | ✅ Excellent |
| Investigation planning | ✅ Excellent |
| Evidence discipline | ✅ Excellent |
| Risk classification | ✅ Appropriate |
| Hidden assumptions | None identified |

**One recommendation (non-blocking):** predefine, before running the 1e investigation, exactly what log evidence constitutes each possible verdict — so an ambiguous trace can't be interpreted differently after the fact depending on which hypothesis looks more attractive in hindsight. Proposed shape:
- **Confirmed STT/barge-in mechanism:** repeated reproductions show transcript corruption immediately following `[Barge-in]`, and the resulting tool call matches the corrupted transcript.
- **Confirmed prompt mechanism:** transcript remains correct across turns with no barge-in, but Claude repeatedly fails to act despite receiving consistent input.
- **Neither:** continue Phase 1 investigation — another mechanism is involved, don't force a verdict onto an ambiguous trace.

**Response — adopted directly.** Added as a new subsection ("Predefined confirmation criteria") in Phase 2 §5, positioned as the fixed interpretation rule the 1e/barge-in trace is read against — logs are checked against the table, not the other way around.

**Verdict:** **Approved.** "The document appropriately transitions 1d from a conceptual decision point to a concrete verification procedure and strengthens the 1e investigation by prioritizing the newly supported STT/barge-in hypothesis without treating it as a confirmed root cause. The remaining work stays investigative rather than implementation-oriented, which is consistent with the evidence gathered so far."

### Round 3 — Implementation boundaries confirmed

- **1d — authorized:** the live-test procedure in Phase 2 §4 only (place a real call, inspect Railway logs, have Wael create/fire/delete a temporary test row via the Supabase SQL editor). **No code changes authorized for 1d** — if the test reveals a live failure, that becomes its own Phase 1, not an in-session fix.
- **1e — authorized:** temporary diagnostic console logging in `naavi-voice-server/src/index.js` only, exactly as scoped in Phase 2 §5 (transcript, `[Barge-in]` flag, Claude's response, tool-call fields) — applied to the confirmation-turn path and to any turn following a `[Barge-in]` event. **No other files.** No opportunistic refactoring. No changes to the confirmation flow's actual logic — logging only.
- **Not authorized in this round:** any fix to the barge-in/STT truncation bug itself (its 4 candidate directions remain unevaluated and unchosen); any fix to 1e's confirmation loop; removal of the temporary logging (deferred until after the trace is read).
- Interpretation of whatever the logging produces is bound by the predefined criteria table in Phase 2 §5 — a verdict outside those three categories is not permitted; an ambiguous result must be recorded as "neither confirmed."

### Round 3 outcome

**APPROVE.** Phase 2's revision (1d procedure, 1e widened investigation plus predefined confirmation criteria) is cleared for Phase 4: run the live test for 1d, and add the temporary logging + run the combined 1e/barge-in reproduction, per the implementation boundaries above.

---

## Round 4 — review of Round 3 (logging lifecycle)

**Context:** submitted after Round 3's approval, reviewing Round 3's own output (predefined confirmation criteria + implementation boundaries) before Phase 4 begins.

**Governance assessment:**

| Area | Assessment |
|---|---|
| Historical continuity | ✅ Excellent |
| Scope authorization | ✅ Excellent |
| Investigation governance | ✅ Excellent |
| Evidence interpretation | ✅ Excellent |
| Auditability | ✅ Excellent |
| Hidden assumptions | None identified |

**One recommendation (non-blocking):** make the logging removal criteria explicit. After the investigation is complete — required traces captured, conclusions documented, a Phase 1 written if one is needed — the temporary logging should be removed under its own small implementation task, or explicitly folded into the subsequent fix. Framed as "not a technical concern... simply another governance checkpoint to ensure diagnostic instrumentation does not remain in production longer than intended."

**Response — adopted directly.** Added a "Logging removal criteria" subsection to Phase 2 §5: three explicit exit conditions (traces captured, conclusions documented, any warranted fix scoped or its deferral recorded), and two allowed removal paths (standalone follow-on task, or folded into the fix's own Phase 4) — either path must be recorded in the document's revision history so the logging's full lifecycle (added → used → removed) is auditable.

**Verdict:** **Approved.** "This Phase 3 revision appropriately authorizes the next investigative stage without expanding its scope into implementation. The predefined confirmation criteria, explicit implementation boundaries, and separation between diagnostic work and future fixes all strengthen the governance process."

### Round 4 — Implementation boundaries confirmed (supersedes Round 3's boundaries on this one point)

- Round 3's authorization (1d live-test procedure; 1e temporary logging in `naavi-voice-server/src/index.js`) is unchanged and still in force.
- **Added this round:** the temporary logging authorized under 1e is **not** open-ended. Its removal is pre-authorized as a follow-on action once Phase 2 §5's three exit conditions are met — either as its own minimal task, or bundled into whatever fix Phase 1(if any) eventually scopes. No separate Phase 3 review is required for the removal itself, since it was reviewed and approved here in advance — but the removal (and which path was taken) must still be recorded in this document's revision history or a superseding revision, per governance's auditability standard.

### Round 4 outcome

**APPROVE.** Phase 2 (with the logging removal criteria now added) and this Phase 3 document are both cleared for Phase 4.
