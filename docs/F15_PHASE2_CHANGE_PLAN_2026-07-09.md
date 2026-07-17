# F15 — Phase 2: Change Plan (REVISED)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. No code written in this document. Builds on `docs/F15_PHASE1_PROBLEM_DEFINITION_2026-07-09.md` (Defects A and B, §4's extraction-vs-resolution layer distinction, §7's mobile-only scope boundary).

This plan covers **mobile only**, per Phase 1 §7. Voice parity is explicitly out of scope here and listed as follow-up work (§7 below) — not silently deferred.

Revised after the first external technical review round (2026-07-09) — see §6 for what changed and why. Reviewer verdict on this draft: **approve to proceed, with refinements** (design/governance/regression/risk all rated Excellent; sequencing and long-term architecture flagged for adjustment, both applied below).

---

## 1. Defect A — self-alert with explicit destination override

### 1.1 Why the obvious shortcut is unsafe

The tempting fix is: let Claude put the literal address into the existing `to` field (already schema-legal as a string) and let it flow into the existing `to_email`/`to_phone` — since F12's `resolve-recipient` already detects `literal_email`/`literal_phone` patterns in `to` and would resolve it with no new code.

**This is rejected.** `evaluate-rules/index.ts:640-647` classifies a fire as self-alert vs. third-party by **matching the destination against the user's own registered phone/email** (`isSelfByPhone || isSelfByEmail || noRecipient`). Scenario 1a's test explicitly used *"an email you control, not your sign-in email"* — by design, the override address will usually **not** match the user's registered email. Reusing `to_email` for this would misclassify the alert as third-party, which changes real behavior: third-party alerts get a single channel (no fan-out) and skip the user's per-channel preferences (`user_settings.alert_channels_enabled`) entirely (CLAUDE.md, "ALERT FAN-OUT" section). The user would silently lose voice-call/push/SMS/WhatsApp fan-out on an alert that is still fundamentally about themselves. This reasoning stands unchanged after review — the reviewer agreed explicitly (§6).

### 1.2 Proposed design

A **new, distinct field pair** on `action_config`, separate from third-party `to`/`to_email`/`to_phone`, so self-classification never depends on address-matching heuristics for this case:

- `self_override_email: string` — set only when the user gives an explicit literal email for a self-alert.
- `self_override_phone: string` — same, for phone.

`evaluate-rules::fireAction()` checks these **before** the existing self/third-party classification: if either is present, the alert is unconditionally self (no address-matching needed), and delivery for the matching channel(s) uses the override address instead of `user_settings.phone`/`.email`. Everything else about self-alert behavior (per-channel preferences, wording, fan-out for the *other* enabled channels) is preserved.

### 1.2.1 Considered and deferred: a general `delivery_override` concept (added after review)

The reviewer raised a fair architectural question: is "self override" its own concept, or one instance of a broader pattern — *"call me at my office," "text me at my vacation phone," "email this to my work email"* — that would otherwise grow into `self_override_sms`/`self_override_voice`/`self_override_whatsapp` one field at a time?

