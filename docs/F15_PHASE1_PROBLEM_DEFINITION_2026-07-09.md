# F15 — Phase 1: Problem Definition (FOURTH REVISION — Defect B root cause PROVEN by runtime evidence)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1. No fix is implemented here (Phase 1 states cause, Phase 2 plans the change) — but per governance §2, root cause for Defect B is now proven, confirmed by direct runtime observation (Evidence B11), with a corrected causal chain (B9/B10/B11). Found during manual staging validation of F12 (Scenario 1, staging APK build 302) — see `docs/SESSION_HANDOFF_2026-07-06_F12_COMPLETE_STAGING_APK302.md` for the scenario script this session was executing when both defects below were discovered.

This revision follows directly from the third: external review of the third revision requested one explicit runtime confirmation before accepting "root cause proven" from code-reading alone — specifically, proof that a failing request actually enters the `classifyIntent()` → `buildActionConfirm()` path. That check was run (Evidence B11) and **it corrected an error in the third revision's Evidence B9**: the classifier does not, in fact, always discard the recipient — in the live test it was captured correctly (`to_name:"Bob"` present in `classification.params`). The actual, sole proven cause is narrower than the third revision claimed: `buildActionConfirm`'s location branch (B10) discards a recipient that Layer 2 did successfully extract. Changes from the third revision are in §9.

Phase 2 (Change Planning) can now resume for Defect B with an actual, runtime-confirmed fix direction (§5) — narrower in scope than the third revision proposed. Defect A's Phase 2 design (`F15_PHASE2_CHANGE_PLAN_2026-07-09.md` §1) is unaffected and remains approved.

---

## 1. What exactly is broken

Two independent defects, both confirmed live on **staging** this session. Both surfaced under F12's own Scenario 1 validation test ("literal/named destination resolves correctly") — meaning F12's shipped fix (staging APK 302, commits `201914f`/`b034e10`/`cc6a23e`/`6a505ba`) does not fully deliver the behavior it was built for.

**Defect A — self-alert with an explicit literal destination override is unsupported.** "Email me at [a specific address]" is a self-alert (destination = the user), but the user is overriding *which* address/number receives it, not asking Naavi to notify a third party. F12's Recipient Resolver (`resolve-recipient`) was scoped to third-party destinations only (per `docs/F12_PHASE2_CHANGE_PLAN_2026-07-05.md` §1); this self-override case was never in scope and remains unhandled.

**Defect B — third-party named-contact recipient dropped, isolated to the two location-specific tools.** "Text [contact name] when I arrive at [address]" is squarely within F12's stated scope (Defect A of F12: "literal/third-party destinations never resolve"). It still fails on staging: the recipient name never reaches `action_config.to` at all for `set_location_rule_address`/`set_location_rule_chain`. **New this revision (§4): the general, non-location `set_action_rule` tool does not have this problem** — it correctly captures `to`. The defect is narrower than originally framed — isolated to the two location tools, not third-party recipient handling generally.

## 2. What evidence proves the problem

### Defect A

