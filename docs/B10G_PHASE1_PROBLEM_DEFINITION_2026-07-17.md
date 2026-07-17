# B10g — Phase 1: Problem Definition

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1. No code is written in this document. Touches Protected Core (Action Rules, Notification routing, Geofencing).

**Origin:** found incidentally 2026-07-17 while scoping F5c's Test 1 manual-verification plan (investigating whether a voice+location alert with `task_actions` would be a more realistic repro than a contrived text-message shape). Confirmed via direct code read across every code path capable of firing a location-triggered alert. Not a live production incident like F5c — no user has reported a missing third-party send from a location alert. Found by code inspection, not by a support report.

---

## 1. What exactly is broken

A user can create a **location**-triggered alert (e.g. "when I arrive at Costco, text my son I'm on my way") whose `action_config.task_actions[]` entry is written to the database successfully, exactly as intended. But when that geofence actually crosses and the alert fires, nothing reads `task_actions` at all — the third-party message is never sent, never logged, and never reported as failed. The user experiences total silence on the promised feature with no error anywhere.

This is a **different bug shape than F5c**. F5c (closed 2026-07-17) is a *wrong-recipient* defect — a message sends, but to the wrong person, because fire-time resolution guessed. This defect is a *zero-recipient* defect — for the location-trigger case, the message never sends to anyone, indefinitely, silently, every single time, for as long as the feature exists in this state.

**Severity: assessed as High, not yet Critical.** Unlike F5c, this defect cannot misdirect a real message to an unintended real person — the failure mode is pure omission, not misdirection. But it is a complete, silent failure of an advertised capability (the app lets a user configure it, with no warning that it does nothing), which is itself a trust and reliability defect, not merely cosmetic. No data-protection/privacy risk is present, which is why this is not classified Critical the way F5c was.

**Architectural principle violated:** `report-location-event`'s own docstring (see §2.2) documents that it intentionally duplicates `evaluate-rules`' fan-out logic rather than reusing it, with an explicit instruction to "keep both in sync when changing the fan-out policy." `task_actions` support was added to `evaluate-rules` (F5c, 2026-06-15 original ship) without a corresponding addition to `report-location-event` — the duplication's own stated maintenance contract was not honored when the feature was extended.

---

## 2. Evidence

### 2.1 — `task_actions` IS written for location-triggered rules (proven, direct file:line citation)

`hooks/useOrchestrator.ts:1444-1454`, inside `commitPending`'s location-confirmation branch:
```ts
// F5c — resolve task strings into structured task_actions at set-time
// so evaluate-rules can auto-execute them (send SMS/email) when the
// alert fires, rather than just surfacing them as reminder notes.
const rawTasks = Array.isArray((pending.originalAction?.action_config as any)?.tasks)
  ? (pending.originalAction!.action_config as any).tasks as string[]
  : [];
const resolvedTaskActions = await resolveTaskActions(rawTasks);
const baseActionConfig = pending.originalAction?.action_config ?? {};
const actionConfigWithTasks = resolvedTaskActions.length > 0
  ? { ...baseActionConfig, task_actions: resolvedTaskActions }
  : baseActionConfig;
```
This is the location-alert confirmation flow specifically — the surrounding function builds `trigger_type: 'location'` and inserts into `action_rules` a few lines below (line ~1459-1467) using `actionConfigWithTasks`. `resolveTaskActions()` itself (`hooks/useOrchestrator.ts:65-89`) parses `"text X ..."`/`"email X ..."` task strings into structured `{type, to_name, to_phone/to_email, body}` entries. **The write path exists, is reachable, and produces a real `action_config.task_actions[]` on a real location-triggered row.** This is not a hypothetical shape — `app/alerts.tsx:872-878` independently confirms the shape is expected to exist on location rules (it reads `rule.action_config.task_actions` to render an SMS-recipient summary on the alerts management screen — display only, no execution, confirmed by reading the surrounding component: no `fetch`/send call in that block).

### 2.2 — The real-time geofence fan-out never reads `task_actions` (proven, direct file:line citation + exhaustive grep)