**Decision: proceed with the narrow two-field design (`self_override_email`/`self_override_phone`), not a generalized `delivery_override` object.** Reasoning, not just YAGNI by default:
- Only two channels (email, phone/SMS) have a literal-address form a user would plausibly speak as an override in the first place — "call me at my office" and "text me at my vacation phone" both reduce to a phone number; "voice" and "SMS" would share `self_override_phone`, not need their own field. WhatsApp likewise rides on `self_override_phone` (same identifier). So the realistic ceiling for this pattern is **two fields, not five** — the growth scenario the reviewer flagged doesn't actually multiply per-channel the way it first appears.
- No second concrete request for this pattern exists yet anywhere in the codebase, prompt, or holding list — generalizing now would be designing against a hypothetical, which CLAUDE.md's "Complexity Tax" rule (item 23) asks to be justified explicitly, not assumed.
- If a real third case shows up later (something that isn't already collapsible into email/phone), revisiting the schema at that point costs one migration-free JSONB field addition — the same low cost paid today. Generalizing now buys nothing extra in exchange for a less obvious, harder-to-read schema today.

Recorded here so this is a considered decision, not an oversight, if revisited later.

### 1.2.2 Revision (2026-07-09, post-closure, direct Wael decision) — per-channel granularity, superseding §1.2.1's phone grouping

§1.2.1's "two fields, not five" reasoning rested on an assumption: that SMS/WhatsApp/Voice all sharing one phone number means a user overriding one intends to override all three together. Live use surfaced the concrete counter-case §1.2.1 said didn't exist yet: "if my channels are SMS, Call, WhatsApp, and I say 'SMS to XXX,' the SMS routes to XXX and the other two fire normally on my own number" — i.e. the phone-based channels are NOT one interchangeable group; a user can mean exactly one of them.

Two options were presented: (1) keep the grouped `self_override_phone` (all phone channels move together) — rejected as "very difficult to explain to Robert"; (2) full per-channel granularity, one override field per channel, no grouping — **chosen: "clear/consistent and easy to explain."**

**Decision: `self_override_phone` is retired. Four independent fields, one per channel, symmetric with `self_override_email`:**
- `self_override_email` — unchanged.
- `self_override_sms` — "text me at X" / "SMS me at X" / "message me at X" (matches this codebase's own existing "text"/"SMS"/"message" → sms channel-word convention).
- `self_override_whatsapp` — "WhatsApp me at X".
- `self_override_voice` — "call me at X".

Each field affects only its own channel; every other enabled channel continues to reach the user's own registered phone/email, unchanged — same channel-scoped principle as §1.3, now applied at full per-channel resolution instead of grouped by address-type.

This is a legitimate revision of a considered decision based on new, concrete evidence (per this project's own standard — YAGNI decisions are provisional, not permanent, when a real second case appears), not an unplanned scope drift.

### 1.3 Product decision — channel-scoped override (confirmed)

Two readings were possible: (1) **channel-scoped** — only the email channel routes to the override address, other enabled channels (SMS/Push/Voice) still fire normally to the user's own numbers; (2) **exclusive** — the alert fires only by email, to the override address, and nothing else.

**Decision: channel-scoped.** Rationale (from external review, adopted): the user said *"email me at X,"* specifying *where* the email should go — not *"only email me"* or *"email me instead,"* which would signal exclusivity. Channel-scoped preserves the principle of least surprise and matches the existing self-alert fan-out default (CLAUDE.md "ALERT FAN-OUT" section) more closely — it changes one destination, not the whole delivery policy.

This closes the open question from the prior draft. §1.4/§4 updated accordingly — no `action_type`/fan-out-suppression logic needs to be added; only the single matching channel's destination is substituted.

### 1.3.1 Empirical correction (2026-07-09, live testing, after the Defect B fix shipped) — two errors in the original plan, both confirmed live

Two live tests, run after Defect B's fix was already deployed, forced a correction to this section before any Defect A code is written.

**Correction 1 — extraction already works, by accident, but the fire-time gap is now proven, not just theorized.** "Email me at mynaavi2207@gmail.com when I arrive at X" (own sign-in email) → `action_config: {"to":"mynaavi2207@gmail.com","to_email":"mynaavi2207@gmail.com"}`, correctly resolved via Defect B's fix (Layer 2 extracts the literal email into `to_name` → `buildActionConfirm` forwards it → `resolve-recipient`'s literal-email detection sets `to_email`). This coincidentally passed the self-alert check only because the address happened to equal his own registered email. A second test — "Email me at aggan2207@gmail.com" (a genuinely different address) → `action_config: {"to":"aggan2207@gmail.com","to_email":"aggan2207@gmail.com"}`, and the Alerts UI immediately displayed it third-party-style (*"Alert aggan2207@gmail.com" / "Naavi emails aggan2207@gmail.com"*) instead of the generic self-alert copy every other self-alert shows. Computed directly against live data: `toEmail.toLowerCase() === userEmail.toLowerCase()` → `false`; `noRecipient` → `false` (since `to_email` is set) → `isSelfAlert` → **false**. **Confirmed, not inferred: this rule would fire as third-party — email only, no fan-out, no channel preferences honored — for a request that was semantically self-directed.** This is exactly §1.1's predicted failure mode, now proven with real data instead of only reasoned from code.

**Correction 2 — the original file list targeted the wrong fire-time file for location triggers, and never considered the extraction layer this request actually uses.** Two things this plan got wrong before any code was written:
1. **§1.4 (original) named only `evaluate-rules/index.ts`.** But F15's own investigation (Phase 1, Evidence B9-B11) established that location alerts fire through a **separate function, `report-location-event`**, not `evaluate-rules` — `evaluate-rules` is the cron path for time/email/weather/contact_silence triggers only. `report-location-event` has its **own, independent copy** of the same self/third-party classification logic (`isSelfByPhone`/`isSelfByEmail`/`noRecipient`, lines ~740-747) — structurally identical to `evaluate-rules`'s, but a second, separate implementation that must be fixed independently. It was never in the original file list. Implementing the plan as originally written would have fixed self-overrides for time/email/weather alerts while silently leaving location alerts — the primary scope of this entire F15 investigation — broken.
2. **The extraction-layer file list (`anthropic_tools.ts`, `get-naavi-prompt/index.ts`) targets the Claude+tools path.** Both live tests confirmed this exact request pattern is intercepted by **Layer 2** (`naavi-chat/index.ts`'s `classifyIntent()` → `buildActionConfirm()`) before Claude+tools is ever reached — the same interception this whole investigation found for Defect B. The originally-planned extraction-layer changes would have had zero effect on this pattern, the same blind spot Defect B's first two revisions had.

**Behavioral contract, made explicit per external review (2026-07-09):** Layer 2 and Claude+tools are two independent extraction implementations for the same user intent. **The two execution paths must emit identical `action_config` shapes for equivalent user intent** — a self-override phrased identically should never produce `self_override_email` via one path and something else (or nothing) via the other. This is not automatically true just because both paths are updated; it must be verified (§1.6).

### 1.4 Files that will change (revised per §1.3.1)

| File | Classification | Change |
|---|---|---|
| `supabase/functions/naavi-chat/index.ts` — **Layer 2 classifier prompt** (~line 1665) | Backend / Configuration (Protected Core-adjacent) | **New, not in original plan.** Teach the classifier to distinguish "notify ME, but at this address" (self + override) from "notify someone else at this address" (third-party) — currently both collapse into the same `to_name` extraction (confirmed live, §1.3.1). Add `self_override_email`/`self_override_sms`/`self_override_whatsapp`/`self_override_voice` params (per §1.2.2 — four independent fields, not a shared phone field) with worked examples matching the exact tested phrasing and each channel word. |
| `supabase/functions/naavi-chat/index.ts` — **`buildActionConfirm`'s location branch** (~line 1802-1846) | Backend (Protected Core-adjacent) | **New, not in original plan.** Read all four `params.self_override_*` fields (§1.2.2) into new `action_config` fields of the same name, via a generic per-field loop so each channel's override is independently guarded, mirroring the existing `to`/`to_name` forwarding added for Defect B (§2.5) but kept structurally separate so self-override and third-party can never be confused downstream. |
| `supabase/functions/report-location-event/index.ts` | Backend (**Protected Core**) | **New, not in original plan — the actual fire-time gate for location alerts.** Check all four `config.self_override_*` fields (§1.2.2) before the existing `isSelfByPhone`/`isSelfByEmail`/`noRecipient` logic (~lines 740-747). Per §1.3 (channel-scoped) and §1.2.2 (per-channel, not grouped): substitute only each field's own matching channel's destination; all other enabled channels — including the other phone-based channels — use `user_settings.phone`/`.email` unchanged. |
| `supabase/functions/evaluate-rules/index.ts` | Backend (**Protected Core**) | Original plan's target — still correct for its actual scope (time/email/weather/contact_silence triggers, not location). Same four-field fix shape as `report-location-event` (§1.2.2), in `fireAction()` (~640-745). |
| `supabase/functions/_shared/anthropic_tools.ts` | Backend / Configuration (Protected Core-adjacent) | Add all four `self_override_*` fields (§1.2.2) to `ACTION_CONFIG`, for the Claude+tools path (multi-action/chat-level messages that don't route through Layer 2). Still needed for completeness even though neither live test reached this path — other phrasings or compound requests may. |
| `supabase/functions/get-naavi-prompt/index.ts` | Backend / Configuration | Carve an explicit exception into RULE 1 (line 479) and the self-alert `action_config` documentation (line 1038) for the Claude+tools path, mirroring the Layer 2 prompt change above — one field per channel, matching the channel word used. |
| `hooks/useOrchestrator.ts` | Shared Logic | Ensure all four `self_override_*` fields pass through unmodified wherever `action_config` is built/forwarded for `SET_ACTION_RULE` (both the general path ~3972-3983 and the location memory-hit path ~3696-3712) — relevant if/when the Claude+tools path is exercised for this pattern. |
| `app/alerts.tsx` — `formatWhatHappens()` (~line 264-300) | Frontend (display only) | **New, added in §1.2.2.** Read all four `self_override_*` fields and describe each channel's override independently in the alert's human-readable summary, instead of the old shared "phone" wording. Code complete; **not yet deployed** — batched into a future dedicated APK per Wael's explicit instruction, not a standalone build (holding list B9e). |
| `tests/catalogue/*.ts` (new file) | Testing (Rule 15a) | Regression tests for all of the above: Layer 2 prompt/branch source-pattern assertions (matching the F15 Defect B test style, same disclosed limitation), `report-location-event` and `evaluate-rules` self-classification with a non-matching override address, confirmation that non-matching channels still fan out normally, and a byte-for-byte no-override-present regression test (matching the pattern the external review required for Defect B). |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, memory | Documentation | Update on completion. |

### 1.5 Risk classification

**Medium-High** (raised from Medium per §1.3.1's corrections). Additive fields, no existing field removed or reinterpreted, but the fix now touches **two independent Protected Core dispatch functions** (`report-location-event` and `evaluate-rules`) plus **two independent extraction surfaces** (Layer 2's classifier/`buildActionConfirm` and the Claude+tools schema/prompt) — twice the surface area of the original plan, discovered only through live testing rather than up front. Requires Phase 3 review before coding per Protected Core rule regardless of tier, and per §1.4's note, `evaluate-rules`'s half of this fix ships without the same live-test confirmation `report-location-event`'s half has — that gap should be closed with its own live test (a non-location self-override, e.g. a time-triggered alert) before Phase 8 merge, not assumed correct by analogy.

### 1.6 Parity validation — required Phase 5 evidence (added per external review, 2026-07-09)

`report-location-event` and `evaluate-rules` will contain two independently-written, conceptually-identical self/third-party classification checks after this fix — same behavioral contract, different files, different trigger types. That they *should* behave identically is a design intent, not a guarantee; two separately-coded implementations of the same rule can silently diverge (a missed `?.`, a different string-comparison method, an off-by-one in which check runs first). Per this project's own standard, "should be identical" is not evidence — it must be demonstrated.

**Required for Phase 5 (not optional, not deferrable to "seems fine"):** a parity table proving both dispatchers reach the same decision for the same class of input, run as an actual test matrix, not asserted:

| Trigger type | Dispatcher | Self-override input | Expected classification |
|---|---|---|---|
| location | `report-location-event` | override address ≠ registered email/phone | self (channel-scoped) |
| time | `evaluate-rules` | override address ≠ registered email/phone | self (channel-scoped) |
| email | `evaluate-rules` | override address ≠ registered email/phone | self (channel-scoped) |
| location | `report-location-event` | no override present (existing alert shape) | unchanged from pre-fix behavior |
| time / email | `evaluate-rules` | no override present (existing alert shape) | unchanged from pre-fix behavior |

### 1.7 Canonical behavioral contract (added per external review, 2026-07-09 — the reference table Phase 5 validates against)

| User request (example) | Stored fields | Classification | Delivery |
|---|---|---|---|
| "Email me at X when I arrive at Y" | `self_override_email: "X"` | Self | Email channel → X; other enabled channels (SMS/WhatsApp/Push/Voice) → user's own registered numbers, unchanged |
| "Text me at X when I arrive at Y" | `self_override_sms: "X"` | Self | SMS channel → X only; WhatsApp, voice, push, email → user's own registered numbers, unchanged |
| "WhatsApp me at X when I arrive at Y" | `self_override_whatsapp: "X"` | Self | WhatsApp channel → X only; SMS, voice, push, email → user's own registered numbers, unchanged |
| "Call me at X when I arrive at Y" | `self_override_voice: "X"` | Self | Voice-call channel → X only; SMS, WhatsApp, push, email → user's own registered numbers, unchanged |
| "Text/Email Bob when I arrive at Y" | `to: "Bob"` (resolved to `to_phone`/`to_email`/`contact_id` via `resolve-recipient`) | Third-party | Existing F12 behavior — single channel matching `action_type`, no fan-out, no per-user channel preferences applied |
| "Alert me when I arrive at Y" (no recipient at all) | *(no `to`/`self_override_*` fields)* | Self | Existing pre-F15 behavior — full fan-out to all enabled channels, unchanged |

**§1.2.2 addendum:** the four `self_override_*` fields are independent — a user can set exactly one (e.g. SMS only) and every other enabled channel, including the other phone-based channels (WhatsApp, voice), continues to reach the user's own registered number unchanged. No grouping by address type (the originally-considered, now-retired `self_override_phone` design) remains in the code.

This table is the single source of truth Phase 5's evidence package validates against — each row corresponds to one or more rows in §1.6's parity matrix. Not versioned separately per the reviewer's note that a standalone reference doc is a deferred follow-up (`B16`/holding list) — this table is the interim canonical version, living in the plan that governs the code it describes.

Each row needs its own live or direct-computation confirmation (matching the method used in §1.3.1 for the location case — a live test plus a direct read of the resulting row against the classification logic), not an assumption that "the location case worked, so the others will too." The two dispatchers living in different files with different surrounding logic is exactly why this can't be inferred by analogy.

**Also required, for the extraction side:** confirmation that Layer 2 and Claude+tools produce the same `action_config` shape for the same self-override phrasing (the behavioral-contract sentence added to §1.3.1) — at minimum, one test that deliberately forces the Claude+tools path (e.g. a compound/multi-action message containing a self-override) and one that takes the Layer 2 path (a plain single-action message, as already tested), confirming both land on `self_override_email`/`self_override_phone`, not just one of the two paths.

---

## 2. Defect B — third-party recipient dropped for location alerts

**Superseded (§2.1/§2.2 below, from earlier drafts, are historical record — kept, not deleted, per this project's investigation-integrity standard of showing corrected conclusions rather than erasing them).** Those sections targeted the tool-use system (`anthropic_tools.ts` tool descriptions) based on the then-leading hypothesis. That hypothesis was tested and ruled out (Phase 1 §2, Evidence B5), and a subsequent code trace plus runtime confirmation (Phase 1 §2, Evidence B9-B11) proved the actual cause is elsewhere entirely: `naavi-chat/index.ts`'s Layer 2 deterministic path (`classifyIntent()` → `buildActionConfirm()`), which bypasses the tool-use system completely for single-action requests. §2.5 onward is the current plan.

### 2.1 [SUPERSEDED] Hypothesis Validation — historical record only

Targeted `set_location_rule_address`'s tool description (the leading hypothesis at the time). Executed: a worked example was added and deployed; 5 live phrasings were run, including a literal-phone spot-check and a confound-free retest. **Result: 5 of 5 failed identically — hypothesis ruled out** (Phase 1 §2, Evidence B5). Full detail in Phase 1.

### 2.2 [SUPERSEDED] Confirmed Implementation — never executed

Contingent on §2.1 confirming the hypothesis. It did not. This step was never performed.

### 2.3 [SUPERSEDED] Files that will change — not applicable, superseded before any file changed

### 2.4 [SUPERSEDED] Risk classification — not applicable

### 2.5 Current plan — proven root cause, `naavi-chat/index.ts` `buildActionConfirm`

Per Phase 1 §2 (Evidence B9-B11), root cause is proven by direct runtime observation: Layer 2's classifier (`classifyIntent()`) successfully extracts the recipient into `classification.params.to_name` — confirmed live, not inferred. `buildActionConfirm`'s `SET_ACTION_RULE` / `tt === 'location'` branch (`naavi-chat/index.ts:1802-1817`) then discards it — `baseActionConfig` is built only from `params.action_config`/`params.tasks`, never `params.to`/`to_name`.

**Required, sufficient fix:** add recipient handling to that branch, mirroring the existing `haikuTasks` merge pattern three lines above it (line 1812-1815):
```js
const haikuToName = String((params as any).to_name ?? (params as any).to ?? '').trim();
if (haikuToName && !baseActionConfig.to) {
  baseActionConfig.to = haikuToName;
}
```
Placed before the `actions: [{ ..., action_config: baseActionConfig, ... }]` return. No other change to this function's location branch is needed — everything downstream (`useOrchestrator.ts`'s `SET_ACTION_RULE` intercept, F12's `resolve-recipient` call, contact lookup, DB write) is already proven correct (F12; Phase 1 §2, Evidence B3/B7) and activates automatically once `action_config.to` is actually populated.

**Recommended, lower-priority, not required:** also add a location-trigger-with-recipient worked example to Layer 2's classifier prompt (`naavi-chat/index.ts:1665`), mirroring the time-trigger example already there. Not needed to fix the proven failure (B11 showed Haiku already extracts the recipient without this), but removes reliance on the model generalizing past its own examples on every future call. Can ship in the same commit or as a fast-follow — does not gate the primary fix.

### 2.6 End-to-end validation requirement (added per external review, 2026-07-09 — belongs in Phase 2/5, not Phase 1)

Checking only that `action_config.to` is populated after the fix is insufficient — it would confirm the first broken link without confirming the rest of the previously-proven-correct chain still connects correctly through a real code change. Phase 5's Evidence Package for this fix **must** trace and confirm every link, live, on staging, not just the endpoints:

```
classification.params.to_name  (Layer 2 output — confirm via the B11 diagnostic, still deployed)
  ↓
buildActionConfirm's action_config.to  (the fix itself — confirm via a similar temporary log, or by inspecting the action object returned to the client)
  ↓
useOrchestrator.ts's toName pickup  (confirm resolve-recipient is actually invoked — e.g. temporary log at hooks/useOrchestrator.ts:3253, or observe the request in client_diagnostics if instrumented)
  ↓
resolve-recipient call and result  (confirm it resolves Bob correctly, not just that it's called)
  ↓
DB action_rules.action_config.to_phone / to_name / contact_id  (confirm via direct query, as done throughout this investigation)
  ↓
a real fire — manually trigger evaluate-rules or wait for a live arrival — confirming an actual message reaches Bob, not just that the row looks correct
```
Each link in this chain was independently proven correct *before* this fix (by F12, and by this investigation's own evidence) — but proving each link works in isolation is not the same as proving they still connect correctly after a real code change touches one of them. This mirrors F12's own Scenario 3 (fire-time re-resolution), which is still separately pending manual validation and should not be conflated with this check.

### 2.7 Files that will change

| File | Classification | Change |
|---|---|---|
| `supabase/functions/naavi-chat/index.ts` | Backend (**Protected Core-adjacent** — feeds the `SET_ACTION_RULE` write path) | `buildActionConfirm`'s location branch (line 1802-1817): add the recipient-forwarding snippet in §2.5. Optionally, `classifyIntent`'s prompt (line 1665): add one worked example (§2.5, recommended tier). Remove the three temporary diagnostics (Phase 1 §8) once §2.6's validation is complete. |
| `tests/catalogue/*.ts` (new file) | Testing (Rule 15a) | Regression test(s): (1) a source-pattern assertion that the location branch reads `to`/`to_name` into `baseActionConfig` (consistent with F12's existing test style); (2) **required, not optional (added per review):** a byte-for-byte equality test — call `buildActionConfirm('SET_ACTION_RULE', params, ...)` with `params` shaped exactly like "Alert me when I arrive at Costco" (no `to`/`to_name` present) and assert the resulting `action_config` object is identical, key-for-key, to the pre-fix output. Recipient-present tests alone only prove the addition works; this proves the guard makes it truly inert for the no-recipient case, which is the overwhelming majority of existing location alerts. |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, memory | Documentation | Update F15's status on completion. |

### 2.8 Risk classification

**Low-Medium.** The code change itself is small and additive (three new lines, guarded by `if (haikuToName && !baseActionConfig.to)` so it can only add a field, never remove or alter existing behavior for the ~majority of location alerts that have no recipient). Raised above pure "Low" because it sits in `naavi-chat/index.ts`, a file this investigation found to be larger, less-tested, and less well-understood than assumed (Phase 1 §2, Evidence B8) — the file classification itself (Protected Core-adjacent, feeds `action_rules`) requires Phase 3 review regardless of the change's small size, per governance §4.

---

## 3. Regression impact (per governance §3, explicit answer required for each)

| Area | Impact | Why |
|---|---|---|
| Voice commands | **Not affected by this plan.** | Phase 1 §7 scope boundary — mobile only. Voice needs its own evidence pass and its own change plan; not silently assumed fixed or unaffected. |
| Geofencing | **Not affected.** | No change to place resolution, geofence registration, or `resolve-place`. Both defects are about recipient handling after the place is already resolved. |
| Gmail integration | **Not affected.** | No change to `sync-gmail`, `extract-email-actions`, or the email-trigger path (`trigger_type='email'`). Defect A/B changes only touch `action_config` for `SET_ACTION_RULE`'s destination, and `trigger_type='location'`'s tool descriptions. |
| Calendar integration | **Not affected.** | No change to `create-calendar-event`, `trigger_type='calendar'`, or calendar-triggered alerts' own recipient handling (out of scope — only location-triggered third-party recipients are addressed by Defect B; calendar-triggered third-party recipients were not tested and are not touched here). |
| Reminders | **Not affected.** | `reminders` table and `check-reminders` are a separate code path from `action_rules`/`evaluate-rules`. |
| SMS / call alerts | **Affected, by design (both defects).** Defect A: `evaluate-rules::fireAction()`'s self/third-party classification gains a new pre-check (§1.2). Existing self-alerts and third-party alerts with no `self_override_*` fields present take the exact same path as today — the new check only activates when the new fields are populated, which cannot happen for any existing row. Regression tests (§1.4) must confirm this explicitly. Defect B: `buildActionConfirm`'s location branch (§2.5) gains a guarded addition — existing rules with no recipient in `params` are unaffected (the `if (haikuToName && ...)` guard is false for them), and the fix only changes behavior for the specific broken case (location + named/literal recipient). **The implementation intentionally does not alter any behavior when `params.to`/`params.to_name` are absent. Existing location-alert generation without recipients must remain byte-for-byte identical** — enforced by the required regression test in §2.7 (added per review), not just asserted here. |
| Onboarding | **Not affected.** | No touch to auth, first-run, or settings screens. |
| Staging build | **Affected — requires new staging APK/deploy for both defects' fixes**, per CLAUDE.md's staging-first rule. No production deploy until Wael explicitly approves after staging validation, same as F12. |

## 4. Sequencing (updated — both defects now have proven, unblocked designs)

1. ~~Wael answers the open question in §1.3~~ — **done** (§1.3, channel-scoped, confirmed).
2. ~~Defect B Hypothesis Validation~~ — **done, ruled out** (§2.1, historical). ~~Return to Phase 1 with new evidence~~ — **done**, root cause proven via code trace + runtime confirmation (Phase 1 §2, B9-B11).
3. **Full Phase 3 external review** of this plan as a whole — Defect A's design (§1) and Defect B's now-proven, narrow fix (§2.5-2.8) together. Not yet done.
4. Implementation (Phase 4) — both defects unblocked (Defect A: §1.3 resolved; Defect B: root cause proven, no open question remains). Gated on passing Phase 3.
5. **Phase 5 Evidence Package** — for Defect B specifically, must include §2.6's full end-to-end trace, not just an `action_config.to` spot-check.
6. Phase 6 review, Phase 7 manual staging validation (re-run F12's Scenario 1 script for Defect B; Defect A gets its own scenario per §1's design), Phase 8 merge to staging.
7. Voice-side F15 investigation — separate Phase 1, not started, not implied by this plan.
8. **Deferred, explicitly not part of this plan or any F15 phase:** a standalone architectural design document covering `naavi-chat`'s two parallel action-generation systems (Layer 2 deterministic classifier vs. Claude tool-use), recommended by external review to be written *after* F15 closes — not because it caused this bug, but so future recipient-related debugging starts from an accurate map of the two execution paths instead of re-discovering them the way this investigation had to. To be logged in the holding list as a follow-up item, not written now.

## 5. Next step

Phase 3 external review of this plan (§3 sequencing item 3) — both defects are now fully specified with proven root causes and no open product/technical questions remaining.

## 6. Revision history

- **2026-07-09, original draft:** established Defect A's design (reusing `to`/`to_email` rejected, new override fields proposed), left the channel-scoped-vs-exclusive question open for Wael, and Defect B's validate-before-fix structure (Step B-1/B-2).
- **2026-07-09, second revision** (after first external review round, verdict: approve with refinements): (1) added §1.2.1, explicitly considering and deferring a generalized `delivery_override` concept, with reasoning (only 2 realistic fields, not N-per-channel; no second concrete use case yet; cheap to revisit later) rather than a bare YAGNI assertion; (2) resolved §1.3 — channel-scoped override, adopting the reviewer's principle-of-least-surprise reasoning, and removed the now-unneeded `action_type`/fan-out-suppression design branch from §1.4; (3) renamed Step B-1/B-2 to Hypothesis Validation/Confirmed Implementation; (4) added the 3-phrasing requirement to Hypothesis Validation to guard against overfitting to one sentence; (5) reordered §4 so Defect B's experiment runs before the full Phase 3 review, since its result may change what Phase 3 is reviewing — avoids spending a full review cycle on a document that might not survive contact with the experiment.
- **2026-07-09, third revision** (after second external review round, verdict: approved — Defect A design approved for implementation, Defect B approach approved contingent on Hypothesis Validation): strengthened §2.1's success criteria from recipient-only to holistic — each of the three phrasings must now confirm recipient, place, `action_type`, AND a spot-check that F12's existing literal-address path still passes, so a description edit that happens to fix the recipient field cannot mask a silent regression elsewhere in the same row.
- **2026-07-09, fourth revision** (Defect B's Hypothesis Validation ran and failed 5/5; Phase 1 returned to, a code trace plus a runtime-observed diagnostic then proved the actual root cause is `naavi-chat/index.ts`'s `buildActionConfirm` location branch — see `F15_PHASE1_PROBLEM_DEFINITION_2026-07-09.md`'s third and fourth revisions): marked §2.1-2.4 superseded (kept as historical record, not deleted); added §2.5 with the actual, proven, narrow fix (three-line guarded addition to one function, mirroring an existing pattern in the same file); added §2.6, an explicit end-to-end validation requirement for Phase 5 (per external review) tracing the recipient through every previously-independently-proven-correct link, not just confirming the first broken field is fixed; rewrote §2.7/§2.8 (files, risk) around the actual small change; updated §3's SMS/call-alerts regression row to cover Defect B's fix too; rewrote §4 sequencing — both defects now unblocked with proven designs, next step is Phase 3 review of the whole plan; added §4 item 8, logging (not writing) a deferred architectural design-document recommendation for `naavi-chat`'s two-parallel-systems discovery, to be done after F15 closes.

- **2026-07-09, fifth revision** (after third external review round on this plan, verdict: approved for Phase 3): added a required (not optional) byte-for-byte `action_config` equality regression test to §2.7 — a no-recipient case ("Alert me when I arrive at Costco") must produce identical output before and after the fix, proving the guard is truly inert rather than merely asserting it; added the corresponding sentence to §3's SMS/call-alerts row.
- **2026-07-09, sixth revision (Defect A's design corrected by live testing, before any Defect A code was written):** after Defect B's fix shipped, two live tests targeting Defect A's exact scenario ("email me at [address]") were run to sanity-check the approved-but-unimplemented Defect A plan before coding it. Both tests exposed errors in that plan: (1) extraction for this pattern already works via Defect B's fix, but the fire-time misclassification (§1.1's predicted failure) is now proven with live data, not just reasoned — `isSelfAlert` computed `false` against a real DB row and a real registered email; (2) the plan's file list was wrong on both ends — the fire-time fix belongs in `report-location-event/index.ts` (never listed; the actual fire path for location alerts, confirmed by F15's own Phase 1 findings) not only `evaluate-rules/index.ts` (correct only for non-location triggers), and the extraction-layer fix needs to cover Layer 2 (`naavi-chat/index.ts`'s classifier + `buildActionConfirm`) since that's the path this exact request takes, not only the Claude+tools schema/prompt originally listed. Added §1.3.1 documenting both corrections with evidence; rewrote §1.4's file list to add `report-location-event/index.ts` and Layer 2's two files as first-class, required changes; raised §1.5's risk from Medium to Medium-High given the doubled surface area. **This revision produced no working code** — it corrects the plan before implementation begins, avoiding a repeat of Defect B's own early-revision mistake of fixing the wrong layer.
- **2026-07-09, seventh revision** (after fourth external review round on this plan, verdict: approve for a fresh Phase 3 pass): added the explicit behavioral-contract sentence to §1.3.1 — Layer 2 and Claude+tools must emit identical `action_config` for equivalent intent, not assumed just because both are being updated; added §1.6, a required (not optional) Phase 5 parity table proving `report-location-event` and `evaluate-rules` reach the same self/third-party decision for the same class of input across all three affected trigger types (location, time, email), plus a same-shape requirement for the two extraction paths — closes the risk that two independently-coded "identical" checks silently diverge.
- **2026-07-09, eighth revision — formal Phase 3 submission (§8) and response, verdict: APPROVED across all seven review areas, including proceed-to-implementation:** reviewer answered all three §8 questions (file list judged complete per current evidence, worded carefully as "no additional surface identified" rather than an absolute claim; parity testing judged sufficient for now, with a shared-helper refactor logged as deferred technical debt rather than blocking; no architectural objection to implementation). One recommendation, not a blocker: freeze the behavioral contract into one compact reference table before Phase 5 begins. Added §1.7 (the table) same revision, interim canonical version pending the separately-deferred standalone-doc follow-up already logged under F16.
- **2026-07-09, ninth revision (post-closure, direct Wael decision, §1.2.2):** F15 was closed with the two-field (`self_override_email`/`self_override_phone`) design shipped and live-validated. Live use immediately surfaced the counter-case §1.2.1 said didn't exist: Wael asked to confirm that an SMS-only override would leave WhatsApp and voice on his own number — it would not have, under the shipped grouped-phone design. Two options were presented (keep grouped phone vs. full per-channel split); Wael's explicit decision: full per-channel split ("#2 is clear/consistent and easy to explain"). Added §1.2.2 documenting the decision and retiring `self_override_phone` in favor of four independent fields (`self_override_email`/`self_override_sms`/`self_override_whatsapp`/`self_override_voice`). Implemented across all seven files in §1.4 (naavi-chat Layer 2 + buildActionConfirm, report-location-event, evaluate-rules, anthropic_tools.ts, get-naavi-prompt, app/alerts.tsx — the last one code-complete but not deployed, batched per standing instruction). §1.7's behavioral contract table expanded from 2 self-override rows to 4 (one per channel). Regression suite (`tests/catalogue/session-2026-07-09-f15-defect-a.ts`) updated to assert the new field/variable names and the absence of the retired `self_override_phone`; full `npm run test:auto` run clean (385 passed, 1 pre-existing unrelated error, 2 pre-existing OAuth skips — same baseline as before this revision). All four changed Edge Functions (`naavi-chat`, `report-location-event`, `evaluate-rules`, `get-naavi-prompt`) deployed to staging. Live per-channel validation with Wael is the next step, not yet done as of this revision.

## 7. Approval status

- **Defect A design (§1): APPROVED for Phase 4 implementation, then revised post-closure per §1.2.2 (direct Wael decision, not requiring a fresh external-review round — a narrow, symmetric field-split of an already-approved design, not a new architectural question).** Formal Phase 3 submission (§8) reviewed and approved across all areas — corrected architecture, revised file list, risk classification, behavioral contract (§1.7), parity validation strategy (§1.6), regression strategy, proceed-to-implementation. No outstanding architectural objections. §1.2.2's four-field revision implemented, tested, and deployed to staging; **live per-channel validation still pending** — see `docs/F15_PHASE5_EVIDENCE_DEFECT_A_2026-07-09.md` for current status.
- **Defect B (§2.5-2.8):** unaffected by this revision. Root cause proven, fix implemented, deployed, and fully validated end-to-end including live delivery (`docs/F15_PHASE5_EVIDENCE_DEFECT_B_2026-07-09.md`) — **CLOSED.**

## 8. Phase 3 submission — Defect A, corrected design

For the external reviewer. Self-contained: what changed, why, and what's being asked.

**What changed since the last approved version:** the previously-approved Defect A plan (through this document's fifth revision) was written before any live testing. Two live tests, run after Defect B's own fix had already shipped, exposed two errors in that plan before any Defect A code was written — full detail and evidence in §1.3.1. Summary:

1. **Fire-time misclassification is now proven with live data**, not just reasoned from code: a self-alert phrased as "email me at [address]" — where the address doesn't match the user's registered email — resolves correctly (`to_email` set to the given address) but then computes `isSelfAlert: false` in the fire-time dispatcher, meaning it would deliver as a third-party message (single channel, no fan-out, no per-user channel preferences) instead of a self-alert.
2. **The plan's file list was wrong.** Location alerts fire through `report-location-event`, not `evaluate-rules` (the original plan's only listed dispatcher) — a separate, independently-implemented Protected Core function with its own copy of the same self/third-party classification logic. And the extraction-layer fix needs to cover `naavi-chat/index.ts`'s Layer 2 deterministic classifier (`classifyIntent()` → `buildActionConfirm()`), not only the Claude+tools schema/prompt originally listed — both live tests confirmed this exact phrasing is intercepted by Layer 2 before Claude+tools is ever reached.

**What's being asked:** review the corrected design — §1.2 (field design, unchanged), §1.3 (channel-scoped decision, unchanged), §1.3.1 (the two corrections and their live evidence), §1.4 (revised file list — four files, two extraction surfaces, two dispatch surfaces), §1.5 (risk raised to Medium-High), §1.6 (required Phase 5 parity matrix across location/time/email, plus extraction-path parity). Specifically:
- Does the corrected file list (§1.4) fully cover the problem, or is there a third dispatch/extraction surface not yet found?
- Is the parity requirement (§1.6) sufficient, or does proving "same decision for same input" need a stronger form (e.g., a shared helper function instead of two independent implementations, to make divergence structurally impossible rather than just tested-for)?
- Any objection to proceeding to implementation once this design is confirmed sound?

**Not being re-asked:** §1.1 (why reusing `to`/`to_email` is unsafe), §1.2.1 (narrow two-field vs. generalized `delivery_override` — already decided), §1.3 (channel-scoped vs. exclusive — already decided). Those were settled in earlier review rounds and are unaffected by this revision.

### 8.1 Reviewer response (2026-07-09)

| Area | Decision |
|---|---|
| Corrected architecture | ✅ Approved |
| Revised file list (§1.4) | ✅ Approved — no additional dispatch/extraction surface identified by the current investigation (worded as current-evidence-bound, not an absolute claim) |
| Risk classification (§1.5) | ✅ Appropriate (Medium-High) |
| Behavioral contract (§1.7) | ✅ Approved |
| Parity validation strategy (§1.6) | ✅ Approved for now — testing proves today's behavior matches; a shared helper (structural prevention of future divergence, vs. tested-for prevention) is logged as deferred technical debt, not a blocker |
| Regression strategy | ✅ Approved |
| Proceed to implementation | ✅ Approved |

No architectural objections raised. One non-blocking recommendation (the behavioral contract table) — addressed same revision as §1.7.
