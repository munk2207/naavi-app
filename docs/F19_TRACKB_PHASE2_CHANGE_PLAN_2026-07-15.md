# F19 Track B — Phase 2: Change Planning

**Fourth revision (this revision) — see §5b, planning the two follow-ups from Phase 1's fourth revision (`docs/F19_TRACKB_PHASE1_PROBLEM_DEFINITION_2026-07-15.md` §2h, approved): reading `action_rules_user_label_unique`'s actual definition, and flagging its untracked-migration status to T1a. §5a (1e's confirm-gate fix) is unchanged, already shipped and verified — historical record only.**

**Third revision — 1e now has a proven root cause and an implementation plan, see §5a.** The investigation Phase 2 originally scoped (§5, second revision) was run live on production (2026-07-15, ~23:17-23:18 EDT) and found a precisely-located defect, documented in `docs/F19_TRACKB_PHASE1_PROBLEM_DEFINITION_2026-07-15.md` third revision §2g. §5's original investigation plan is left unchanged below as historical record; §5a is new.

**Second revision.** Written after Phase 1's second revision (§2f — the barge-in/STT truncation finding, surfaced while verifying 1c live) and after 1c itself shipped, deployed, and was verified live twice (see `docs/SESSION_HANDOFF_2026-07-15_F19_TRACKA_CLOSED_TRACKB_1C_SHIPPED.md`). **§1-3 (1c) are unchanged from the original revision and are historical record only — 1c is closed, already reviewed by Phase 3 (2 rounds, APPROVE), implemented, and verified. Nothing in §1-3 is reopened by this revision.** Only §4 (1d) and §5 (1e) are revised, per Wael's confirmed scope: 1d gets a concrete live-test procedure (was previously only a trigger/question, never executed); 1e's logging plan is widened to capture the `[Barge-in]` flag per turn and is explicitly combined with the pre-existing, unfixed barge-in/STT truncation bug (`project_naavi_deepgram_first_word_truncation`) into one investigation rather than two, per Phase 1 §6's recommendation.

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. Builds on `docs/F19_TRACKB_PHASE1_PROBLEM_DEFINITION_2026-07-15.md` (second revision, approved by ChatGPT with the softened 1d framing adopted). Touches Protected Core (Voice orchestration). Per Phase 1's evidence, this is **High Risk** for 1c (Protected Core prompt/schema change affecting every voice call — already shipped), and **Low Risk** for the 1d live-test and 1e's logging addition (diagnostic/read-only, no behavior change) — see revised §6.

As Phase 1 concluded, 1c/1d/1e are three different work types and are planned separately, not as one undifferentiated change:

- **1c — full implementation plan** (this document's main content).
- **1d — explicit decision point, not a fix.** No file changes proposed. Reassessed after 1c ships and is verified.
- **1e — investigation plan, not an implementation plan.** No fix designed; a diagnostic logging plan is scoped instead.

---

## 1. Track B-1c — files that will change

| File | Classification | Change | Risk |
|---|---|---|---|
| `naavi-voice-server/src/anthropic_tools.js` | Shared Logic (Protected Core — voice's tool-use schema, read on every voice call) | Add recipient-capture instruction + worked examples to both location tool descriptions (`set_location_rule_chain`, `set_location_rule_address`) — see §2 for exact proposed text. No schema/field changes: `to` already exists in `ACTION_CONFIG` (line 100); this is purely descriptive text Claude reads to decide when to populate it. | **High** — Protected Core, every voice call reads this file's tool descriptions; a badly-worded addition risks over-eager `to` population on self-alerts (regression), not just under-population (today's bug) |

No other files. This is a single-file, additive-text change — mirrors mobile's already-shipped, already-tested fix (`get-naavi-prompt/index.ts`, deployed and verified in Track A) as closely as the file's different structure allows.

---

## 2. Proposed text (for Phase 3 review — not yet applied)

**`set_location_rule_chain`** — add one example and the imperative line, appended after the existing "DO NOT use this tool for personal keywords" sentence:

```
'- "text Bob when I arrive at Costco Merivale" with Bob a known contact → chain_brand="Costco", place_name="Costco Merivale", action_type="sms", action_config={to:"Bob", body:"Arrived at Costco."}.\n\n' +
'IMPORTANT: When the user names a recipient ("text Bob", "tell my wife", "message Sarah") anywhere in the sentence, ALWAYS put that name in action_config.to — never drop it, even though this tool\'s primary subject is the place, not the recipient. This applies exactly the same way it does for the general set_action_rule tool\'s non-location triggers.'
```

**`set_location_rule_address`** — add two examples and the same imperative line, appended after the existing "alert me at Joe's place" example:

```
'- "text Bob when I arrive at 123 Maple St" with Bob a known contact and the address confirmed → CALL with place_name="123 Maple St", action_type="sms", action_config={to:"Bob", body:"Arrived at 123 Maple St."}.\n' +
'- "tell my wife when I leave the office" → CALL with place_name="office", direction="leave", action_type="sms", action_config={to:"wife", body:"He\'s leaving the office."}.\n\n' +
'IMPORTANT: When the user names a recipient ("text Bob", "tell my wife", "message Sarah") anywhere in the sentence, ALWAYS put that name in action_config.to — never drop it, even though this tool\'s primary subject is the place, not the recipient. This applies exactly the same way it does for the general set_action_rule tool\'s non-location triggers.'
```

Wording deliberately mirrors mobile's shipped fix (same imperative sentence, same example shape: named contact + literal address) rather than inventing new phrasing — minimizes the risk of introducing a new, different bug on voice while fixing this one.

### Acceptance criteria (added per Phase 3 review) — what Phase 5 must verify

1. "Text Bob when I arrive at Costco" (Bob a known contact) produces `action_config.to = "Bob"`.
2. "Email me when I arrive home" does **not** populate `action_config.to` — self-alert phrasing stays a self-alert.
3. Existing self-override scenarios (e.g. "email me at jane@x.com when I arrive at Costco") continue passing unchanged — no `to`/`to_name` leaks in alongside a `self_override_*` field.
4. Existing location reminders with no recipient at all (e.g. "remind me to buy milk when I arrive at Costco") continue passing unchanged — no spurious `to` gets invented where the user named no one.
5. "Text UnknownPerson when I arrive at Costco" (not a real contact) follows the existing unresolved-contact behavior (`resolve-recipient` returns `ambiguous`/`not_found`, the row fails closed per Phase 1 §2c's evidence) and must **not** silently fall back to a self-alert.

All five must pass before 1c is considered verified — 1 and 4 test the fix itself; 2, 3, and 5 are the regression guard, together covering all four real outcomes: success, self, no-recipient, and unresolved-recipient.

---

## 3. Regression impact (1c)

| Area | Impact | Why |
|---|---|---|
| Voice commands | **Affected — primary surface.** Every voice call reads this file. Self-alert phrasing ("email me at X when I arrive at Y" — the F15/self-override case, already shipped) must NOT regress into populating `to` — the added examples and imperative are scoped to "when the user names a recipient," which self-override phrasing never does (it names an address, not a person). Needs explicit negative-case testing (see §5). | Direct file touched |
| Geofencing | Not affected. No change to `useGeofencing.ts`, trigger detection, or OS-level geofence registration — only Claude's tool-call content. | No overlap |
| Gmail integration | Not affected. | No overlap |
| Calendar integration | Not affected. | No overlap |
| Reminders | Not affected. `tasks`/`list_name` guidance in `ACTION_CONFIG` is untouched. | No overlap |
| SMS / call alerts | **Affected — this is the fix's purpose.** Location-triggered SMS/email to a named third party should now resolve correctly instead of dropping the name. | Direct purpose |
| Onboarding | Not affected. | No overlap |
| Staging build | **N/A for voice** — per F17 Phase 2's own finding, voice has no staging environment; there is one Railway service (production) and one branch it deploys from (`main`). This change ships directly to the only environment voice has, same as F17/F12's voice-side work did. | Confirmed in `docs/F17_PHASE2_CHANGE_PLAN_2026-07-14.md` §0 |

---

## 4. Track B-1d — explicit decision point (revised this revision — now a concrete test procedure, no file changes)

Per Phase 1's approved, softened conclusion: **no independent implementation is justified now.** No files are proposed for change under 1d in this document. **Trigger condition is now met** — 1c shipped, deployed, and was verified live twice (`0d78050`, per the Track A/B close-out handoff) — so this revision turns the previously-scheduled question into an executable procedure rather than leaving it open-ended.

**Reassessment question (unchanged):** does any row reach fire time with a named-but-unresolved third-party recipient, on the current (post-1c) codebase?

**Procedure (new this revision):**
1. Place a real voice call to production. Say a phrasing matching 1d's original two reproductions as closely as possible — e.g. *"Text [a real, known contact name] when I arrive at Costco"* (reuses 1c's own verified test shape) and, separately, a phrasing naming a **real contact whose resolution is expected to succeed but where the call is interrupted/barge-in occurs mid-name** if that can be induced, to probe whether 1d and the barge-in bug (§5 below) can compound.
2. Confirm via Railway logs (`naavi-voice-server` Deploy Logs) that the tool call captured `to` with the spoken name.
3. Have Wael create a temporary test row via the Supabase SQL editor (no service-role key available in this environment, by design — same two-person workflow used for 1c's verification) and fire the dwell-deferred event directly, exactly as done for 1c.
4. Inspect the fired alert: did it reach the named third party, or silently fall back to self (the original 1d symptom)?
5. Delete the temporary test row after.

**If it still fails post-1c:** 1d becomes its own Phase 1 (a genuine independent defect would have been found, not assumed).
**If it resolves correctly:** the residual gap — `report-location-event` has no fire-time re-resolution safety net for a destination that resolved successfully at creation but goes stale before firing — remains as a separately-tracked, lower-severity open item (not closed, not urgent, explicitly not conflated with 1d's original "silently misfires to self" framing).

This procedure is diagnostic only (a live test + log/DB inspection) — **no code changes are proposed for 1d in this document.** If step 4 shows a failure, that finding becomes its own Phase 1, not an on-the-spot fix.

---

## 5. Track B-1e — investigation plan (revised this revision — widened scope, not an implementation plan)

Per Phase 1 (original): root cause not proven, no code-level bug found in the confirmation path (there is no JS state machine there to have a bug in). Per Phase 1 §2f (this session's live finding): STT truncation during barge-in is **proven** to occur in this system in a closely related scenario, and is compatible with 1e's symptom — promoted to the first hypothesis this investigation should test, not a preselected conclusion. Per Phase 1 §6: the barge-in/STT truncation bug (`project_naavi_deepgram_first_word_truncation`, open since 2026-04-19, 4 candidate fixes never implemented) should be investigated **together with 1e, not sequentially**, since they may share one root cause and one fix. This revision widens the logging plan accordingly — still a single live-traced reproduction with logging, not two separate investigations.

**Proposed investigation (files that would change — temporary, diagnostic only):**

| File | Classification | Change | Risk |
|---|---|---|---|
| `naavi-voice-server/src/index.js` | Backend (Protected Core) | Add temporary console logging around the Claude tool-use turn loop, covering **both** (a) confirmation turns where the action under discussion carries a `self_override_*` field (1e's original scope) **and** (b) any turn immediately following a `[Barge-in]` event (widened scope, catches the truncation bug generally, not only inside 1e's specific flow). Per turn, log: the raw STT/Deepgram transcript text, **whether `[Barge-in]` fired for that turn** (new field this revision), Claude's exact response (speech + whether it called a tool), and if a tool call was made, its populated fields. Railway captures console output already (per CLAUDE.md's "check Deploy Logs" pattern) — no new logging infrastructure needed. | **Low** — logging only, no behavior change, easily reverted |

**Reproduction method (widened):**
1. Re-run Phase 1's original 1e phrasing ("Text me at [phone] in 3 minutes") on production voice with logging active, capture the full per-turn transcript-vs-response trace, and inspect for: (a) whether the phone number STT produces is consistent turn-to-turn (digit-transposition hypothesis), (b) whether `[Barge-in]` fired on any of the repeated-confirmation turns (tests whether 1e is actually an instance of the barge-in truncation bug), and (c) what Claude's exact speech/reasoning was on each repeated ask (prompt-ambiguity hypothesis, tested only if (a) and (b) come back clean).
2. Separately (same logging, same live session where practical), attempt to reproduce the barge-in truncation bug directly per its own existing test recipe (`project_naavi_deepgram_first_word_truncation` memory: speak during TTS playback, check whether the leading word(s) are dropped in the Deepgram FINAL transcript) — confirms the bug is still live on current code and captures a fresh trace to compare against 1e's trace.
3. Compare the two traces. If both show the same signature (`[Barge-in]` immediately preceding a truncated transcript), that supports one shared root cause and one shared fix, per Phase 1 §6. If 1e's trace shows failures with no `[Barge-in]` marker at all, that rules out the STT hypothesis for 1e specifically and points back to mechanism 2 (prompt-level ambiguity, Phase 1 §2e).

This determines which of Phase 1 §2e's two candidate mechanisms (or a third, not yet considered) is real, and whether 1e and the barge-in bug are one problem or two — **not designed as a fix here**, since Phase 1 explicitly found no bug to fix yet in 1e's own path, only a symptom without a located cause, and the barge-in bug's own fix directions (4 candidates in its memory file) are not evaluated or chosen by this document either.

**Predefined confirmation criteria (added per Phase 3 review — decided before the investigation runs, not fitted to the logs afterward):**

| Verdict | Evidence required (from the four logged fields: transcript, `[Barge-in]`, Claude response, tool call) |
|---|---|
| **Confirmed STT/barge-in mechanism** | Repeated reproductions show transcript corruption immediately following `[Barge-in]`, **and** the resulting tool call (or lack of one) matches what the corrupted transcript would produce — i.e., Claude acted correctly on what it actually received; the input itself was wrong. |
| **Confirmed prompt mechanism** | Transcript remains correct and consistent across turns, **no** `[Barge-in]` present, and Claude still repeatedly fails to act (re-asks, doesn't call the tool) despite receiving the same correct input each time. |
| **Neither confirmed** | Neither pattern holds cleanly across the reproduction attempts (e.g., transcripts are correct but inconsistent for a reason other than barge-in, or the failure doesn't correlate with either signal). In this case, do not force a verdict — treat 1e as still "root cause not proven" and continue investigating rather than picking the closer-looking option. |

This table is the fixed interpretation rule for the trace collected in §5 — logs are read against it, not the other way around, so an ambiguous trace doesn't get retroactively fitted to whichever hypothesis looks more plausible after the fact.

**Logging removal criteria (added per Phase 3 Round 4 review — explicit exit condition, so diagnostic instrumentation cannot silently outlive its purpose):** the temporary logging added under this Phase 2 is removed once **all three** of the following are true:
1. The required traces have been captured — at minimum, one reproduction attempt of 1e's original phrasing and one reproduction attempt of the barge-in test recipe (§5 reproduction method, steps 1-2), with enough turns logged to reach one of the three predefined verdicts above (or to conclusively record "neither confirmed").
2. Conclusions have been documented — the verdict reached (per the table above) is written up, in the same style as this project's other investigation write-ups (a Phase 1 document, if the trace confirms a mechanism worth fixing; or a short closure note in this document's revision history, if the verdict is "neither confirmed" and no further action is triggered).
3. If a verdict is reached that warrants a fix, that fix has either been scoped as its own Phase 1 (per §7's recommendation to Phase 3) or the decision to defer it has been explicitly recorded.

**Once all three are met, logging removal happens under one of two paths, not left open-ended:** (a) as its own small implementation task (a single-file revert of the diagnostic logging added here, its own minimal Phase 2/4 given the low risk), or (b) folded directly into the subsequent fix's own implementation, if a fix is approved and scoped soon after the verdict — in which case the fix's own Phase 4 removes the temporary logging as part of the same commit rather than as a separate step. Either path must be recorded in this document's revision history (or a superseding revision) so the logging's lifecycle is auditable end to end — added here, used for X, removed there.

**Not part of this Phase 2 (original, §5 scope):** removing the temporary logging (scoped above as its own follow-on task, not executed here), choosing/implementing a fix for the barge-in truncation bug (its 4 candidate directions remain unevaluated), or any code change to the confirmation flow itself — those depend entirely on what the combined trace shows and would need their own Phase 1 (this investigation's findings) before a fix could be planned.

---

## 5a. Track B-1e — implementation plan (new this revision — Phase 1 approved, this is the fix)

Per `docs/F19_TRACKB_PHASE1_PROBLEM_DEFINITION_2026-07-15.md` third revision §2g/§7, **now fully Approved** (wording condition applied, then a follow-up review confirmed it — both rounds recorded in that document's §7): the live-traced investigation found a "Neither confirmed" verdict on the two original hypotheses, then a proven implementation defect (with one contributing detail, the origin of the first 409, still open but not load-bearing for this fix). This section proposes the fix for that proven defect, structured per the approved Phase 1's forward guidance as two distinct design questions (below) before settling on one mechanism.

**Defect, restated:** `naavi-voice-server/src/index.js:12030-12044` classifies every action as either (a) gated by the existing `list_confirm_gate.js` module (LIST_* types only) or (b) pushed to `backgroundActions`, executed fire-and-forget *after* TTS is sent, result discarded except for a console log (lines 12194-12199). `SET_ACTION_RULE` with `trigger_type: 'time'` falls into (b). There is no confirm-before-execute gate for this action, unlike `location` triggers (which use `pendingLocation`, an explicit two-turn state machine) or `LIST_*` actions (which use `list_confirm_gate.js`, the same pattern proposed here).

### Two distinct design questions (per Phase 1 review §7 — evaluated separately before choosing an implementation)

The reviewer's forward guidance on the approved Phase 1 revision: don't treat this as one undifferentiated fix. Evaluated here as two questions, each with its own alternatives, before settling on a single mechanism.

**Question 1 — Truthfulness of user feedback:** how does Naavi avoid telling the user something ("Done," or even "I'll do X, say yes to confirm") before the system knows the outcome?
- *1a — await before any speech.* Block TTS on `executeAction()`'s result for every turn that proposes this action. Fully truthful, simplest to reason about, but adds a network round-trip's latency to the very first proposal turn too — a cost paid even on the (common) case where the user hasn't confirmed anything yet.
- *1b — speak provisionally, correct on failure.* Keep today's latency profile; if the awaited result arrives after TTS and shows failure, issue a second, separate corrective message. Avoids 1a's latency cost but adds a delayed-correction mechanism and a second speech event on the failure path.
- *1c — defer the truth claim to the confirmed turn.* The first turn speaks a *proposal*, not a completion claim ("I'll do X, say yes to confirm" — true regardless of outcome, since nothing has been attempted yet). Only the second turn, after the user confirms, speaks a completion claim — and only that turn needs to await the result. No latency cost on the proposal turn; full truthfulness on the completion claim.

**Question 2 — Conversation control:** how does Naavi avoid the same underlying write firing more than once, whether from Claude re-proposing the action or the user saying "yes" more than once?
- *2a — idempotency at the write layer.* Give each proposed action a stable client-generated ID; make the backend de-duplicate on it instead of rejecting repeats as conflicts. Doesn't touch voice-server turn logic, but changes `action_rules`' write contract for every caller, not just this one path — larger blast radius.
- *2b — a standalone per-call de-dup flag.* Track "this exact action is already pending" as its own piece of state, separate from any confirmation mechanism. Narrow, but adds a second state variable alongside whatever answers Question 1.
- *2c — one execution, gated on confirmation.* Store the action once when first proposed; execute it exactly once, only when the user confirms; clear the pending state immediately before executing. Claude's tool call reaching the server more than once no longer matters, because only a confirmed "yes" ever reaches `executeAction()`.

**Why one mechanism answers both here:** option 1c (defer the truth claim) and option 2c (execute once, on confirmation) turn out to be the same mechanism — a store-then-confirm gate. That's not assumed going in; 1a/1b and 2a/2b were real independent alternatives that could have produced two separate fixes (e.g., 1b's correction message plus 2a's idempotency key, with no gate at all). They're recorded above so this choice is auditable. The gate is chosen because it's the exact pattern already shipped and proven for `LIST_*` actions (`list_confirm_gate.js`) — reusing a known-good mechanism over inventing two new ones.

**Proposed fix — reuse the exact pattern already proven for `LIST_*` actions, applied to `trigger_type: 'time'` `SET_ACTION_RULE`:**

| File | Classification | Change | Risk |
|---|---|---|---|
| `naavi-voice-server/src/action_rule_confirm_gate.js` (new file) | Shared Logic (Protected Core) | Pure helper module, modeled directly on `list_confirm_gate.js`: `shouldGateAction(action)` returns true only for `action.type === 'SET_ACTION_RULE' && action.trigger_type === 'time'`; `buildConfirmationSpeech(action)` builds the "I'll [do X]. Say yes to confirm, no to cancel, or tell me what to change." line from the action's label/config, same shape as the existing tool-generated speech; `failSpeechForAction(action, result)` builds a truthful failure message (e.g., "I couldn't set that up — you may already have an identical alert.") for the 409/duplicate case specifically, since that's the proven failure mode. No I/O, no side effects — same design constraint as `list_confirm_gate.js`. | **Low** — new pure module, no existing code touched by its addition alone |
| `naavi-voice-server/src/index.js` | Backend (Protected Core — voice orchestration) | Two changes: (1) at the action-classification site (~line 12030), add an `else if (actionRuleGate.shouldGateAction(action) && !skipGateForChain)` branch before the `backgroundActions.push(action)` fallback — sets `pendingActionRuleCreate = action`, sets `finalSpeech = actionRuleGate.buildConfirmationSpeech(action)`, does **not** execute. (2) At the message-loop top (~line 9883, alongside the existing `pendingListAction` block), add a `pendingActionRuleCreate` handler with the same three-way shape already proven for lists: **yes** → `await executeAction(saved, userId)`, speak `"Done."` on `result.success`, speak `actionRuleGate.failSpeechForAction(saved, result)` on failure (truthful, not "Done"); **no** → "Cancelled."; **other** → clear and fall through to normal Claude handling. | **High** — Protected Core, changes when/whether a time-trigger alert actually gets created; a bug here risks either double-gating (asks to confirm twice) or under-gating (regresses to today's silent-fire behavior) |

**Explicitly out of scope for this fix (matches what was proven, not extended beyond it):** `location` triggers (already gated via `pendingLocation`, untouched); `LIST_*` actions (already gated, untouched); other `backgroundActions`-routed trigger types (`email`, `calendar`, `weather`, `contact_silence`) — the same fire-and-discard architecture likely affects them too, but that is **not proven** by this session's evidence (only `time` was reproduced and traced). Extending the gate to those types now would be scope creep beyond what §2g actually demonstrated — flagged as a follow-up investigation, not folded into this fix.

### Acceptance criteria — what Phase 5 must verify

1. "Text me at [phone] in 3 minutes" → Naavi's first response is a confirmation ("I'll send an SMS to [phone] in 3 minutes. Say yes to confirm...") and **no** `[Action] SET_ACTION_RULE` log line appears yet (nothing written to the DB before confirmation).
2. Saying "yes" once → exactly one `[Action] SET_ACTION_RULE ... status 200` (or equivalent success) log line, and Naavi says "Done." — not a repeat of the confirmation question.
3. Repeating "yes" a second time after criterion 2 already succeeded → does not re-attempt the write (the pending state was cleared after the first confirmed execution) — falls through to normal Claude handling instead of looping.
4. If the write fails (e.g., a genuine duplicate-timestamp conflict) → Naavi speaks a truthful failure message, not "Done."
5. Saying "no" after the confirmation → "Cancelled.", no DB write attempted.
6. Location-triggered alerts ("alert me when I arrive at Costco") and list actions ("add milk to my list") — regression check, both continue working exactly as before (neither routes through the new gate).
7. A self-override *location* alert ("email me at X when I arrive at Costco") — regression check, unaffected (trigger_type is `location`, not `time`, so this gate never engages).

### Regression impact

| Area | Impact | Why |
|---|---|---|
| Voice commands | **Affected — primary surface**, but narrowly: only `SET_ACTION_RULE` calls with `trigger_type: 'time'`. All other action types (SET_REMINDER, ADD_CONTACT, DRAFT_MESSAGE, etc.) are untouched — they still go through `backgroundActions` exactly as before. | Direct files touched |
| Geofencing | Not affected. `location` triggers keep using `pendingLocation`, untouched by this change. | No overlap |
| Gmail integration | Not affected. | No overlap |
| Calendar integration | Not affected — `trigger_type: 'calendar'` SET_ACTION_RULE stays on the background path, unchanged (not in scope, see above). | No overlap |
| Reminders | Not affected — `SET_REMINDER` is a different action type entirely, untouched. | No overlap |
| SMS / call alerts | **Affected — this is the fix's purpose.** Time-triggered self/self-override alerts now execute exactly once, only after confirmation, with a truthful spoken result. | Direct purpose |
| Onboarding | Not affected. | No overlap |
| Staging build | N/A for voice — same as every other voice-side Track B change this session (no staging environment for voice; push to `main` is the only deploy). | Confirmed in F17 Phase 2 §0 |

---

## 5b. Follow-ups from Phase 1's fourth revision (`§2h`) — two diagnostic/documentation items, no code

Per Phase 1 §6's fourth-revision addition, approved: two follow-ups, neither an implementation.

**Item 1 — read `action_rules_user_label_unique`'s actual definition.** Phase 1 §2h inferred the constraint is likely unconditional (no `enabled = true` scoping) from a single observed collision against a disabled row — that inference should not be treated as proven, and no fix should be designed on it alone.

| Action | Classification | Change | Risk |
|---|---|---|---|
| Read the constraint definition via Supabase SQL editor | Diagnostic, read-only | Run `SELECT indexdef FROM pg_indexes WHERE indexname = 'action_rules_user_label_unique';` (or equivalent `\d action_rules` in a `psql`-compatible view) against production. No table/data modified. | **None** — pure read |

**Procedure:** Wael runs the query above in the Supabase SQL editor (`https://supabase.com/dashboard/project/hhgyppbxgmjrwdpdubcx/sql`), pastes back the `indexdef` (or constraint definition) text. That confirms or corrects §2h's "likely unconditional" inference with the literal `CREATE UNIQUE INDEX` / `ALTER TABLE` statement — direct evidence, not inference.

**Expected outcomes (added per Phase 3 review — defined before the query runs, so the next decision point is predetermined by evidence, not decided after the fact):**

| Outcome | What the `indexdef` shows | Next step |
|---|---|---|
| **A — partial, scoped to `enabled = true`** | The index definition includes a `WHERE enabled = true` (or equivalent) clause. | §2h's "likely unconditional" inference was wrong — the July 15 collision against a disabled row needs its own explanation (a separate open question). No behavioral change implied by the constraint itself; **no new Phase 1 required** for the constraint's scope, though the collision itself may still need investigating separately. |
| **B — unconditional, no scoping** | No `WHERE` clause at all — applies to every row regardless of `enabled`. | Confirms §2h's inference. This is the "real users repeating identical phrasing get permanently blocked" risk described in §2h, now proven rather than inferred. **A new Phase 1 is required** to decide whether/how to fix (e.g., add `enabled = true` scoping, redesign the label as a dedup key, or accept the current behavior as intentional). |
| **C — something else** (different columns, different WHERE clause, doesn't match either expectation) | The definition doesn't match A or B. | **A new Phase 1 is required** regardless — the actual mechanism needs its own fresh investigation rather than being retrofitted into either predefined outcome. |

**Rule:** any outcome requiring a behavioral change (B, or C if it turns out to need one) becomes its own new Phase 1 — not folded into this Phase 2, and not implemented ad hoc off the query result.

**Outcome, confirmed 2026-07-16:** **B.** `pg_indexes` read shows `WHERE (label IS NOT NULL) AND (label <> ''::text)` — a null/empty guard only, no `enabled` scoping. Per the rule above, a new Phase 1 was opened: **B9z**, `docs/B9Z_PHASE1_PROBLEM_DEFINITION_2026-07-16.md`. Item 1 is closed — the query ran, the outcome was evaluated against the predefined table, and the predetermined consequence (new Phase 1) was executed exactly as planned.

**Item 2 — flag the untracked-migration finding to T1a.** Per `[[project_naavi_architecture_integrity_audit]]` (T1a, spun out of F19 Phase 1, tracked in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`) — T1a's own scope already covers exactly this class of finding (a live production schema object with no git-tracked origin). This is not a Track B fix; it's a pointer into an already-open, separately-scoped audit.

| Action | Classification | Change | Risk |
|---|---|---|---|
| Add an entry to `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`'s T1a section | Documentation | One new line: `action_rules_user_label_unique` — live in production since ≥2026-06-14, used by `manage-rules`, no corresponding file in `supabase/migrations/`. Cite `docs/F19_TRACKB_PHASE1_PROBLEM_DEFINITION_2026-07-15.md` §2h as the discovery evidence. | **None** — documentation only |

**Explicitly not part of this Phase 2:** designing a fix for the untracked constraint (writing a migration to formally adopt it, adding an `enabled = true` scope if Item 1 shows it's missing, or redesigning the label-based dedup key entirely per §2h's open design question). Any of those would need their own Phase 1 investigation once Item 1's evidence is in — this Phase 2 only plans the two read/document steps needed to close out what's currently open.

### Regression impact (§5b)

Both items are read-only or documentation-only — no code path, no user-facing behavior, no deploy. All eight regression categories (voice, geofencing, Gmail, calendar, reminders, SMS/alerts, onboarding, staging) — **not affected**, by construction.

---

## 6. Risk classification — overall (revised this revision)

**1c: High** — already shipped under this classification (unchanged, historical). **1d: Low** — the live-test procedure in §4 is read-only against production (a real call + a temporary DB row Wael creates and deletes via SQL editor, no code path changed) — not yet executed. **1e's investigation (§5): Low** — diagnostic logging, already shipped (`fb63a29`) and used to produce the trace in Phase 1 §2g. **1e's fix (§5a): High** — Protected Core (`naavi-voice-server/src/index.js` + new gate module), changes actual execution/confirmation behavior for a real action type — already shipped and verified live (`74a05d6`). **§5b's two follow-ups (new this revision): None** — read-only SQL query and a documentation line, no code, no deploy.

---

## 7. Next step

**1d and original-scope 1e (§4, §5):** unchanged from the prior revision — still pending Phase 3 sign-off before execution, not yet run.

**1e's fix (§5a):** already reviewed (Phase 3 Round 5, Approved), implemented, shipped, and verified live (`74a05d6`) — historical record, not pending anything.

**§5b's two follow-ups (new this revision):** governance's Phase 3 requirement is explicitly scoped to Medium/High Risk changes; §5b is classified None (read-only query, one documentation line, no code, no deploy). On that basis a Phase 3 round isn't strictly required — but flagging that explicitly here rather than silently skipping it, since every other change this session went through review regardless of stated risk. Recommend Wael confirm whether to send §5b for a (likely very short) Phase 3 pass anyway, or proceed straight to running Item 1's query and adding Item 2's holding-list line, given the near-zero risk.