`supabase/functions/report-location-event/index.ts` is the Edge Function the phone's background geofencing task calls the moment a real geofence crossing is detected (per its own docstring, lines 1-7: "Receives geofence crossing events from the mobile app's background task and fires the matching location rule's action"). Its fan-out function, `fireLocationAction` (lines 713-734):
```ts
async function fireLocationAction(
  rule: any,
  admin: any,
  supabaseUrl: string,
  interFnKey: string,
): Promise<boolean> {
  const config  = rule.action_config;
  const toPhone = String(config.to_phone ?? '');
  const toEmail = String(config.to_email ?? '');
  const subject = String(config.subject ?? rule.label ?? 'Location alert from MyNaavi');
  const toName  = String(config.to_name ?? '');
  ...
  const selfOverrideEmail    = String(config.self_override_email ?? '');
  const selfOverrideSms      = String(config.self_override_sms ?? '');
  const selfOverrideWhatsapp = String(config.self_override_whatsapp ?? '');
  const selfOverrideVoice    = String(config.self_override_voice ?? '');

  const body = await buildAlertBody(config, rule.user_id, supabaseUrl, interFnKey, rule.id)
    || `You've arrived at ${rule.label ?? 'your destination'}.`;
```
Every field this function reads off `config` is enumerated above. `task_actions` is not among them. Confirmed exhaustively, not just by reading this one function: `grep -n "task_actions|lookup-contact" supabase/functions/report-location-event/index.ts` returns **zero matches** in the entire file (2026-07-17).

The docstring's own architecture note (lines 25-27) states the duplication was deliberate:
```
Architecture note: does not re-use evaluate-rules/fireAction because that
function is cron-bound. Duplicating the fan-out here keeps report-location-
event self-contained. Keep both in sync when changing the fan-out policy.
```

### 2.3 — The shared alert-body builder does not execute `task_actions` either (proven, exhaustive grep)

`supabase/functions/_shared/alert_body.ts` — the body-construction helper shared by both `report-location-event` and `evaluate-rules` — merges the base `body` field, the plain-text `tasks` checklist array, and connected-list items into the final message *text*. `grep -n "task_actions" supabase/functions/_shared/alert_body.ts` returns **zero matches** (2026-07-17). This rules out the hypothesis that `task_actions` content might be folded into the self-alert's own body text as a substitute for actually sending to the third party — it is not referenced anywhere in this file either.

### 2.4 — The dwell-timer completion cron does not execute `task_actions` (proven, exhaustive grep)

`supabase/functions/fire-pending-dwells/index.ts` — the cron that completes a deferred "dwell" geofence event by calling back into `report-location-event` once a dwell timer elapses. `grep -n "task_actions" supabase/functions/fire-pending-dwells/index.ts` returns **zero matches** (2026-07-17). This closes the one alternate real-time-adjacent path a location alert could fire through besides the direct `report-location-event` call.

### 2.5 — `evaluate-rules` (the only function that DOES execute `task_actions`) structurally excludes `trigger_type: 'location'` (proven, direct file:line citation)

`supabase/functions/evaluate-rules/index.ts:34` — the `ActionRule` type declaration:
```ts
trigger_type: 'email' | 'time' | 'calendar' | 'weather' | 'contact_silence';
```
`'location'` is not a member of this union. This is a structural exclusion, not an accidental gap in string matching.

`supabase/functions/evaluate-rules/index.ts:78-81` — the cron's row-loading query:
```ts
const { data: rules, error: rulesError } = await adminClient
  .from('action_rules')
  .select('*')
  .eq('enabled', true);
