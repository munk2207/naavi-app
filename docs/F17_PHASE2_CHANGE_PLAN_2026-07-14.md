# F17 — Phase 2: Change Planning (REWRITTEN — deployment-dependency discovery)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. No code is written in this document (§0's finding is investigation, not implementation — no new code was added to the repo to produce it). Builds on `docs/F17_PHASE1_PROBLEM_DEFINITION_2026-07-14.md` (root cause: two compounding causes, §3; expected-behavior semantic table, §4; scope narrowed to voice's write path only, Evidence 6).

**This rewrite is triggered by a finding made after Phase 6 approval, while resolving the branch-verification item that Phase 6 explicitly deferred to Phase 8 (`F17_PHASE5_EVIDENCE_2026-07-14.md` §9, comment 3).** §0 documents it. It changes §2 (files), §3 (risk), and §7 (sequencing) materially enough that this is a rewrite, not an incremental revision.

---

## 0. Deployment-dependency discovery (2026-07-14, post-Phase-6) — read this before the rest of the plan

**This section, and the resulting §7 sequencing, supersede the deployment/Phase 7/8 sequencing in every prior revision of this document.** If any earlier revision (sixth or before) is being read from a saved copy, its "Phase 8 — merge to `naavi-voice-server` `main`; Railway auto-deploys" step is stale and must not be followed — it assumed F12's voice-side prerequisites were already live, which §0 disproves.

**What was confirmed.** The Railway dashboard (`naavi-voice-server-production`, Settings → Source) shows **Branch connected to production: `main`**, auto-deploy enabled — CLAUDE.md's documented claim was correct, not stale. This resolves the operational question Phase 5/6 left open.

**What that resolution then exposed.** `naavi-voice-server`'s local checkout — the one all of F17's Phase 4/5/6 work was implemented and evidenced against — was on branch `staging`, not `main`. Direct comparison:
```
git log --oneline main..staging   →  10 commits (staging ahead)
git log --oneline staging..main   →  0 commits (main has nothing staging lacks)
```
`staging` is `main` plus 10 additional commits that were never merged forward. `src/anthropic_tools.js` is byte-identical between the two branches (`git diff main staging -- src/anthropic_tools.js` → 0 lines) — F17's schema change is unaffected. **`src/index.js` is not** — `main`'s copy is 145 lines shorter and, confirmed by direct grep of `git show main:src/index.js`, **has no `resolve-recipient` integration at all**: no `toNameVoice`, no `toNameLoc`, and `pendingNoteUpdate`'s destructure on `main` is `{ ruleId, label, existingActionConfig, newBody }` — no `newTo`/`newToName`/`newToEmail`/`newToPhone`.

Of the 10 `staging`-only commits, three are the missing piece:

| Commit | Message | Relevance to F17 |
|---|---|---|
| `5ada02b` | fix: wire resolve-recipient into SET_ACTION_RULE (F12 tier 3) | **Hard prerequisite.** F17's call sites 1/2 guards are written as modifications to this exact code (`toNameVoice`/`toNameLoc`, the `resolve-recipient` calls) — that code does not exist on `main`. |
| `8167d78` | fix: memory-hit merge check now detects a changed recipient (F12 Defect B) | **Hard prerequisite.** F17's call site 4 guard modifies this commit's `if (newTo)` merge branch — absent on `main`. |
| `875ec35` | fix: commitLocationRule was dropping resolved address from trigger_config | Same write path family (`commitLocationRule`, correctly out-of-scope for F17 itself per Phase 1 Evidence audit, but part of the same F12 rollout) — not directly touched by F17's guards, but shipping F17 without it would leave `main`'s location-alert address handling in a separately-broken state. |

The other 7 `staging`-only commits (`f2e6afe`, `524e63b`, `0f2053b`, `2af27ef`, `9fe507f`, `8581fee`, `dcb9211`) are F11a demo-script and call-pacing work, unrelated to `action_rules`/recipient handling. **Not part of this plan.**

**Dependency graph (added per review, 2026-07-14):**
```
production `main`
      │
      ▼
F12 prerequisite commits (brought forward unmodified, §2)
  875ec35 — commitLocationRule address fix
  8167d78 — memory-hit merge recipient-change detection
  5ada02b — resolve-recipient wired into SET_ACTION_RULE
      │
      ▼
F17 (schema + 5 call-site guards, §1-§2)
      │
      ▼
Phase 7 — live validation (§6), now covering both layers
```
Each layer only makes sense with the one above it present — F17's guards patch code that F12 introduces, and F12's `resolve-recipient` integration is what F17 was designed to sit on top of. This is a strict bottom-to-top build order, not a set of independent changes landing together by coincidence.

**What this means for F17, stated precisely:** F17 was designed, implemented, tested, and reviewed as a patch on top of F12's voice-side work — reasonably, since F12's code is what's actually in the repository's working state and Phase 1's evidence (Evidence 4) correctly describes it. But F12's voice-side commits **have never been deployed to production** (`main`). F17 cannot be cherry-picked onto `main` in isolation — the code it patches isn't there. **F17 now has a hard dependency on shipping alongside its own prerequisite (F12's three voice commits), not after it or independently of it.**

**What this does NOT mean:** it does not invalidate Phase 1's root-cause finding (the code Phase 1 read is real and accurate to what will run once F12+F17 ship together) or Phase 3/6's approvals (the design and implementation are unaffected — they're still correct patches on top of F12's code). It also does not silently expand F17's scope to include the 3 F12 commits' own design/review — those were already committed, previously written, out of scope for a fresh Phase 1-6 cycle here; they are being brought forward as an unmodified prerequisite, not redesigned.

**Correction to this rewrite's own first-draft wording (per Wael, 2026-07-14) — precision on what "staging" means here.** The first draft of this section called `staging` a "de facto staging state." That overstates it. **Voice has no staging environment, full stop — confirmed by Wael directly, consistent with Phase 1 §6.** There is exactly one Twilio number and one Railway service, and that service is production; nothing has ever run anywhere else. `staging` is only a **git branch name** in the `naavi-voice-server` GitHub repo — an artifact of version control, not a deployment target. Nothing was ever deployed from it; it appears to have functioned as an informal working/dev branch. The substantive finding is unaffected by this correction: `main` (the one branch Railway deploys) is missing 10 commits that exist only on that branch, three of which (`5ada02b`/`8167d78` dated 2026-07-06, `875ec35` dated 2026-07-05) are F17's hard prerequisites. That is a version-control fact about unmerged commits, independent of what the branch is named or whether it was ever an "environment." Phase 1 is not rewritten for this — it doesn't change the root cause — but Phase 2's deployment plan (§7) must account for the unmerged-commits fact explicitly.

