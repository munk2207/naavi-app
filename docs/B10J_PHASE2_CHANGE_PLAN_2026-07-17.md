# B10j — Phase 2: Change Planning

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. Builds on `docs/B10J_PHASE1_PROBLEM_DEFINITION_2026-07-17.md` (reviewed, Approved 9.8/10, two wording revisions adopted). Touches Protected Core (prompt drives Action Rules creation — same governance class as B9a) — automatically requires Phase 3 technical review before coding, per governance §4.

Scope is bounded by Phase 1 §5: narrowing the Layer 2 classifier's location exception so it stops swallowing genuinely compound self+third-party location requests, and adding the missing location-specific self-alert-primary handling to the Path B prompt so it produces the correct shape once it receives those requests.

---

## 1. Files that will change

| File | Classification | Change | Risk |
|---|---|---|---|
| `supabase/functions/naavi-chat/index.ts` | Backend (Protected Core — Layer 2 classifier, shared across ALL action types, not just location) | **Narrow the location "CRITICAL EXCEPTION" (line 1668)** so it still force-classifies genuine single-action location phrasing ("alert me at Costco," "text Bob when I arrive home") as `action`, but explicitly carves out the case where the message ALSO contains an independent self-reminder component separate from a third-party send ("remind me to X... and text/email/call Y Z") — that combination must classify as `chat`, exactly mirroring how the identical two-action shape already works for time triggers. | High — this is the single shared classifier prompt for every `SET_ACTION_RULE` intent; imprecise wording risks reclassifying existing, already-proven single-action location phrasing (the vast majority of location alerts in this codebase — B9x, B10h, B9m, and others all depend on "text Bob when I arrive at X" staying a single deterministic action) |
| `supabase/functions/get-naavi-prompt/index.ts` | Backend (Protected Core — Path B system prompt, shared across ALL alert types) | **Add a location-specific "SELF-ALERT PRIMARY RULE"** mirroring the existing time-trigger rule (line 625-630) plus at least one worked example showing a compound location request producing self-primary body + `task_actions` for the third party — so once the classifier change above routes these requests to Path B, Path B knows the correct shape to produce (mirroring line 616-618's time-trigger worked example). | Medium — additive (new rule + example), but this is the one shared system prompt for every alert type Path B handles; must not alter existing worked examples or rules for other trigger types |

**No change to `hooks/useOrchestrator.ts`, `report-location-event/index.ts`, `evaluate-rules/index.ts`, `_shared/alert_body.ts`, or `naavi-voice-server/src/index.js`.** Phase 1 §2.3/§2.4 confirmed these are not defective in themselves — they faithfully process whatever `action_config` they're handed. The defect is entirely upstream, in what gets generated before any of these files ever see the request. Fixing it there means the downstream code needs no changes at all.

---

## 2. Proposed change (for Phase 3 review — not yet applied)

**Design choice: route compound location requests to Path B (chat), not teach the deterministic path directly.** Phase 1 §5 left this open as an alternative. Chosen here because time-triggered compound requests already use exactly this mechanism, proven and shipped — reusing an existing, working pattern is lower-risk than building new compound-detection logic inside the deterministic `buildActionConfirm` location branch, which would be a second, independently-maintained implementation of the same "is this actually 2 actions" judgment the classifier prompt already makes for time triggers. Per Rule 19 (refactor over layer): extend the existing mechanism rather than build a parallel one.

**(a) `naavi-chat/index.ts` — narrow the location exception, line 1668.**

Current wording (relevant excerpt):
> "CRITICAL EXCEPTION: 'alert me at \[place\]'... Classify these as action SET_ACTION_RULE regardless of what follows. Never apply the time-anchor rule to location-based messages."

Proposed addition, appended immediately after the existing exception text (not replacing it — the Costco-style single-action case must keep working exactly as today):
> "This exception applies only when the ENTIRE message is a single location-alert request — either a self-alert with no third party ('alert me at Costco'), or a single notification naming exactly one recipient ('text Bob when I arrive at X'). It does NOT apply when the message additionally contains an independent self-reminder component separate from a third-party send — e.g. 'remind me to \[task\] when I arrive/leave \[place\] AND \[send/text/email/call\] \[someone\] \[message\]'. That combination is 2 distinct actions (a self-reminder + a third-party send), and must classify as chat, exactly as the identical shape already does for time-triggered requests — regardless of the location exception above. e.g. 'Remind me when I arrive home to lock the door AND send SMS to Bob' → chat (2 actions), NOT action."

**Precision requirement for Phase 3 to verify, not assumed here:** this wording must key off the presence of a *distinct self-reminder task* ("remind me to X," where X is not itself a message to send) co-occurring with a *distinct third-party send verb* ("and text/email/call Y \[message\]") — not merely the presence of any third-party name. A location alert that names a third party as its ONLY recipient ("text Bob when I arrive home") must NOT be affected; there is no separate self-reminder component in that phrasing, so it correctly remains a single action. Phase 3 should test this precision explicitly (§4).

**(b) `get-naavi-prompt/index.ts` — add location-specific self-alert-primary handling**, immediately after the existing location-alert section (near line 1905, following B10h's fix location):

New rule, mirroring line 625:
> "LOCATION SELF-ALERT PRIMARY RULE: When the user says 'remind me' about arriving/leaving a place — even if they also say 'and text/email/call \[someone\]' — the PRIMARY action MUST be a self-alert (no `to_phone`/`to_name` on the primary `action_config`). The third party's send goes in `action_config.task_actions` ONLY, exactly as the time-trigger case already works."

New worked example, mirroring line 618:
> "'Remind me when I arrive home to lock the door AND send SMS to Bob' → ONE alert — self-reminder body ('Lock the door.') + task_actions for Bob ('I'm home' or whatever message was given) in the SAME set_action_rule call. trigger_type='location', location='home', direction='arrive', action_config={body:'Lock the door.', task_actions:[{type:'send_sms', to_name:'Bob', body:\"I'm home.\"}]}."

### Acceptance criteria — what Phase 5 must verify

1. Reproducing Phase 1's exact failing phrasing ("Remind me when I arrive home to lock the door AND send SMS to Bob") now produces a self-primary alert with `task_actions` for Bob — not Bob-as-primary with a `tasks` note. Verified via direct `action_rules` row inspection, matching Phase 1 §2.1/§2.2's evidence shape in reverse.
2. Firing that alert (live simulation, same method as Phase 1 §2.2) delivers the self-reminder to the user (on their own channels) AND a separate message to Bob via `task_actions` — both, independently, not merged into one third-party-only send.
3. **No regression on existing single-action location phrasing** — "alert me at Costco" (the original problem the exception was written to solve) must still classify as `action`, not `chat`/time-anchor confusion. "Text Bob when I arrive at 50 Elm St" (no self-reminder component — B10h's own tested shape) must still classify as a single third-party action, unaffected.
4. A location alert with ONLY a self-reminder and no third party at all ("remind me to lock the door when I get home") is unaffected — still a single action, still works exactly as before this change (this shape never had the bug — Phase 1 §2 only reproduced the combined self+third-party case).
5. `get-naavi-prompt`'s existing worked examples and rules for time, email, weather, and contact_silence triggers are byte-identical after this change — confirmed by diff, not by re-reading the whole file.
6. **Classifier regression evidence, not just a prompt diff (per Phase 2 review feedback).** Identical prompt text elsewhere in the file does not guarantee identical classifier *behavior* once new instructions are added nearby. Phase 5 must run the existing single-action location corpus (per §6's 15-example validation) back through `classifyIntent` post-change and confirm every one still returns `level: "action", intent: "SET_ACTION_RULE"` — not inferred from the diff, observed from the classifier's actual output.
7. B10g's Phase 7 manual test (blocked on this fix, per the holding list's current Tier 1 note) can now be completed using natural phrasing, producing a real `task_actions` row on a location-triggered rule that B10g's fix (already deployed to staging) correctly executes.

---

## 3. Regression impact

| Area | Impact | Why |
|---|---|---|
| Voice commands | **Affected.** `classifyIntent` and `get-naavi-prompt` are both shared across mobile and voice — a voice user saying the identical compound phrase gets the same fix, with no voice-server file change needed. Must be verified live on both surfaces during Phase 5/7, not assumed from mobile testing alone. | Both surfaces share these prompts |
| Geofencing | Not directly touched — this is a classification/generation-time change; `report-location-event`'s execution logic is unchanged. | No file in the execution path is edited |
| Time-triggered alerts | **Must remain byte-identical.** The classifier prompt edit is additive (new sentence appended to the location exception); the `get-naavi-prompt` edit is a new section, not a modification of the existing time-trigger rule/example. Phase 5 must diff-confirm neither existing block changed. | Same shared prompt strings serve both trigger types |
| Every other `SET_ACTION_RULE` phrasing not involving this specific compound shape | **Should be unaffected**, but this is the highest-risk area — the classifier prompt is one shared string covering every action-level intent (SET_REMINDER-equivalent, DELETE_RULE, ADD_CONTACT, DRAFT_MESSAGE, etc. all share this same system prompt). An imprecise edit could shift classification behavior for unrelated phrasing in ways not anticipated by this plan. Phase 5 must re-run the full `prompt-regression.ts` suite, not just B10j-specific tests. | Same file, same shared system prompt |
| SMS / call alerts | **Affected — this is the fix's purpose.** Compound location requests will now correctly deliver two independent sends instead of one merged, misdirected one. | Direct purpose |
| Staging build | **No mobile app change, no APK build required.** Both files are Edge Functions (`naavi-chat`, `get-naavi-prompt`) — server-side deploy only, via `npx supabase functions deploy <name> --no-verify-jwt --project-ref xugvnfudofuskxoknhve`, staging first. | Confirmed by §1 — `hooks/useOrchestrator.ts` is not touched |

---

## 4. Risk classification

**Overall: High.** Both files are shared, single-instance system prompts covering every alert type and every surface (mobile + voice) — this is the same class of risk CLAUDE.md's own "AI CODING DISCIPLINE" section and B9a's classification already warn about (prompt changes to the classifier "have historically caused regressions elsewhere in this codebase," per the earlier size/scope discussion this session). Unlike B10g (pure addition, zero existing blast radius) or B10h (a narrow, single-purpose guard), this change edits live classification logic that every `SET_ACTION_RULE` request already passes through.

**The two files carry different risk shapes:**
- **`naavi-chat/index.ts` (classifier):** the precision requirement in §2(a) is the crux — the wording must distinguish "third party is the sole recipient" (must stay single-action) from "third party is a SEPARATE recipient alongside a distinct self-reminder" (must become 2-action/chat). Getting this wrong in either direction either reintroduces this exact bug (too narrow) or breaks every existing single-action location alert (too broad — the single highest-value regression to avoid, given how many already-shipped items depend on that classification: B9x, B10h, B9m, B10g, B10d). **Phase 3 must specify the exact wording, not just the principle**, and should consider whether a few additional worked examples (single-action location phrasings that must NOT be reclassified) belong directly in the prompt as negative guardrails, the way other rules in this file already use contrastive examples.
- **`get-naavi-prompt/index.ts` (Path B):** lower risk — purely additive, new rule + example, no existing text modified. Main risk is subtle interference with Claude's handling of unrelated location-alert phrasing if the new rule's wording is ambiguous enough to be misapplied — mitigated by keeping the new rule narrowly scoped ("only when a self-reminder AND a third-party send are both present"), matching the time-trigger rule's own scoping.

**Compounding factor, not present in B10g/B10h:** this is the *third* prompt-level change to `naavi-chat`'s classifier or `get-naavi-prompt` this session's broader history (following the general pattern already visible in B9l, B9i-followup, F15, and others) touching the same shared files — Phase 5's full regression suite run (not just B10j's own tests) is non-negotiable here, more so than for either prior fix this session.

---

## 5. Explicitly deferred (per Phase 1 §5 — not part of this Phase 2's implementation)

- **Whether the deterministic path itself should instead detect this compound pattern directly**, without ever routing through Path B — considered in §2 above and not chosen, for the stated reason (reuse the proven time-trigger mechanism rather than build a parallel one). Not revisited unless Phase 3/5 finds the chat-routing approach doesn't work reliably in practice.
- **Whether `buildAlertBody`/`report-location-event` should be hardened as a defense-in-depth backstop** against merging `tasks` into a third-party-only alert body (Phase 1 §5) — a Layer-4-style guard, independent of this classifier/prompt fix. Not designed here; a candidate for its own follow-up if Phase 5 wants an additional safety net, but not required for this fix to be correct.
- **Whether the same compound-request gap exists for contact_silence or weather-triggered alerts** (Phase 1 §5) — untested, out of scope for this plan, which is specifically about the location exception at `naavi-chat/index.ts:1668`.
- **Checking production for existing exposure** (`trigger_type='location' AND action_config->'to_phone' IS NOT NULL AND action_config->'tasks' IS NOT NULL`, per Phase 1 §3) — recommended before this promotes to production, not before Phase 3/4 proceeds on staging.
- **The recurring "built for time, never mirrored for location" prompt-coverage pattern** (Phase 1 §6) — noted, not scoped as its own audit item here.

---

## 6. Next step

Phase 3 — Technical Review (Before Coding), mandatory per governance §4 (Protected Core) and given the High risk classification in §4 — **not started, and will not be started without Wael's own separate, explicit go-ahead**, per the Phase-Gate Approval Rule. **No code has been written.**

Phase 3 should specifically resolve: (a) the exact, final wording of §2(a)'s classifier addition; (b) whether additional negative worked examples (single-action location phrasings) should be added directly to the classifier prompt as guardrails; (c) the exact wording and placement of §2(b)'s new Path B rule/example, confirmed not to disturb any existing text via diff; (d) confirm `prompt-regression.ts`'s current test set is sufficient to catch a regression here, or whether new negative-control tests are needed before implementation, not just after.

**Required before Phase 3 can authorize Phase 4 (per Phase 2 review feedback — not optional):** validate the proposed classifier wording against a representative set of **at least 15 existing production/staging single-action location phrasings** — pulled from real `action_rules` rows and/or the classifier prompt's own existing worked examples (e.g. "alert me at Costco," "text Bob when I arrive home," "email Sarah when I reach work," "alert me when I arrive at the office," and others spanning self-only and third-party-only shapes) — confirming each still classifies as `action`/`SET_ACTION_RULE`, not `chat`, under the revised wording. This is specifically to catch the failure mode the reviewer flagged: English-semantics wording like "contains an independent self-reminder component" could plausibly over-match simple third-party-only phrasings that merely happen to be phrased with "when" clauses similar to a self-reminder's. This validation must run before implementation is authorized, not discovered afterward in Phase 5.

---

## 7. Phase 2 review record (2026-07-17)

Reviewer feedback received via Wael. Rated 9.7/10. Two recommendations, both adopted:

1. **Phase 3 must validate the classifier wording against ≥15 existing single-action location phrasings before implementation is authorized** (§6, new paragraph) — the reviewer's specific concern: wording like "contains an independent self-reminder component" is English semantics, and could plausibly over-match simple third-party-only phrasings such as "Text Bob when I arrive home" or "Email Sarah when I reach work" that merely happen to use a similar "when" clause structure. This validation is now a required Phase 3 gate, not a Phase 5 discovery.
2. **New acceptance criterion 6 (renumbered from a Phase 5-only prompt-diff check):** classifier regression evidence — running the existing single-action location corpus back through `classifyIntent` post-change and confirming it still returns `SET_ACTION_RULE` for every one — not inferred from a prompt diff alone, since identical surrounding text doesn't guarantee identical classifier behavior once new instructions are added nearby.

Reviewer's stated assessment: the core architectural decision (route to Path B rather than teach the deterministic path a second way) correctly avoids creating a second independent implementation of "is this 2 actions," consistent with the duplication-avoidance direction of recent fixes; scope discipline (explicit "will NOT change" list) praised as preventing unplanned expansion; acceptance criteria rated concrete and measurable; risk analysis praised for correctly identifying the classifier (not the prompt) as the more dangerous file, and explaining why.

**Verdict: Approved, with the two recommendations above required before Phase 4.** This is the reviewer's assessment of the plan's quality — it is not, by itself, authorization to begin Phase 3. Per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3): moving to Phase 3 requires Wael's own separate, explicit go-ahead for this specific transition, regardless of this review verdict.

---

## 8. Status

**Phase 2 drafted and reviewed 2026-07-17, revisions above adopted, approved with two required items ahead of Phase 4.** Phase 3 has NOT started and will not start until Wael gives explicit, separate approval for that specific transition.