**Evidence A1 — direct DB read, staging, this session.** User said (mobile app, exact phrasing confirmed by Wael): *"Email me at aggan2207@gmail.com when I arrive at 262 fireside dr"* (email address as originally typed to me contained a transcription typo on Wael's part; the app request used the correct address). Resulting row, queried directly via service-role key against `action_rules` (`xugvnfudofuskxoknhve`):
```
id: 9d21de3f-157d-47bf-b19b-26d63898000a
created_at: 2026-07-09 03:37:17 EST
place_name: 262 Fireside Dr
action_type: sms
action_config: {}
```
`action_type` never became `email`, and `action_config` is completely empty — no `to`, `to_email`, or `body` reflecting the address at all.

**Evidence A2 — schema has no field to carry the value.** `supabase/functions/_shared/anthropic_tools.ts:110-128` (`ACTION_CONFIG`, shared by every action-rule tool including both location tools):
```js
// action_config common shape — Decision A: `to` is name only; no to_phone/to_email here.
const ACTION_CONFIG = {
  type: 'object',
  properties: {
    to: { type: 'string', description: 'Contact NAME only (e.g. "wife"). Orchestrator resolves phone/email.' },
    body: { type: 'string', description: 'Message body.' },
    tasks: { type: 'array', items: { type: 'string' }, ... },
    list_name: { type: 'string', ... },
  },
  required: [],
  additionalProperties: false,
};
```
No `to_email`/`to_phone` property exists anywhere in this schema, and `additionalProperties: false` blocks anything not declared. There is no slot for a literal address in a self-alert. This is a direct, file-and-line-cited cause — not inferred.

**Evidence A3 — prompt actively instructs Claude to omit any destination for self-alerts.** `supabase/functions/get-naavi-prompt/index.ts:1035`:
```
For self-alerts (user wants to be notified themselves): set body = message text. Do NOT include to_phone, to_email, or 'to' — the orchestrator routes self-alerts to ${userName}'s phone/email automatically and fans out to SMS + WhatsApp + Email + Push.
```
This rule has no exception for "self-alert with an explicit destination override."

**Root cause statement for Defect A:** The immediate architectural limitation is proven — the schema provides no field for an explicit self-destination override (A2), and the prompt explicitly instructs Claude to omit one (A3). No evidence currently suggests an additional downstream cause, but the absence of a downstream cause has not been separately tested. Phase 2's design for Defect A (approved, unaffected by this revision) treats A2/A3 as the confirmed proximate cause.

### Defect B

**Evidence B1 — reproduced twice, staging, first session, direct DB reads.**

Attempt 1 — *"Text Bob when i arrive at 120 Sunning Hills Crescent"*:
```
id: 8a41328a-ada1-4350-a9ba-6b8a4297d5c9
created_at: 2026-07-09 03:41:12 EST
action_type: sms
action_config: {}
```
Attempt 2 — *"Text bob when i arrive at 138 baldwin st."*:
```
id: a4d8b08a-4e92-4f00-a574-7e988b40685b
created_at: 2026-07-09 03:59:53 EST
action_type: sms
action_config: {}
```
Both attempts: no `to`, `to_phone`, or `contact_id` in the stored row.

**Evidence B2 — Bob is a single, cleanly resolvable contact (rules out ambiguity/not-found as the cause).** Wael's screenshot of Bob's Google Contacts card: one contact named "Bob," Mobile `+1 343-333-2567`, Home email `aggan2207@gmail.com`.

**Evidence B3 — if `to:"Bob"` had reached the orchestrator, resolution failure would have blocked rule creation entirely, not produced an empty-but-created row.** `hooks/useOrchestrator.ts:3253-3300`: when `toName` is truthy, `resolve-recipient` is called; on `not_found`/`ambiguous`/`invalid`, `recipientBlocked = true` and the code `continue`s — **no DB insert happens at all**. Since rows *were* produced, `toName` must have been empty at line 3231 — Claude's tool call never included `to`.

**Therefore the first component that can be proven to have lost the recipient is the tool boundary** — the `tool_use` payload Claude emits back to the app. Everything downstream (orchestrator dispatch, `resolve-recipient`, contact lookup, DB write) is exonerated by B3.

**Evidence B5 — Hypothesis Validation experiment, run this session, per `F15_PHASE2_CHANGE_PLAN_2026-07-09.md` §2.1. Hypothesis RULED OUT.** The leading hypothesis from the first revision (tool description lacked a worked third-party-recipient example) was tested directly: a worked example was added to `set_location_rule_address`'s description (`anthropic_tools.ts`), deployed to staging (`naavi-chat` redeployed), and five live phrasings were run against fresh, previously-unused addresses:

| # | Phrasing | Result |
|---|---|---|
| 1 | "Text Bob when I arrive at 320 Allbirch Rd" | `action_config: {}` |
| 2 | "When I arrive at 3798 Dunrobin Rd text bob" | `action_config: {}` |
| 3 | "Send bob text message when I reach 1075 March Rd" | `action_config: {}` |
| 4 | "Text +13433332567 when I arrive at 1186 Old Carp Rd" (literal phone, spot-check) | `action_config: {}` |
| 5 | "Text bob when i arrive at 122 Woliston Crescent" (confound-free retest, see below) | `action_config: {}` |

**5 of 5 failed identically.** Result #4 is the most conclusive on its own: a literal phone number requires zero contact resolution — F12's `resolve-recipient` detects it by regex, with no possible `ambiguous`/`not_found` outcome. If `to` had reached the orchestrator at all, `to_phone` would have been set with certainty. It was not. **The tool-description-example hypothesis is ruled out — adding the example did not fix it, on any phrasing, including the one with zero resolution ambiguity.**

**Evidence B6 — a real confound was identified and fully resolved; it does not change the conclusion.** Results #1–3 and the original B1 attempts all involved "Bob," and it was later discovered (Wael, live investigation, this session) that Bob was not actually present in the Google account OAuth-connected to this staging test user (`mynaavi2207@gmail.com`) until **2026-07-09, 5:40 AM EST** — confirmed via Google Contacts (desktop), "Added to contacts: Today, 5:40 AM," and independently via a temporary diagnostic function (`whoami-google-diag`, deployed and deleted this session) confirming the connected account and that its OAuth scopes correctly include `contacts`/`contacts.readonly`. Before 5:40 AM, "Bob not found" was the *correct* answer from `lookup-contact` — not a bug. (The contact card Wael was viewing lived in his phone's native Contacts app, which merges multiple synced Google accounts, creating the appearance that Bob was already fully set up when he was not yet in the specific account Naavi uses.)

This confound is fully resolved and does not implicate the conclusion, for two independent reasons: (1) result #4 used a literal phone number, which never depends on contact lookup at all, and still failed; (2) result #5 was run *after* 5:40 AM with Bob fully, verifiably resolvable (confirmed via Naavi's own "What's Bob's contact info" query succeeding immediately beforehand) — and still produced `action_config: {}`. **The defect is confirmed independent of Bob's contact status.**

**Evidence B7 — isolated to the location-specific tools; the general tool works.** A parallel diagnostic was run against the **non-location** `set_action_rule` tool: *"Text Bob at 6 PM today saying happy birthday"* (before the 5:40 AM fix) → *"Text bob at 5:05am saying good morning"* → Naavi responded *"I couldn't find a phone number for Bob in your contacts. Please add them and try again"* — a **live `lookup-contact` call was attempted** (confirmed by the specific, non-generic wording, traced to source in B8 below). This is the opposite outcome from every location-tool test: the general tool correctly captured `to:"Bob"` and reached a real contact lookup; it only failed because Bob genuinely wasn't findable yet (B6 timing). **This isolates Defect B to `set_location_rule_address`/`set_location_rule_chain` specifically — not a general third-party-recipient extraction problem.**

**Evidence B8 — new architectural finding: an undocumented, parallel, server-side recipient-resolution pipeline exists in `naavi-chat/index.ts`, separate from and never touched by F12.** The exact failure string from B7 ("I couldn't find a phone number for... Please add them and try again") was traced via `grep` to exactly one file: `supabase/functions/naavi-chat/index.ts`, appearing in at least three separate branches — a time-trigger fast path (~line 2264-2296), a "T2-intercept" mechanism (~line 3789+), and `MAKE_CALL` (~line 2860+). All three call `lookup-contact` **directly**, bypassing F12's shared `resolve-recipient` resolver entirely. F12's Phase 1/2 governance trail (`docs/F12_PHASE1_PROBLEM_DEFINITION_2026-07-05.md`, `docs/F12_PHASE2_CHANGE_PLAN_2026-07-05.md`) only ever accounted for mobile (`useOrchestrator.ts`) and voice (`naavi-voice-server`) as call sites — this server-side path in `naavi-chat` was never in scope, never audited, never tested by F12's regression suite. This is a real, separate architectural gap: F12's stated goal ("mobile, voice, and `evaluate-rules` call `resolve-recipient` only; none of them call `lookup-contact` directly once this ships" — `F12_PHASE2_CHANGE_PLAN_2026-07-05.md` §1) is not actually true in the current codebase.

**Evidence B9 — a structural discovery, partially corrected by B11 below.** `naavi-chat/index.ts` runs two structurally different systems depending on message shape. For simple single-action requests, a separate, earlier Haiku call (`classifyIntent()`, line 1634-1696, model `claude-haiku-4-5-20251001`, **no tools attached** — free-text JSON extraction against a hand-written prompt) classifies the message and extracts params; when the result is `level:'action'`, the code explicitly **skips Claude's tool-use system entirely** (line 2737: *"Deterministic action — skip Claude entirely"*) and builds the response purely from the extracted params via `buildActionConfirm()`. This structural finding (two parallel systems, location-alert-with-recipient requests take the deterministic one) is confirmed correct by B11. The classifier's own prompt, verbatim, at line 1665, never shows a worked example of a location trigger with a recipient (only the time-trigger example three lines later shows `to_name`) — this remains true and is a real reliability gap, but **the original claim that this is *why* the recipient is lost was tested directly and found wrong (B11).**

**Evidence B10 — confirmed, and now the primary proven cause: the location branch that consumes Layer 2's params never reads a recipient, even when one is present.** `buildActionConfirm`'s `SET_ACTION_RULE` handler, `tt === 'location'` branch (line 1802-1817):
```js
const baseActionConfig: Record<string, any> = { ...((params as any).action_config ?? {}) };
const haikuTasks = String((params as any).tasks ?? '').trim();
if (haikuTasks && !Array.isArray(baseActionConfig.tasks)) {
  baseActionConfig.tasks = [haikuTasks];
}
return { ..., actions: [{ type: 'SET_ACTION_RULE', ..., action_config: baseActionConfig, ... }] };
```
`baseActionConfig` is built only from `params.action_config` and `params.tasks` — `params.to`/`params.to_name` are never read here, **regardless of whether they are present in `params`.**

**Evidence B11 — runtime confirmation, requested by external review before accepting B9/B10 as proven. This corrected B9's causal claim.** A temporary diagnostic was added at the exact decision point (`naavi-chat/index.ts:2737`, the `classification.level === 'action'` gate) to log the live `classification` object to `client_diagnostics` before it reaches `buildActionConfirm`. Deployed to staging; one live test run: *"Text bob when I arrive at 1130 klondike rd"*. Logged result:
```json
{
  "level": "action",
  "intent": "SET_ACTION_RULE",
  "params": {
    "to_name": "Bob",
    "location": "1130 klondike rd",
    "direction": "arrive",
    "trigger_type": "location",
    "body": "Arrived at 1130 Klondike Rd"
  }
}
```
**`to_name: "Bob"` IS present.** This directly contradicts B9's claim that the classifier discards the recipient — Haiku generalized past its own worked examples and extracted it anyway, at least in this run. B9's structural finding (two parallel systems; this request takes the deterministic one) stands, confirmed by this same log. B9's causal claim (recipient lost *at classification*) does not stand — corrected here rather than left uncorrected.

**Full causal chain, corrected and now proven with runtime evidence, not just code-reading:** the recipient survives classification (B11: `to_name:"Bob"` is present in `classification.params`) → `buildActionConfirm`'s location branch discards it anyway, because it was never coded to look for it (B10: line 1802-1817 reads only `action_config`/`tasks`) → action reaches the client and the orchestrator with `action_config` already empty (B3) → nothing downstream (resolve-recipient, contact lookup, DB write — all proven correct by F12) ever gets a chance to run. **B10 alone is the proven cause; B9's prompt asymmetry is a separate, real reliability gap (Haiku is not guaranteed to generalize past its own examples on every call) worth fixing for robustness, but is not what caused this specific, repeated failure.**

**This also still fully explains why the Hypothesis Validation experiment (B5) and the earlier raw-tool_use diagnostic (instrumented at `naavi-chat/index.ts:3319`) had no effect:** both targeted the tool-use code path (`client.messages.create` + `NAAVI_TOOLS`, line 3309), which B11 now confirms directly (not just infers) is never reached for this class of message.

**Root cause statement for Defect B: PROVEN, for the observed mobile single-action location-alert flow.** Confirmed by direct runtime observation (B11), not code-reading inference alone. The primary, sufficient cause is B10. Scope is explicitly bounded to single-action requests taking the Layer 2 path (per B11's live confirmation and §7's mobile-only scope) — multi-action or `chat`-level requests take the different, tool-use path and are not covered by this root-cause statement.

### Ruled out during this investigation

- **Contact ambiguity / not-found for Bob** — ruled out by B2 (single clean contact) and B3 (a resolver failure would have blocked the row, not produced an empty one).
- **UI-display-only issue (data present, just not shown)** — ruled out by A1/B1: the underlying `action_config` column is genuinely empty, confirmed by direct service-role DB query.
- **Tool-description example gap (the first revision's leading hypothesis)** — ruled out by B5: adding the example did not fix any of 5 live tests.
- **Bob's contact-resolvability as the cause of the location-tool failures** — ruled out by B6: failures reproduce with a literal phone number (no lookup needed) and with Bob fully, verifiably resolvable.
- **General third-party-recipient extraction being broken** — ruled out by B7: the non-location tool correctly captures `to`. The defect is specific to the two location tools.

## 3. Why F12's own test suite (377/379 green) did not catch either defect

`tests/catalogue/session-2026-07-06-f12-high-risk-wiring.ts` and `session-2026-07-05-f12-resolve-recipient.ts` assert on **source-code patterns** — e.g. `expectTruthy(src.includes("{ mode: 'create', to: toName, ... }"))` — confirming the orchestrator *would* call `resolve-recipient` correctly *if* given a `to` value. None of the F12 test files invoke a live Claude call and inspect the actual `tool_use` payload for any phrasing, on any tool. No test file references `ACTION_CONFIG` (`anthropic_tools.ts`) at all. **New this revision (B8): F12's test suite also never touched `naavi-chat/index.ts`'s own parallel resolution branches at all** — those were undiscovered until this session's diagnostic testing, not merely untested by a specific assertion.

## 4. Architectural framing: F15 is a different pipeline layer than F12, not evidence F12 is wrong — and there are two parallel pipelines, not one

**Superseded this revision:** the first two revisions framed this as a single pipeline with one "extraction" stage above a "tool boundary." That was incomplete. There are actually **two separate, parallel request-handling systems** in `naavi-chat`, and location-alert-with-recipient requests take the one that was never instrumented until the third revision — confirmed by runtime observation, not just code-reading, in B11:

```
Speech
  ↓
naavi-chat: classifyIntent() (Haiku, no tools, hand-written JSON prompt)
  ↓ (confirmed by B11: recipient IS present in classification.params here)
  ├─ level='chat' / multi-action ──→ Claude + NAAVI_TOOLS (client.messages.create, line 3309)
  │                                    ← F12/first-two-revisions' "tool boundary" lives here.
  │                                    Correctly resolves recipients when it IS reached (B7).
  │
  └─ level='action', single action ──→ buildActionConfirm() — "skip Claude entirely" (line 2737)
                                         ← Defect B lives here, proven (B10/B11).
                                         Recipient survives classification but is discarded
                                         here — buildActionConfirm's location branch never
                                         reads params.to/to_name, regardless of whether Layer 2
                                         extracted one.
                                           ↓
                                       action_config (already missing `to`) → orchestrator → DB
```

**Refined this revision (B11 correcting B9):** the extraction failure is not "something about the two location tools' schema" (B7's framing, superseded in the third revision) and — corrected here — it is also not "Layer 2 never extracts a recipient for location triggers" (the third revision's B9 claim, which B11's runtime check disproved). The actual, proven cause is one step later and narrower: `buildActionConfirm`'s location branch discards a recipient regardless of whether Layer 2 successfully extracted one. F12's tool-use path (`set_location_rule_address`/`chain`, `resolve-recipient`) remains entirely correct and unexercised by any of this session's location-tool tests, because Layer 2 intercepted every one of them before Claude's tools were ever invoked — that structural finding stands. B7's finding (general `set_action_rule` works) is explained precisely: time-trigger single-action messages also go through Layer 2 and reach a *different* branch of `buildActionConfirm` (the `_ft` time-trigger fast path, B8) that *does* read `to_name` from `params` — unlike the location branch (B10).

**Implication for Phase 2:** still not evidence that F12's implementation is incorrect — F12's resolver, contact lookup, and DB write are all correct and untouched by this defect (B3, B10). The fix belongs in `naavi-chat/index.ts`'s `buildActionConfirm` location branch (line 1802-1817) — the one component proven, by runtime observation, to discard a recipient it actually receives. The classifier prompt (line 1665) is a separate, real reliability gap (not guaranteed to extract a recipient on every call, since it isn't explicitly instructed to) worth improving, but is not required to fix the proven failure. Phase 2 should not modify `resolve-recipient`, `anthropic_tools.ts`'s schemas/descriptions (already tested and ruled out, B5), or the DB write path.

## 5. What alternatives exist (Phase 2 work — not evaluated yet)

**Defect A** candidate directions (unaffected by this revision, unevaluated):
1. Add a schema field to `ACTION_CONFIG` for an explicit self-destination-override (e.g. `self_override_email`/`self_override_phone`) — approved design exists in `F15_PHASE2_CHANGE_PLAN_2026-07-09.md` §1.
2. Extend the prompt's self-alert rule (line 1035) with an exception, paired with (1).

**Defect B — root cause proven by runtime evidence (B10/B11); fix direction narrower than the third revision proposed, not evaluated for risk/regression yet (that is Phase 2):**
1. **Required, sufficient fix:** read `params.to`/`params.to_name` into `buildActionConfirm`'s location branch (`naavi-chat/index.ts:1802-1817`), mirroring how `haikuTasks` is already merged into `baseActionConfig.tasks` (line 1812-1815) — add the equivalent for the recipient into `baseActionConfig`. B11 shows the value is often already present in `params` by the time this branch runs; this alone should fix the observed failure.
2. **Recommended, not required:** also extend Layer 2's classifier prompt (`naavi-chat/index.ts:1665`) with an explicit location-trigger-with-recipient worked example, mirroring the time-trigger case. Not needed to fix B11's specific observed failure (the recipient was already being extracted without it), but removes reliance on the model generalizing past its own examples — B11 confirms it *can* do that, not that it reliably *will* on every call. Worth doing for robustness, scoped as a separate, lower-priority item within the same fix.
3. Downstream of (1), no further change should be needed: `useOrchestrator.ts`'s existing `resolve-recipient` call (F12, already proven correct) picks up `action_config.to` automatically once it's actually present.

Item (1) is a small, precisely located, single-spot change, following an existing working pattern in the same file (the `_ft` time-trigger branch already does this, B8) rather than inventing a new mechanism. Not yet evaluated for regression risk, cross-surface (voice) parity, or edge cases (ambiguous contact at this layer, literal phone/email at this layer, what happens when Layer 2 does *not* extract a recipient despite item 1's absence, etc.) — that evaluation, plus the exact file/risk/regression table, is Phase 2.

**Separately, not part of Defect A or B, but discovered this session and requiring its own scoping (not done here):** the parallel `naavi-chat` resolution pipeline (B8) should be inventoried in full — how many branches exist, whether any of them have their own version of Defect A/B, and whether they should be migrated to `resolve-recipient` per F12's original stated intent. Logged in the holding list as related to F15; not yet given its own Phase 1.

## 6. Why this is a full-governance item, not a same-session fix

Both defects sit in the `SET_ACTION_RULE` / location-alert write path — `action_rules` is explicitly listed as Protected Core (`AI_DEVELOPMENT_GOVERNANCE.md` §4). Per §4, any modification here requires technical review before coding (Phase 3) and after (Phase 6), regardless of risk tier — this applies to `naavi-chat/index.ts`'s Layer 2 system (Defect B's actual, proven location, per B10/B11) exactly as much as it applied to the tool-use system investigated in earlier revisions.

## 7. Scope boundary

This document only investigates the **mobile app** path. Every piece of evidence in §2 was gathered via the mobile app and direct DB/log queries against staging. **Voice parity (`naavi-voice-server`) has not been inspected.** No conclusion should be drawn about voice — working or broken-differently — from this document.

## 8. Cleanup note

Three temporary, non-product diagnostic additions were deployed to staging this session and should be removed once F15 closes — not yet done as of this revision:
1. `whoami-google-diag` (used for Evidence B6) — a standalone, read-only Edge Function, no writes, not referenced by any product code.
2. A raw `tool_use` logger at `naavi-chat/index.ts:3319` (used attempting Evidence B4/B5's follow-up) — proven never to fire for this defect class (B9/B11), harmless but pointless to leave in.
3. The Layer 2 `classification` logger at `naavi-chat/index.ts:2737` (used for Evidence B11) — the one that produced the proof in this revision. Should stay until Phase 2's fix is verified working end to end, then be removed with the rest.

## 9. Revision history

- **2026-07-09, original version:** established Defect A and Defect B via direct DB evidence gathered live during F12 Scenario 1 manual validation; identified F12's test-coverage gap.
- **2026-07-09, first revision, after external technical review:** softened Defect A's root-cause claim; added the tool-boundary sentence to Evidence B3; added §4 (extraction-vs-resolution framing); added §7 (mobile-only scope boundary).
- **2026-07-09, second revision, returning from Phase 2 per the Change Plan's own validation gate:** added Evidence B5 (Hypothesis Validation ruled out, 5/5 failed), B6 (Bob-confound fully resolved, doesn't change conclusion), B7 (general tool works, isolating Defect B to the two location tools), B8 (discovery of `naavi-chat`'s parallel resolution pipeline); rewrote §5's Defect B alternatives around B7's isolation finding, all still unproven.
- **2026-07-09, third revision:** located the actual mechanism via direct code trace rather than further black-box testing. Added Evidence B9 (claimed `naavi-chat`'s Layer 2 intent classifier never extracts a recipient for location triggers) and Evidence B10 (`buildActionConfirm`'s location branch never reads a recipient). Rewrote §4's architectural diagram around two parallel request-handling systems in `naavi-chat`. Root cause status changed from "not proven" to "proven" — **based on code-reading alone, not yet runtime-confirmed.**
- **2026-07-09, this revision (fourth), after external technical review requested one explicit runtime confirmation before accepting the third revision's "proven" claim:** added Evidence B11 — a temporary diagnostic logged the live `classification` object at the exact Layer 2 decision point for one real test. **Result corrected the third revision's Evidence B9:** the classifier *did* extract `to_name:"Bob"` in the live run, directly contradicting B9's claim that the recipient is discarded at classification. The proven cause narrows to B10 alone — `buildActionConfirm`'s location branch discards a recipient it actually receives, not one that was never extracted. Rewrote §4's diagram and explanation accordingly; rewrote §5's Defect B fix to demote the classifier-prompt change from "required" to "recommended for robustness, not needed to fix this specific failure" and elevate the location-branch fix (§5 item 1) as the sole required, sufficient change; softened the root-cause statement to name the specific observed flow (single-action, mobile) rather than an unqualified "proven"; added the two new diagnostics to §8's cleanup list. This is the correction the external review's requested verification was specifically designed to catch — recorded here rather than silently absorbed, per this project's own investigation-integrity standard (§9's third-revision entry already modeled this once, for the first two revisions' tool-boundary framing).

Three related, newly-found, separate defects were logged to the holding list rather than folded into F15's scope: **B9a** (ambiguous channel verbs silently default instead of asking — found while designing Hypothesis Validation phrasings), **B9b** (contact-info query returns email when phone was specifically asked for — found while diagnosing B6), and **B9c** (disabled list still shows as active on the Lists overview screen — unrelated, found during this session's testing, confirmed as a client-side render bug, not a write-path bug).