---

## 1. Design — mirror mobile's already-proven Claude+tools pattern exactly

Phase 1 §8 identified the shape: voice has no Layer-2-style deterministic classifier (unlike `naavi-chat`) — every voice request goes through Claude tool-use directly. This means the correct mobile reference is not `naavi-chat/index.ts`'s Layer 2 (irrelevant — voice has no equivalent system) but mobile's **Claude+tools extraction surface**: `supabase/functions/_shared/anthropic_tools.ts` (schema) + `hooks/useOrchestrator.ts` (write-time handling). Both are already implemented, shipped, and live-validated for mobile. This plan proposes no new design — only porting the proven pattern to voice's equivalent files.

### 1.1 Schema change

Mobile's `ACTION_CONFIG` (`supabase/functions/_shared/anthropic_tools.ts:125-144`) declares four fields:
```js
self_override_email: { type: 'string', description: '...' },
self_override_sms: { type: 'string', description: '...' },
self_override_whatsapp: { type: 'string', description: '...' },
self_override_voice: { type: 'string', description: '...' },
```
Voice's `ACTION_CONFIG` (`naavi-voice-server/src/anthropic_tools.js:88-105`) will gain the identical four properties, same names, same descriptions (verbatim, so both schemas stay textually in sync — a future prompt/schema audit can diff them directly). Purely additive: no existing property changes shape or is removed; `additionalProperties: false` stays in place.

### 1.2 Write-time change — creation-time call sites, same guard pattern

Mobile's write path (`hooks/useOrchestrator.ts:3277-3330`) does three things before ever calling `resolve-recipient`:
1. Computes `hasSelfOverride` — `Boolean(actionConfig.self_override_email || ...sms || ...whatsapp || ...voice)`.
2. **If `hasSelfOverride`, deletes any stray `to`/`to_name`** — a defensive guard added 2026-07-13 (B9n) after Claude/Haiku was confirmed live, twice, to populate both a `self_override_*` field AND `to_name` in the same response despite the prompt explicitly forbidding it. Without this, the contaminated `to`/`to_name` survives into the stored row and the alerts UI misclassifies a genuine self-alert as third-party.
3. Guards the existing third-party `resolve-recipient` call with `!hasSelfOverride &&` — a self-override row never enters third-party resolution at all.

Voice's two `SET_ACTION_RULE` **creation-time** call sites (Claude tool-use triggered) will gain the identical three-step guard:
- **Call site 1 — general (non-location) handler**, `naavi-voice-server/src/index.js:4731-4764` (the existing `toNameVoice` / `resolve-recipient` block).
- **Call site 2 — location-specific handler**, `index.js:11248-11305` (the existing `toNameLoc` / `resolve-recipient` block).

Both call sites already build their `action_config` object via an object spread from the raw `action.action_config` (`actionConfigNorm = { ...(action.action_config || {}) }` at line 4699; `locActionConfig = action.action_config ?? (action.action_config = {})` at line 11263). The existing spread already forwards arbitrary `action_config` keys, so no additional forwarding logic is expected to be necessary once the schema (§1.1) allows Claude to populate `self_override_*` — but this is a verification point for Phase 4/5, not an assumption to build on unchecked: implementation must confirm the spread still carries the four new fields through unmodified, and the regression tests in §2 must assert it directly rather than inferring it from the schema change alone. The guard (stopping the third-party path from also firing and contaminating the row) is the one piece of logic this plan is confident is required in advance.

### 1.2a Additional write-time guards — two more call sites found by a full write-surface audit (added 2026-07-14, after further investigation)

Before sending this plan to Phase 3, every write to `action_rules` in `naavi-voice-server/src/index.js` was enumerated directly (not assumed complete from §1.2 alone), by grepping every `fetch(...action_rules...)` call and every inline `action_config: {...}` literal. Two call sites checked and confirmed correctly out of scope (no `to`/recipient concept, or pure pass-through with no resolution logic of its own — `commitLocationRule` at `index.js:558-604`, and `SET_EMAIL_ALERT` at `index.js:4626-4667`, which always targets the user's own registered phone). **Two more call sites were found that do write recipient-shaped fields into `action_rules` and are not covered by §1.2's guard:**

- **Call site 3 — `pendingContactClarification` handler**, `index.js:10050-10148` (POST at `10091`). Fires when a *prior* turn's `to` was a relationship word ("wife"/"husband") and the user is now supplying the real name. It spreads `original.action_config` (the action that was blocked) plus a freshly-resolved `to`/`to_phone`, with no check for a pre-existing `self_override_*` field on that spread source. Lower-likelihood trigger than call sites 1/2 (a relationship word and a self-override are semantically distinct), but it is the same `action_rules` write surface Invariant #1 (§1.4) governs, and currently has no guard.
- **Call site 4 — `pendingNoteUpdate` handler**, `index.js:10254-10289` (PATCH at `10275`; the `recipientChanged` detection that populates it lives at `11457-11481`). This is the "update an existing alert via a later voice follow-up" flow (e.g., "actually, notify Bob instead" about an alert that already exists). It reads only `action.action_config?.to` to decide whether the recipient changed and has **zero `self_override_*` awareness**. Concrete failure: if an *existing* alert is a self-override alert (`self_override_email` set, no `to`) and a later turn produces a genuine third-party `to` for the same place, the merge (`10266-10274`) sets `to`/`to_phone` fresh but never deletes the stale `self_override_email` — directly violating Invariant #1 for an *updated*, not newly-created, row.

Both call sites need the same guard shape as §1.2, adapted to their direction of data flow:
- Call site 3: before the POST at `10091`, if the freshly-resolved `to`/`to_phone` is being set, strip any `self_override_*` that survived in the spread from `original.action_config`.
- Call site 4: in the `if (newTo)` branch (`10266-10274`), when a fresh `to`/`to_phone`/`to_email` is being merged in, also strip any `self_override_*` fields from `merged` — the symmetric case of §1.2's guard (there: strip stale `to` when self-override is fresh; here: strip stale self-override when `to` is fresh).

**Implementation note (per external review, 2026-07-14) — these two guards are symmetric, not identical; do not copy-paste one into the other.** The creation-path guard (§1.2, call sites 1/2) fires on the condition "a `self_override_*` field is present" and strips `to`/`to_name` — self-override wins. The update-path guard (call sites 3/4, above) fires on the condition "a fresh third-party `to` is arriving" and strips `self_override_*` — the incoming third-party recipient wins, because a request to notify someone else is by definition replacing whatever self-routing existed before. Implementation must key each guard off its own correct trigger condition, and the regression tests (§2, items 6-8) must each construct the specific precondition their call site actually sees (a spread carrying a stale `self_override_*` for site 3; an existing row with `self_override_email` set for site 4) rather than reusing a single shared fixture across all four call sites.

**Call site 5 — `pendingRearm`'s reactivate-merge, added 2026-07-14 as a Phase 5→Phase 2 amendment (found during Phase 4's own self-run completeness check, before Phase 6).** `index.js:~10364-10394` (detection/construction at `~11554-11560`). This is the "your alert is expired, want me to re-enable it?" flow (B6a/B6g) — structurally distinct from call sites 3/4: it merges the **existing (expired) row's** `action_config` with the **current turn's** `action_config` via a raw shallow spread, `{ ...(existingActionConfig ?? {}), ...newActionConfig }`, with **no field-aware logic at all** (unlike `pendingNoteUpdate`'s explicit `to`/`to_name`/`to_email`/`to_phone` handling). `newActionConfig` is `action.action_config` from the same turn — already guard-cleaned by call site 2, so it is internally consistent (either self-override-shaped or third-party-shaped, never both) — but the shallow spread does nothing to remove the **opposite** type of field surviving from the stale `existingActionConfig`. Both directions violate Invariant #1:
- Stale row was self-override + fresh turn is third-party → merge keeps both the stale `self_override_*` and the fresh `to`/`to_phone`.
- Stale row was third-party + fresh turn is self-override → merge keeps both the stale `to`/`to_phone` and the fresh `self_override_*`.

This is the one call site needing a **bidirectional** guard, unlike sites 1-4 (each of which only ever sees one direction of data flow):
```js
const hasSelfOverrideNew = Boolean(
  newActionConfig?.self_override_email || newActionConfig?.self_override_sms ||
  newActionConfig?.self_override_whatsapp || newActionConfig?.self_override_voice,
);
const hasThirdPartyNew = Boolean(newActionConfig?.to);
if (hasSelfOverrideNew) {
  delete merged.to; delete merged.to_name; delete merged.to_email;
  delete merged.to_phone; delete merged.contact_id;
} else if (hasThirdPartyNew) {
  delete merged.self_override_email; delete merged.self_override_sms;
  delete merged.self_override_whatsapp; delete merged.self_override_voice;
}
```
If `newActionConfig` carries neither (e.g. only `tasks`/`list_name` — a plain content addition with no recipient change), neither branch fires and the existing row's recipient fields — of whichever type — survive untouched, preserving Invariant #4 (inert when there's no relevant new content).