```
This query has **no `trigger_type` filter** — it loads every enabled row, location-triggered rows included.

`supabase/functions/evaluate-rules/index.ts:215-234` — `findTriggers()`, called once per loaded row to decide whether that row's trigger condition is currently met:
```ts
switch (rule.trigger_type) {
  case 'email':          return findEmailTriggers(client, rule, now);
  case 'time':            return findTimeTriggers(rule, now);
  case 'calendar':        return findCalendarTriggers(client, rule, now);
  case 'weather':         return findWeatherTriggers(rule, now);
  case 'contact_silence': return findContactSilenceTriggers(client, rule, now);
  default:                return [];
}
```
For a row with `trigger_type: 'location'`, no `case` matches, and the `default` branch returns an empty array of matched triggers. An empty match list means `fireAction` (the function containing F5c's `task_actions` execution block, per `docs/F5C_PHASE1_PROBLEM_DEFINITION_2026-07-17.md`) is **never called** for that row, on any cron tick, ever. The row is loaded, inspected, and silently skipped every single time — not filtered out at the query level, but structurally inert at the switch statement.

**Net effect, precisely stated:** a location-triggered row's `task_actions` are read by exactly zero code paths. `evaluate-rules` loads the row but its own trigger-type switch excludes `'location'` by construction. `report-location-event` and `fire-pending-dwells` (the two functions that DO fire location rows) never reference `task_actions` at all.

### 2.6 — No other execution path exists (proven, exhaustive repo-wide grep)

`grep -rn "task_actions" --include="*.ts" --include="*.tsx" --include="*.js"` across the full repository (2026-07-17) returns exactly 9 files. Each is accounted for:
- `hooks/useOrchestrator.ts` — the write path (§2.1).
- `app/alerts.tsx` — display-only rendering (§2.1), confirmed no send/fetch call in the relevant block.
- `supabase/functions/evaluate-rules/index.ts` — the only execution path, structurally unreachable for `trigger_type: 'location'` (§2.5).
- `supabase/functions/naavi-chat/index.ts` — write-time resolution/disambiguation for **time**-triggered rules only (the F5c-adjacent Turn-1/Turn-2 resolvers and Step 1.4's generic `SET_ACTION_RULE` handler); does not execute sends, only resolves `to_phone`/`to_email` before a rule is written.
- `supabase/functions/get-naavi-prompt/index.ts` — prose instructions to Claude about the `task_actions` shape; not executable code.
- `tests/catalogue/session-2026-06-13.ts`, `tests/catalogue/session-2026-06-14.ts`, `tests/catalogue/session-2026-07-17-f5c-taskactions-resolution.ts` — test files; none assert location-trigger execution of `task_actions`.
- `scripts/diag-taskactions-misfire.js` — a diagnostic query script (reads `action_rules`/`sent_messages`, does not execute anything).

No file outside this list references `task_actions` in any form. `hooks/useGeofencing.ts` (the client-side background geofencing hook) was checked specifically and has zero references — ruling out a client-side execution path parallel to the server-side gap.

**What is not yet proven:** this defect has not been confirmed by an actual live fire — no test has created a location-triggered rule with a `task_actions` entry, triggered `report-location-event` (physically or via a direct API call), and observed `sent_messages` fail to grow for the third party. The evidence above is exhaustive static code analysis (every reachable execution path enumerated and checked), not a runtime observation. Per governance's No Assumptions Rule, this gap is stated explicitly rather than implied as closed — recommended as Phase 2/5's manual verification step, the same discipline F5c applied to its own fix.

---

## 3. Root cause statement

| Finding | Root cause | Confidence |
|---|---|---|
| `task_actions` on a location-triggered rule are never executed by the real-time geofence handler | `report-location-event/index.ts`'s `fireLocationAction` (lines 713-734) never reads `config.task_actions` — confirmed by direct code read and exhaustive grep (zero matches in the file). | **Proven** (static analysis) |
| `task_actions` on a location-triggered rule are never executed by the dwell-completion cron | `fire-pending-dwells/index.ts` has zero references to `task_actions` (exhaustive grep). | **Proven** (static analysis) |
| The only function capable of executing `task_actions` (`evaluate-rules`) structurally cannot reach a location-triggered row | `evaluate-rules/index.ts:34`'s `ActionRule.trigger_type` union excludes `'location'`; `findTriggers()` (line 215-234) falls through to `default: return []` for any unmatched trigger type, so `fireAction` is never invoked for that row despite the row being loaded (line 78-81 has no `trigger_type` filter). | **Proven**, file:line |
| The write path (mobile client, `useOrchestrator.ts`) successfully creates the broken combination with no warning | `commitPending`'s location branch (lines 1444-1454) unconditionally attaches `resolveTaskActions()`'s output to `action_config.task_actions` whenever the user's original request contained task strings — no check exists anywhere in this path for whether the alert's `trigger_type` supports `task_actions` execution downstream. | **Proven**, file:line |
| Whether this has ever caused real user-visible harm in production | Not established — no support report, no live-fire confirmation (§2.6). Static evidence proves the currently identified execution paths cannot execute `task_actions` for location-triggered rules; it does not prove a real user has attempted the "location + third-party notify" combination and been silently let down. | **Not proven** — recommend checking `action_rules` for `trigger_type='location' AND action_config->'task_actions' IS NOT NULL` in production as part of Phase 2 scoping, to establish real-world exposure before deciding priority/urgency. |

---

## 4. What alternatives were considered

- **"Maybe `app/alerts.tsx` or some other client-side code sends the message itself when a push notification for the location alert arrives."** Ruled out — `alerts.tsx`'s only reference to `task_actions` is a read-only rendering block (§2.1); no `fetch`/send call exists near it, and no other client file references `task_actions` at all besides the write path in `useOrchestrator.ts` (§2.6).
- **"Maybe `evaluate-rules`' cron sweeps up location rows on a delay, as a backup path, even if `report-location-event` misses them."** Ruled out precisely, not just assumed — `evaluate-rules` does load every enabled row including location ones (no query-level filter), but `findTriggers()`'s switch statement has no `'location'` case and falls through to `default: return []`, so the row is loaded and then structurally never proceeds to `fireAction` (§2.5). This is a stronger, more precise finding than "the cron doesn't touch location" — it shows exactly where and how the row is discarded.
- **"Maybe this is the same underlying defect as F5c, just manifesting differently."** Ruled out — F5c's proven root cause (`docs/F5C_PHASE1_PROBLEM_DEFINITION_2026-07-17.md`) is an unconditional `data.contacts?.[0]` pick inside `evaluate-rules`' F5c block, a resolution-correctness bug. This defect is architecturally upstream of that — the location-triggered row never reaches F5c's block (or `evaluate-rules` at all) in the first place. Different bug, different file relationship (this one spans `report-location-event` + `evaluate-rules`'s trigger-type dispatch, not the F5c block itself), same broad family (Action Rules / Notification routing, Protected Core) but not the same code, and F5c's fix (already shipped, closed 2026-07-17) has no effect on this defect one way or the other.
- **"Maybe this is intentional — task_actions was only ever meant to work for time-triggered alerts, and location was never in scope."** Not fully ruled out as a *product* answer (Phase 2 / Wael's call, not a code question), but ruled out as the *current, actual* state of the product: `useOrchestrator.ts`'s write path (§2.1) makes no such distinction — it attaches `task_actions` to a location rule's `action_config` exactly the same way it would for any other rule shape, with no gate, no warning, and no different behavior communicated to the user. Whatever the original intent was, the shipped mobile code does not currently honor a location/time distinction at write time, so a user has no way to know the combination silently doesn't work.

---

## 5. Scope boundary

**In scope (proven, ready for Phase 2 once Wael authorizes starting it):** the execution gap for `task_actions` on `trigger_type: 'location'` rows — specifically, deciding how `report-location-event`/`fire-pending-dwells` should handle `task_actions` (execute them directly, mirroring `evaluate-rules`' F5c block with the same fail-closed resolution discipline; or route location rows through `evaluate-rules` somehow; or another approach — not designed here, Phase 2's job).

**Not in scope for this document, tracked separately or requiring a prior decision:**
- Real-world exposure/severity is not established (§3, last row) — recommend this be checked before Phase 2 commits to an implementation approach, since it affects urgency but not correctness of the fix itself.
- Whether `useOrchestrator.ts`'s write path should be changed to warn the user, or block the combination outright, when a location alert's task strings can't currently be delivered — a UX question, not addressed here.
- The broader "should `report-location-event` and `evaluate-rules` be unified into one fan-out implementation instead of two independently-maintained duplicates" question — raised by this defect (the duplication's own documented "keep both in sync" contract was not honored when F5c added `task_actions`), but a larger architectural decision than this specific gap, noted in §7 below as a deferred idea rather than assumed as this fix's scope.
- Any fix requiring the same fail-closed ambiguous-recipient discipline F5c just shipped (`evaluate-rules`' F5c block) would need to be re-implemented or shared, not just ported blind — Phase 2 should decide whether a location-alert `task_actions` executor reuses F5c's resolution logic (via a shared helper) or duplicates it (repeating the exact duplication problem this defect stems from).

---

## 6. Next step

Phase 2 — Change Planning, per governance — **not started, and will not be started without Wael's own separate, explicit go-ahead**, per the newly-formalized Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3). This document identifies and proves the execution-gap defect only; it does not select a fix. Candidate approaches, not yet designed or chosen, for Phase 2 to evaluate:

1. **Add `task_actions` execution directly inside `report-location-event`'s `fireLocationAction`**, mirroring F5c's fail-closed resolution logic (exactly one `lookup-contact` match required, fail closed on zero/multiple matches, per `evaluate-rules/index.ts`'s now-fixed F5c block). Phase 2 should decide whether this duplicates F5c's logic a second time (repeating the exact "two independently-maintained fan-out implementations" problem that let this gap happen) or whether the resolution logic should be extracted into a shared helper both functions call.
2. **Route location-rule firing through `evaluate-rules` somehow** instead of (or in addition to) `report-location-event`'s direct real-time path — a larger architectural change than option 1, likely conflicting with the real-time responsiveness a geofence crossing needs (evaluate-rules is cron-bound, not event-driven).
3. **Add the same executor to `fire-pending-dwells`** if option 1 or 2 is chosen for `report-location-event`, since dwell-based alerts complete via a callback into `report-location-event` (per its own docstring) — Phase 2 should confirm whether fixing `report-location-event` alone is sufficient (dwell completion calls back into the same function) or whether `fire-pending-dwells` needs its own independent handling.
4. **Whether to gate `useOrchestrator.ts`'s write path** so a location alert's task strings are either warned-about or blocked at creation time until the execution gap is closed, as a stopgap ahead of/instead of the full fix — a product/UX decision, not a code question, for Wael to weigh in on directly.

**5. Explicit architectural question Phase 2 must evaluate, not just the immediate bug (added per Phase 1 review feedback):** *Should `report-location-event` remain an independent implementation of fan-out, or should it be required to share a common execution module with `evaluate-rules`?* This question is deliberately left open here, not answered — its purpose is to make sure Phase 2 explicitly weighs the architectural trade-off (per §7's three-instance pattern) rather than reflexively patching only this one missing feature the same isolated way B10d's fix likely will be, perpetuating the drift instead of addressing it.

Phase 2 must also explicitly answer the Regression Impact questions for Geofencing and SMS/call alerts (both directly touched) per governance §Phase 2's checklist, and should include, ahead of choosing an approach, a check of production `action_rules` for any existing row matching `trigger_type='location' AND action_config->'task_actions' IS NOT NULL` to establish whether this gap has any real current exposure.

---

## 7. Deferred architectural recommendation (not approved for this fix)

**Per Phase 1 review feedback: this section, not the missing `task_actions` execution itself, is arguably the most important finding in this document.** The specific bug (§1-§6) is one symptom of a broader, now-recurring pattern: duplicated implementations of the same business logic drifting apart because nothing beyond a code comment enforces that they stay in sync.

`report-location-event`'s docstring already documents the risk this defect realized — "does not re-use `evaluate-rules`/`fireAction` because that function is cron-bound... Keep both in sync when changing the fan-out policy." That instruction was not followed when F5c added `task_actions` support to `evaluate-rules` (2026-06-15), and nothing in the codebase enforces the "keep both in sync" contract — no test, no shared module, no lint rule.

**This is now the third documented instance of the same architectural pattern, not an isolated defect:**
1. **F5c** (`docs/F5C_PHASE1_PROBLEM_DEFINITION_2026-07-17.md` §7) — recipient resolution duplicated across three independently-drifting call sites (mobile write-time, fire-time, voice), each with a different level of correctness.
2. **B10d** (holding list) — the WhatsApp per-channel opt-out (F2g) was added to `evaluate-rules`' fan-out but never ported to `report-location-event`'s duplicate fan-out — the exact same two functions this document is about.
3. **B10g** (this document) — `task_actions` execution was added to `evaluate-rules` but never ported to `report-location-event`/`fire-pending-dwells` — again, the same two functions, a different feature.

Three instances of "feature/fix added to one copy, not its duplicate" is a pattern, not a coincidence, and it reinforces the case already sitting in the holding list as **T1a — architecture integrity audit** (Tier 5, not yet scoped). This document's finding should be treated as supporting evidence for prioritizing or scoping T1a, specifically naming the `evaluate-rules` / `report-location-event` duplication as a concrete, repeatedly-bitten pair worth auditing first — not just a generic architecture-quality concern.

**Recommendation, not approved for the current fix:** consider whether the two fan-out implementations (`evaluate-rules`' cron-bound `fireAction` and `report-location-event`'s event-bound `fireLocationAction`) should share a single fan-out helper for the parts that don't actually depend on cron-vs-event timing (channel selection, self-alert detection, `task_actions` execution, body building — `buildAlertBody` is already shared, per `_shared/alert_body.ts`), rather than two independently-maintained copies of the same logic.

**Why not approved now:** broader blast radius than this specific gap requires — touches both fan-out functions' entire channel-selection and self-alert-detection logic, not just the missing `task_actions` call. Premature to design until Phase 2 has scoped the immediate fix for this specific gap.

**What would make it worth reconsidering:** already met, per the count above — three instances is the threshold this document itself previously set ("a third independent instance... worth flagging to Wael as a pattern"). Recorded here explicitly rather than left for a future session to notice independently.

---

## 8. Phase 1 review record (2026-07-17)

Reviewer feedback received via Wael. Two substantive additions adopted, one wording refinement adopted:

1. **Wording tightened in §3's root-cause table** — "the code cannot execute the feature" replaced with "the currently identified execution paths cannot execute `task_actions` for location-triggered rules," matching the evidence's actual scope (exhaustive static analysis of every path found, not an absolute claim about the code as a whole).
2. **§7 elevated and restructured** — reviewer feedback identified the duplicated-implementation drift pattern (not the missing `task_actions` call itself) as the most significant finding in this document. §7 now explicitly counts three documented instances of the same pattern (F5c's three-way recipient-resolution drift, B10d's channel-preference drift, this document's `task_actions` drift — all involving `evaluate-rules`/`report-location-event`), and ties this directly to the already-logged T1a architecture-integrity-audit item in the holding list as supporting evidence for scoping it.
3. **§6 gained an explicit Phase 2 question** (item 5): whether `report-location-event` should remain an independent fan-out implementation or share a common execution module with `evaluate-rules` — deliberately posed, not answered, so Phase 2 must weigh the architectural trade-off rather than defaulting to another isolated patch.

Reviewer's stated assessment: Problem definition, evidence quality, scope control, governance compliance, and separation of proven-vs-assumed all rated Excellent; root-cause analysis rated Strong. No substantive gaps identified before external technical review.

**This is the reviewer's assessment of the document's quality — it is not, by itself, authorization to begin Phase 2.** Per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3, added this session, at Wael's own explicit instruction): moving to Phase 2 requires Wael's own separate, explicit go-ahead, regardless of what this review verdict says. That has not yet been given.

---

## 9. Status

**Phase 1 drafted and reviewed 2026-07-17, revisions above adopted. Phase 2 has NOT started and will not start until Wael gives explicit, separate approval for this specific transition.**