**Per reviewer instruction, 2026-07-14: risk classification is NOT raised further.** Still **Medium-High** (unchanged from §3) — this is the same guard pattern applied to one more write path, not new design complexity; the implementation surface grew, not the implementation difficulty.

**Separate, out-of-scope discovery — not part of this plan, flagged for its own holding-list item:** the identical gap (a recipient-change merge with no `self_override_*` awareness) also exists in the **shared** `manage-rules` Edge Function's `merge_tasks` op (`supabase/functions/manage-rules/index.ts:244-258`, confirmed zero `self_override` matches in that file) and in **mobile's own** two call sites of it (`hooks/useOrchestrator.ts:3572-3596` and `3745-3768`, the location memory-hit "you already have an alert, want to add/change it" flows). This affects mobile alerts being updated, not just voice, and predates F17 — it is not a voice-parity gap and is explicitly out of Phase 1's scope boundary (Phase 1 §7: voice only). Per this project's scope-control discipline, it is not being folded into F17. Recommend logging it as its own holding-list item for a future session.

### 1.3 Known risk, flagged but not pre-emptively fixed

`tests/catalogue/session-2026-07-13-b9l-phone-shaped-to-name.ts` documents a separate, already-fixed mobile bug (B9l): the classifier sometimes puts a literal phone number into `to_name` instead of the matching `self_override_*` field, even when told not to. B9l's fix is specific to `naavi-chat`'s Layer 2 Haiku classifier and its own fallthrough handler — a system voice does not have (§1, Phase 1 §8). Whether the same drift occurs on voice's own Claude tool-use call (same underlying model, same shared prompt, no Layer 2 involved) is **not yet observed and not assumed**. This plan does not design a pre-emptive fix for it — doing so without evidence would violate governance's evidence-before-assumptions principle. Instead: **Phase 7's live test plan (§6 below) explicitly includes a check for this exact failure shape** (a self-override phrasing landing with the address in `to`/`to_name` instead of the matching `self_override_*` field). If observed, it becomes a new, separately-evidenced defect — not folded into this plan retroactively.

### 1.4 Required invariants (added per review, 2026-07-14)

The design in §1.1-1.2 is stated as an algorithm above; restated here as the invariants Phase 5 and Phase 6 should check directly, rather than re-deriving from the algorithm each time:

1. After write-time processing completes, a stored `action_rules` row shall never contain both a third-party destination (`to`, `to_name`, `to_phone`, `to_email`, or `contact_id`) and any `self_override_*` field simultaneously. (Transient in-memory state before the guard runs — e.g. Claude's raw tool-call payload — is not covered by this invariant; only the persisted row is.) **Applies at every write path in §2's file list, including all three update/clarification/reactivate flows added in §1.2a — not only the two creation-time call sites.**
2. `resolve-recipient` shall never be invoked when any `self_override_*` field is present on the incoming `action_config`.
3. For a request with no `self_override_*` field and a `to` present (third-party), stored output is byte-for-byte identical to pre-fix behavior.
4. For a request with no `self_override_*` field and no `to` (plain self-alert), stored output is byte-for-byte identical to pre-fix behavior.
5. Neither fire-time dispatcher (`evaluate-rules`, `report-location-event`) is modified by this plan — both already satisfy their half of parity (Phase 1 Evidence 6) and remain untouched.

Invariants 1-2 are the actual bug fix; invariants 3-4 are the non-regression guarantee; invariant 5 is a scope boundary, not a behavior. Each maps directly to a regression test in §2's test file.

---

## 2. Files that will change

| File | Classification | Change | Risk |
|---|---|---|---|
| `naavi-voice-server/src/anthropic_tools.js` | Configuration (Backend, Protected Core-adjacent — feeds the `SET_ACTION_RULE` tool contract) | Add four `self_override_*` properties to `ACTION_CONFIG` (§1.1), verbatim match to mobile's `_shared/anthropic_tools.ts:129-144`. Additive only. | Low in isolation — new optional string fields, no existing field touched. |
| `naavi-voice-server/src/index.js` — general `SET_ACTION_RULE` handler (~line 4699-4764) | Backend (**Protected Core** — voice orchestration + Action Rules write path) | Add `hasSelfOverride` computation, stray-`to`/`to_name` stripping when true, and guard the existing `resolve-recipient` call with `!hasSelfOverride &&` (§1.2, mirroring `useOrchestrator.ts:3277-3330`). | Medium — Protected Core write path, no staging buffer to validate against before it's live (see §5). |
| `naavi-voice-server/src/index.js` — location-specific `SET_ACTION_RULE` handler (~line 11248-11305) | Backend (**Protected Core**) | Same three-step guard as above, applied to `locActionConfig`/`toNameLoc`. | Medium — same reasoning. |
| `naavi-voice-server/src/index.js` — `pendingContactClarification` handler (~line 10050-10148) | Backend (**Protected Core**) | §1.2a call site 3 — strip any stray `self_override_*` before the POST at `10091` when a freshly-resolved third-party `to`/`to_phone` is being written. | Medium — same file, same write surface, narrower trigger condition than call sites 1/2. |
| `naavi-voice-server/src/index.js` — `pendingNoteUpdate` handler (~line 10254-10289, 11457-11481) | Backend (**Protected Core**) | §1.2a call site 4 — strip any stray `self_override_*` in the `if (newTo)` merge branch (`10266-10274`) when a fresh third-party recipient is being written into an *existing* row. This is the one call site with a concretely demonstrated corruption scenario (§1.2a), not just a defensive closure. | Medium — same reasoning; this call site updates existing rows, so its regression tests (below) also need an existing-self-override-row fixture, not just a fresh-request fixture. |
| `naavi-voice-server/src/index.js` — `pendingRearm` handler (~line 10364-10394, detection ~11554-11560) | Backend (**Protected Core**) | §1.2a call site 5 (added 2026-07-14, Phase 5→Phase 2 amendment) — bidirectional guard on the shallow-spread reactivate-merge: strip stale third-party fields when the fresh turn is self-override, or strip stale `self_override_*` when the fresh turn is third-party. Neither branch fires when the fresh turn carries neither (plain content addition), preserving Invariant #4. | Medium-High — same write surface as call sites 3/4, but the only call site needing bidirectional logic (both stale-self/fresh-third-party AND stale-third-party/fresh-self are reachable here, unlike sites 3/4 which each only see one direction). |
| `naavi-voice-server/test/f17-self-override.test.js` (new file) | Testing (Rule 15a) | Regression tests, `node --test` style matching the existing convention in `naavi-voice-server/test/*.test.js`: (1) schema declares all four `self_override_*` fields; (2) `hasSelfOverride` guard present and gates the `resolve-recipient` call at call sites 1/2; (3) stray `to`/`to_name` stripped when `hasSelfOverride` is true, call sites 1/2; (4) **required, not optional** — byte-for-byte no-op regression: a rule with no `self_override_*` and no `to` produces an identical `action_config` before and after this change; (5) a third-party-only rule (`to` present, no `self_override_*`) still resolves via `resolve-recipient` unchanged; (6) call site 3 — a `pendingContactClarification` resolution strips a stray `self_override_*` field carried in `original.action_config` when writing the freshly-resolved `to`; (7) call site 4 — a `pendingNoteUpdate` merge onto an *existing* row that has `self_override_email` set, given a `newTo`, strips `self_override_email` from the merged result; (8) call site 4, byte-for-byte no-op — a `pendingNoteUpdate` merge with no `newTo` (body-only change) leaves an existing row's `self_override_*` fields untouched; (9) call site 5, direction A — stale third-party existing row + fresh self-override `newActionConfig` → merged has no `to`/`to_name`/`to_email`/`to_phone`/`contact_id`; (10) call site 5, direction B — stale self-override existing row + fresh third-party `newActionConfig` → merged has no `self_override_*`; (11) call site 5, byte-for-byte no-op — `newActionConfig` carries neither (only `tasks`) → existing row's recipient fields, of either type, survive untouched. Items 4/5/8/11 follow the same "prove the guard is truly inert for the majority case" standard F15 Phase 2 §2.7 required for its own guarded addition. | N/A (test file). |
| `supabase/functions/_shared/anthropic_tools.ts`, `hooks/useOrchestrator.ts`, `evaluate-rules/index.ts`, `report-location-event/index.ts`, `naavi-chat/index.ts`, `get-naavi-prompt/index.ts`, `supabase/functions/manage-rules/index.ts` | — | **No change.** All already correct (Phase 1 Evidence 1, 6) or out of scope (mobile's Layer 2, §1.3; the shared `manage-rules::merge_tasks` gap and mobile's own merge call sites, §1.2a — a separate, pre-existing defect, not a voice-parity issue, logged as its own follow-up rather than fixed here). Listed explicitly, per governance §2's "if a function is not affected, state that explicitly — silence is not acceptable." | — |
| `naavi-voice-server/src/index.js` — **prerequisite, added per §0** — F12's three voice commits (`5ada02b`, `8167d78`, `875ec35`) | Backend (**Protected Core**) | **Not designed here — already committed, unmodified, brought forward as-is.** Not part of F17's own design/review scope; included in the file list only because F17's own patches are unconditionally inert without this code present (§0). Cherry-picked onto `main` before or together with F17's own commit — see §7. | High — first-time production exposure of F12's voice-side recipient resolution, sight-unseen by any production traffic until now, landing in the same push as F17. |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, memory | Documentation | Update F17's status on completion. Also log the `main`/`staging` divergence (§0) as its own item — the 7 unrelated F11a/pacing commits still sitting on `staging`, not part of this plan. | — |

**No database migration.** `self_override_*` are JSONB keys inside the existing `action_config` column — already supported by the column type since F15 shipped; no schema-level DB change needed on either surface.

### 2.1 Invariant Verification Matrix (added per review, 2026-07-14)

Maps each §1.4 invariant to the specific evidence that will demonstrate it at Phase 5, so review is a checklist rather than a re-derivation:

| Invariant | Evidence |
|---|---|
| #1 — no row has both a third-party destination and a `self_override_*` field, at every write path (creation, update, and reactivate) | Regression tests 3, 6, 7, 9, 10 (stray field stripped, call sites 1/2, 3, 4, and both directions of 5 respectively) |
| #2 — `resolve-recipient` never invoked when `self_override_*` present | Regression test 2 (`hasSelfOverride` guard gates the `resolve-recipient` call at call sites 1/2); reinforced live by §6's negative case ("Email Bob...") confirming the inverse — `resolve-recipient` *does* still run for genuine third-party requests |
| #3 — third-party-only request unchanged | Regression test 5 (byte-for-byte, `to` present, no `self_override_*`) |
| #4 — plain self-alert unchanged | Regression tests 4, 8, and 11 (byte-for-byte, creation, update, and reactivate paths respectively) |
| #5 — fire-time dispatchers untouched | Source diff at Phase 5/6 confirms `evaluate-rules/index.ts` and `report-location-event/index.ts` appear in no diff hunk |

## 3. Overall risk classification

**High** (raised from Medium-High per §0's discovery — the fourth and largest jump this plan's risk classification has taken, and the first driven by a deployment fact rather than a code-surface fact). Reasoning:
- The prior Medium-High reasoning still holds and is not being replaced: five call sites, all additive/guard-shaped, all in one already-fully-enumerated file, no dispatcher change, no schema redesign — code-level difficulty has not increased.
- **What changed is what "deploy" now means.** Before §0, deploying F17 meant pushing five small, well-tested guards onto a codebase (F12's voice-side work) already presumed live and stable in production. After §0: F12's voice-side work has **never run in production**. Deploying F17 now means simultaneously exposing production, for the first time, to F12's third `resolve-recipient` integration (a real dependency chain touching contact resolution, third-party message delivery, and location-alert address handling) *and* F17's own new guards layered on top of it — with no staging environment to catch an interaction between the two before real calls hit it.
- This is precisely the scenario CLAUDE.md's "BUILD/DEPLOY DIAGNOSIS RULES" and staging-first principle exist to prevent: bundling unvalidated, previously-untested-in-production changes together multiplies the surface a single bad interaction could come from, and — because there is no staging split for voice — the first real test of that combination is a live phone call.
- Not classified as an immediate stop/blocker: F12's three commits are not new or hastily written — they are dated commits with their own (mobile-side-mirrored) design rationale, already exercised indirectly by whatever testing produced them, and `875ec35`/`8167d78`/`5ada02b`'s commit messages describe them as targeted fixes, not experimental work. The risk is real but bounded and nameable, not unknown-unknown — which is why this remains "High," not "blocked pending a full new Phase 1."

## 4. Regression impact (per governance §3, explicit answer required for each)

| Area | Impact | Why |
|---|---|---|
| Voice commands | **Affected, by design.** | Only the `SET_ACTION_RULE` case's two call sites gain new branching. No shared helper used by other action types is modified. Existing self-alerts (no destination) and existing third-party alerts (`to` present, no `self_override_*`) must take the byte-identical path as today — required regression tests (§2, items 4/5). |
| Geofencing | **Not affected.** | No change to `resolve-place`, geofence registration, dwell timing, or place-matching. `report-location-event`'s self/third-party classification already reads `self_override_*` unconditionally (Phase 1 Evidence 6) and needs no change here — this plan only affects what gets written into the row before it ever reaches that function. |
| Gmail integration | **Not affected.** | No touch to `sync-gmail`, `extract-email-actions`, or email-trigger config building. |
| Calendar integration | **Not affected.** | No touch to `create-calendar-event` or calendar-triggered rules. |
| Reminders | **Not affected.** | Separate `reminders` table / `check-reminders` path, untouched. |
| SMS / call alerts | **Affected, by design.** | This is precisely the self-alert delivery classification being fixed — same reasoning as the Voice commands row. Existing rules with no `self_override_*` must remain byte-for-byte identical (required regression test). |
| Onboarding | **Not affected.** | No touch to auth, first-run, or settings. |
| Staging build | **Not applicable — voice has no staging environment, confirmed by Wael directly.** One Twilio number, one Railway service, that service is production (Phase 1 §6). §0 separately found that `main` (the deploy branch) is missing commits that exist only on a git branch named `staging` — a branch-naming/version-control fact, not a second environment — including F12's voice-side prerequisites for F17. That gap means this deploy is the first production exposure for F12's voice-side code as well as F17's. §7's Phase 8 mechanics are the validation substitute. |

## 5. Parity Checklist (per Phase 1 §8/§9 recommendation)

| Layer | Status | Detail |
|---|---|---|
| Prompt parity | ✅ Already true, no change needed | Phase 1 Evidence 1 — voice fetches the identical shared `get-naavi-prompt`, already instructing `self_override_*` usage. |
| Tool schema parity | 🔲 Achieved by §2's `anthropic_tools.js` change | Will match mobile's `_shared/anthropic_tools.ts` field-for-field once implemented. |
| Write-path parity | 🔲 Achieved by §2's two `index.js` call sites | Mirrors `useOrchestrator.ts`'s `hasSelfOverride` guard + stray-field-stripping pattern (§1.2). |
| Database parity | ✅ Already true, no change needed | Both surfaces write the same `action_rules.action_config` JSONB column; no migration needed. |
| Fire-time parity | ✅ Already true, no change needed (confirmed Phase 1 Evidence 6) | `evaluate-rules` / `report-location-event` already read `self_override_*` unconditionally, surface-agnostic. |
| Regression tests, both surfaces | 🔲 New voice-side tests required (§2); mobile's existing F15/B9x suite is untouched by this plan and must still pass at Phase 5 as a no-regression check. | New file: `naavi-voice-server/test/f17-self-override.test.js`. |

Four of six layers are already true without any code change — this is the direct payoff of Phase 1 Evidence 6 narrowing the scope. Only two layers require the actual implementation in this plan.

## 6. Validation plan given no staging environment

Because Phase 4's implementation ships straight to the only live voice surface (§4's Staging build row), the usual "staging first, then promote" validation this project uses everywhere else does not apply. Substitute plan:

1. **Phase 5 Evidence Package** must include the new regression suite (`naavi-voice-server/test`, `node --test`) passing green, plus a source diff showing the guard mirrors `useOrchestrator.ts`'s pattern exactly (line-by-line comparison, not just "looks similar").
2. **Phase 7 manual validation — live phone call, run immediately after deploy, by Wael, against Phase 1 §4's expected-behavior table:**
   - "Email me at [address you don't normally use] in 3 minutes" → expect `self_override_email` stored, alert fires by email to that address, other channels unaffected.
   - "Text me at [a different number] in 3 minutes" → expect `self_override_sms`.
   - One location-triggered self-override phrasing (exercises call site 2 specifically).
   - One third-party control ("text Bob when I arrive at X") → must still work exactly as today (F12 behavior, unaffected by this plan).
   - One plain self-alert control with no destination ("alert me when I arrive at X") → must still fan out to all enabled channels, unaffected.
   - **Negative case (added per review, 2026-07-14):** "Email Bob at bob@example.com when I arrive at X" → must produce a third-party alert (`to`/`to_email` resolved via `resolve-recipient`), NOT `self_override_email`. Confirms the new guard classifies by presence of a self-referential phrasing, not merely by presence of a literal address — the fix must not over-classify a genuine third-party literal-address request as self.
   - **Explicitly check for §1.3's flagged risk**: does the address land in `self_override_*` (correct) or in `to`/`to_name` (the B9l-shaped drift, not yet observed on voice, not pre-fixed)? Record the result either way.
   - **Existing-alert update case (added per §1.2a, 2026-07-14, exercises call site 4):** create a self-override alert ("email me at [address] when I arrive at X"), confirm it stored `self_override_email`, then on a later turn say "actually, text Bob instead" for the same alert → must produce a row with `to`/`to_phone` resolved for Bob and `self_override_email` removed, not both present (Invariant #1). This is call site 4's one live-reachable scenario; call site 3 (`pendingContactClarification`) requires an artificial pre-existing contamination precondition that isn't practical to construct live — it stays regression-test-only coverage (test 6), a disclosed limitation consistent with this project's existing test catalogue (e.g. B9l's own test file).
3. **Rollback plan (revised per §0):** the change is additive/guarded (§3) — reverting the commit(s) on `main` (confirmed via the Railway dashboard, §0, as the actual deploy branch) and letting Railway auto-deploy the revert is the rollback path, same mechanism as any other voice-server change (CLAUDE.md "HOW THE VOICE SERVER DEPLOYS"). No DB rollback needed (no migration). **One nuance from §0:** because F12's three prerequisite commits are landing on `main` for the first time alongside F17, a rollback decision after a bad live test needs to distinguish which layer failed — F12's underlying `resolve-recipient` integration, or F17's guards on top of it — before deciding whether to revert both or just F17's commit. Phase 7's test matrix (§6 above) is structured so F12-only behavior (the third-party control test) and F17-only behavior (the self-override tests) can be told apart from the results.

## 7. Sequencing (revised per §0)

1. ~~Phase 3 — external technical review of this plan.~~ **Done.** Approved with comments (§9.1).
2. ~~Phase 4 — implementation, limited strictly to §2's file list (excluding the §0 prerequisite row, which is pre-existing code, not authored here).~~ **Done.** Five call sites, schema change.
3. ~~Phase 5 — Evidence Package.~~ **Done, twice** (original + the `pendingRearm` amendment revision).
4. ~~Phase 6 — post-implementation technical review, including the completeness proof.~~ **Done.** Approved.
5. **Phase 8 mechanics, revised per §0 — done before Phase 7, not after, because Phase 7 requires a live deploy and there is no staging to rehearse the deploy steps on:**
   a. Commit F17's changes (currently uncommitted, on the `staging` checkout) as a single, clean commit.
   b. Create a fresh branch off `origin/main` (not off `staging` — deliberately excludes the 7 unrelated F11a/pacing commits per §0's scope boundary).
   c. Cherry-pick, in commit-date order, the three F12 prerequisite commits (§0's table: `875ec35`, `8167d78`, `5ada02b`) onto that branch.
   d. Cherry-pick F17's own commit (step a) on top.
   e. Resolve any cherry-pick conflicts by re-reading the resulting file state against this plan's invariants (§1.4) and Phase 5's diff (`F17_PHASE5_EVIDENCE_2026-07-14.md` §3) — not by guessing; if a conflict changes what a guard is anchored to, re-verify the guard still fires on the correct condition before proceeding.
   f. Run the full test suite (`npm test`) on the resulting branch — must still show the same pass count as Phase 5's evidence (95/95 plus the F12-era pre-existing tests, none of which were touched).
   g. Push that branch to `main` (fast-forward or merge, per Wael's preference at the time) — **this step requires Wael's explicit go-ahead per session; it is a real production push, covered by CLAUDE.md's "Executing actions with care" and this session's own established pattern of confirming before any push.**
6. Phase 7 — live manual validation, immediately after the Phase 8 push (§6's test matrix above), **now implicitly validating F12's voice-side recipient resolution for the first time in production as well as F17's own guards** — not a redundant re-test of already-proven mobile behavior, since voice's copy of this logic has never been exercised by real production calls before this deploy.

## 8. Next step

**Phases 3, 4, 5, 6 complete.** Phase 8's mechanics (§7 item 5) are specified but **not yet executed — awaiting Wael's explicit go-ahead**, per the branch/commit plan above. Phase 7 follows immediately after.

## 9. Phase 3 submission — for the external reviewer

Self-contained: what's being proposed, why, and what's being asked. Per `AI_DEVELOPMENT_GOVERNANCE.md` Phase 3, this plan touches Protected Core (voice orchestration, Action Rules) and requires external review before any code is written, regardless of risk tier.

**What's being proposed:** voice (`naavi-voice-server`) currently has no way to represent a self-alert with an explicit per-channel destination override ("text me at [number] when I arrive at X") — any literal destination in the `to` field is unconditionally routed through `resolve-recipient` as a third-party recipient, misclassifying what is semantically a self-alert (Phase 1, Evidence 1-5, proven by direct code citation). Mobile already solved this identical problem for its own Claude+tools path (F15 Defect A) with four `self_override_*` schema fields plus a `hasSelfOverride` write-time guard. This plan proposes porting that already-shipped, already-live-validated pattern to voice's equivalent files — no new design, no dispatcher change (fire-time already reads `self_override_*` surface-agnostically, Phase 1 Evidence 6), no database migration, no mobile change.

**Update since the original submission draft:** a full write-surface audit was run against `naavi-voice-server/src/index.js` (every `action_rules` write, every inline `action_config` literal) specifically to answer Question 1 before sending this out, rather than asking the reviewer to do that legwork blind. It found two more call sites needing the same guard (§1.2a: `pendingContactClarification`, `pendingNoteUpdate` — the latter with a concretely demonstrated corruption path for *existing* alerts, not just new ones) and confirmed two others are correctly out of scope. It also surfaced a separate, pre-existing defect in the *shared* `manage-rules::merge_tasks` Edge Function and mobile's own two call sites of it — same missing-`self_override_*`-awareness shape, but affecting mobile, not voice, and predating F17. That finding is **not** part of this plan (Phase 1 §7 scopes F17 to voice only) and is flagged here only so the reviewer has full context, not as something being asked about.

**What's being asked:**
1. The call-site audit (§1.2a) found four write-time locations in `naavi-voice-server/src/index.js`, not the original two — is this audit method (enumerate every `action_rules` write and every inline `action_config` literal in the file) sufficient to be confident no fifth voice-side location remains, or does the reviewer see a class of call site this method would miss (e.g., something reached only through a code path not visible to a static grep)?
2. Is mirroring mobile's Claude+tools pattern architecturally sound for voice's execution model (a single Claude tool-use loop, no Layer-2-style classifier), given voice also has more deterministic side-handlers around `SET_ACTION_RULE` than mobile's Claude+tools path does (§1.2a's call sites 3/4 exist specifically because voice can't rely on Claude reliably re-emitting a full action on every follow-up turn) — is that architectural difference fully accounted for now, or does it suggest another gap this plan hasn't found?
3. Is §1.3's decision — flag the B9l-style drift risk (address landing in `to`/`to_name` instead of the matching `self_override_*` field) for live observation in Phase 7, rather than pre-emptively fixing it — sound engineering discipline, or does the lack of a staging environment change that calculus?
4. Is the softened §1.2 assumption (object spread already forwards arbitrary fields; Phase 4/5 must verify, not assume) adequately hedged, or should Phase 4 include a specific standalone verification step before relying on it in the guard logic?
5. Given no staging/production split (§4, §6), is the validation plan (regression suite green, then one live phone call covering the full behavior matrix, including the negative case and the new existing-alert-update case) sufficient risk mitigation for a Protected Core change shipping straight to the only live voice environment — or does the absence of a staging buffer, combined with the now-larger call-site count, warrant an additional gate?
6. Assuming Questions 1-5 reveal no blocking issue, do you see any objection to proceeding to Phase 4 implementation?

**Requested response format:** one of **Approved** / **Approved with comments** / **Changes required before Phase 4** / **Rejected (with rationale)**, plus an answer to each of Questions 1-6 above.

**Not being asked (already settled, not re-opened here):** Phase 1's root cause (proven by code citation, not disputed by any prior review round); the decision to scope this to voice's write path only, since fire-time dispatchers already work (Phase 1 Evidence 6); the decision to log the shared `manage-rules`/mobile finding as a separate follow-up rather than fold it into F17 (a direct application of this project's own scope-control discipline, not a new judgment call).

### 9.1 Reviewer response (2026-07-14)

**Decision: Approved with comments.**

| Area | Response |
|---|---|
| Q1 — audit method sufficiency | Endorsed. The write-surface audit (§1.2a) is assessed as a significant strengthening — it shifts the review from "find missing code" to "validate the audit methodology," a stronger position. No fifth call site identified by the reviewer. |
| Q2 — architectural soundness of mirroring mobile | Endorsed. Voice's extra deterministic side-handlers (call sites 3/4) are accepted as an accounted-for, understood architectural difference, not a hidden coupling. |
| Q3 — B9l-drift deferral | Not separately objected to; no change requested. |
| Q4 — forwarding-assumption hedging | Not separately objected to; no change requested. |
| Q5 — validation plan sufficiency given no staging | Implicitly endorsed via comment 3 below (an added Phase 6 completeness check), rather than an additional deploy-time gate. |
| Q6 — objection to Phase 4 | None. Approved to proceed. |

**Comments (to be incorporated, not blocking):**
1. The write-surface audit is comprehensive and a significant improvement over the original submission.
2. The Medium-High risk increase is correctly justified by expanded implementation surface (2 → 4 write paths), not algorithmic complexity — endorsed as stated in §3.
3. **New Phase 6 requirement:** the post-implementation reviewer must explicitly verify that every write into `action_rules.action_config` inside `naavi-voice-server/src/index.js` is either (a) protected by the self-override invariant, or (b) explicitly documented as out of scope — a completeness proof, not just a diff read. Added to §7's Phase 6 step below.

**Separately noted by the reviewer, not a blocking change:** the creation-path guard (§1.2) and the update-path guard (§1.2a) are not literally identical — they are symmetric in opposite directions (creation: self-override present → strip `to`; update: fresh third-party `to` arriving → strip self-override). The design already states this correctly; flagged as something Phase 4's implementation and regression tests must reflect precisely, not copy-paste identically. Addressed explicitly in §1.2a below.

## 10. Revision history

- **2026-07-14, original version:** design mirrors mobile's Claude+tools extraction surface (schema + `useOrchestrator.ts` guard pattern) to voice's equivalent files; file list, risk classification, regression impact table, Parity Checklist, and a validation plan substituting for the missing staging environment.
- **2026-07-14, first revision, after first review:** added §1.4, five required invariants restating the design as directly-checkable properties for Phase 5/6; softened §1.2's "no new field-forwarding code is needed" into an explicit Phase 4/5 verification point rather than an assumption; added a negative validation case to §6 ("Email Bob at bob@example.com...") confirming the fix does not over-classify a genuine third-party literal-address request as self.
- **2026-07-14, second revision, after second review:** tightened §1.4 Invariant #1's wording to explicitly scope it to persisted state ("after write-time processing completes"), not transient in-memory state before the guard runs; added §2.1, an Invariant Verification Matrix mapping each of the five invariants to its specific Phase 5 evidence (regression test number or source-diff check), turning Phase 5/6 review into a checklist.
- **2026-07-14, third revision, after third review:** added §9, the formal Phase 3 submission package — self-contained summary of what's proposed and six explicit questions for the external reviewer, plus a list of what's already settled and not being re-opened. §9.1 reserved for the reviewer's response. Renumbered Revision History from §9 to §10.
- **2026-07-14, fourth revision, after fourth review — final editorial pass before sending to Phase 3:** reworded Question 6 to make explicit that it's conditional on Questions 1-5 clearing without a blocking issue; added a "Requested response format" line (Approved / Approved with comments / Changes required before Phase 4 / Rejected, plus per-question answers) so the external reviewer returns a decision rather than free-form commentary. No design, scope, or risk content changed. Document considered final and ready for Phase 3 as of this revision.
- **2026-07-14, fifth revision, after a direct code audit answering Phase 3's own Question 1 before sending it out:** ran a full write-surface audit of `naavi-voice-server/src/index.js` (every `action_rules` write, every inline `action_config` literal) rather than leaving call-site completeness as an open question for the external reviewer to guess at without repo access. Found two additional call sites needing the same guard — added §1.2a (`pendingContactClarification`, call site 3; `pendingNoteUpdate`, call site 4, which has a concretely demonstrated corruption path for *existing* rows). Confirmed two other candidate sites (`commitLocationRule`, `SET_EMAIL_ALERT`) are correctly out of scope. Broadened §1.4 Invariant #1 to state it applies at every write path, not only creation. Added both new call sites to §2's file list and three new regression tests (6/7/8) to the test-file row; updated §2.1's matrix accordingly. Raised §3's risk classification from Medium to Medium-High, citing the same reasoning F15 Phase 2 used when its own investigation widened scope. Added an existing-alert-update live test case to §6. Rewrote §9's Question 1 (now reports the audit result and asks about the audit *method's* sufficiency, rather than asking the reviewer to do the search) and added an "Update since the original submission draft" paragraph. **Also surfaced, and explicitly excluded from this plan:** the identical missing-`self_override_*`-awareness gap exists in the shared `manage-rules::merge_tasks` Edge Function and in mobile's own two call sites of it (`useOrchestrator.ts:3572-3596`, `3745-3768`) — a separate, pre-existing, mobile-affecting defect, out of Phase 1's voice-only scope boundary (§7), not folded into F17, flagged for its own future holding-list item.
- **2026-07-14, sixth revision — Phase 3 external review response received:** decision **Approved with comments** (§9.1). Recorded the reviewer's per-question response table and three comments. Incorporated comment 3 (a Phase 6 completeness-proof requirement) into §7's Phase 6 step. Incorporated the reviewer's non-blocking observation (the creation-path and update-path guards are symmetric, not identical) as an explicit implementation note in §1.2a, so Phase 4 doesn't copy-paste one guard's trigger condition into the other. No design, scope, or risk content changed beyond these additions — Phase 3 is now closed; next step is Phase 4 implementation.
- **2026-07-14, seventh revision — Phase 5→Phase 2 amendment, per Phase 6 reviewer instruction "Changes required before Phase 6 approval":** Phase 4's own self-run completeness check (documented in the first Phase 5 Evidence Package) found a sixth `action_rules` write location, `pendingRearm`'s reactivate-merge, unprotected — reported as a separate item per the "No Extra Changes Rule" rather than fixed silently. The Phase 6 reviewer's response: implementation and Phase 4 discipline endorsed, but Phase 6 cannot open with a known invariant violation still on the books — treat this as a Phase 2 amendment, implement, then regenerate Phase 5. Added call site 5 to §1.2a with its bidirectional guard design (the one call site where both directions of the asymmetry are reachable, unlike sites 3/4 which each only see one). Added it to §2's file list and three new regression tests (9/10/11) to the test-file row; updated §2.1's matrix. **Risk classification explicitly NOT raised further** — reviewer's instruction: same guard pattern applied to one more path is expanded surface, not new complexity, so Medium-High stands unchanged from the sixth revision.
- **2026-07-14, eighth revision — full rewrite triggered by a post-Phase-6 deployment-dependency discovery (§0):** while resolving the branch-verification item Phase 6 explicitly deferred to Phase 8, confirmed via the Railway dashboard that `main` is the actual deploy branch (CLAUDE.md was correct) — but then confirmed via direct `git log`/`git show` comparison that `main` is missing 10 commits present on the `staging` branch this entire F17 investigation and implementation was carried out against, three of which (`5ada02b`, `8167d78`, `875ec35` — F12's voice-side `resolve-recipient` wiring, memory-hit merge fix, and `commitLocationRule` address fix) are hard prerequisites for F17's own patches, which are written as direct modifications to that code. F17 cannot be deployed to `main` in isolation. Added §0 documenting the discovery in full, with the evidence and a table of the three prerequisite commits versus the 7 unrelated F11a/pacing commits explicitly excluded from this plan. Added a new file-list row (§2) for the prerequisite, unmodified, brought forward as-is — not redesigned. **Raised risk classification from Medium-High to High** (§3) — not because F17's own code got harder, but because deploying it now means simultaneously exposing production, for the first time, to F12's voice-side work as well, with no staging environment to catch an interaction between the two before a live call does. Rewrote §7's sequencing to specify the actual Phase 8 mechanics (commit F17, branch off `main`, cherry-pick the three F12 commits in order, cherry-pick F17 on top, resolve conflicts against this plan's invariants, re-run the full suite, then push — gated on Wael's explicit go-ahead). Updated §4's Staging-build row and §6's rollback plan to reflect the corrected branch reality and the two-layer (F12 vs. F17) rollback distinction this now requires. Phase 1's root-cause finding is explicitly not invalidated — the code it describes is real and accurate to what will run once this deploys; only the "currently running in production" framing needed correcting, done via a note in §0 rather than a Phase 1 rewrite.
- **2026-07-14, ninth revision — wording correction, per Wael:** confirmed directly by Wael: voice has no staging environment at all, only production — the eighth revision's "de facto staging state" phrasing in §0 (and matching language in §4's Staging-build row) overstated it, implying an environment where none exists. Corrected both to state plainly that `staging` is only a git branch name in the `naavi-voice-server` repo — an artifact of version control, never a deployment target — while preserving the substantive, unaffected finding: `main` (the sole deploy branch) is missing 10 commits that exist only on that branch, three of which remain F17's hard prerequisites. No change to §2's file list, §3's risk (still High), or §7's sequencing — this revision is wording-only, correcting an inference that outran the evidence, not new evidence itself.
- **2026-07-14, tenth revision, after review:** added a dependency graph to §0 (`main` → F12's three prerequisite commits → F17 → Phase 7 validation) making the strict bottom-to-top build order visually explicit for future reviewers. Added an explicit supersession statement at the top of §0 — this section and §7's sequencing supersede the Phase 7/8 sequencing in every prior revision (sixth and earlier), so a stale saved copy can't be followed by mistake. Both additions are presentational; no change to §2's file list, §3's risk (still High), or the substance of §7's sequencing.
- **2026-07-14, eleventh revision (this revision) — Phase 8 executed.** §7's mechanics run exactly as specified, with Wael's explicit go-ahead at each gated step: F17 committed on `staging` (`474bd98`); fresh branch `f17-voice-self-override-deploy` created off `origin/main`; the three F12 prerequisite commits cherry-picked in order (`73b5847`, `50df358`, `4c8a6ce` — new hashes on this branch, same content as `875ec35`/`8167d78`/`5ada02b`) — **zero conflicts on any of the four cherry-picks**; syntax verified; full suite run — **82/82 pass** (68 pre-existing tests on `main` + all 14 F17 tests; the count differs from Phase 5's staging-branch 95/95 because the 7 intentionally-excluded F11a/pacing commits' own test contributions are, correctly, not present on this branch). Pushed to `origin/main` (fast-forward, `eb10698..aeca218`) — Railway auto-deploys from `main`, so this is live now. Local `main` synced; temporary deploy branch deleted (its commits are now `main`'s own history). **Phase 8 is complete. Next: Phase 7 — live phone call validation (§6), now runnable for the first time since a deploy exists to call.**
