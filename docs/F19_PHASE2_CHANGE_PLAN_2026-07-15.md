# F19 — Phase 2: Change Planning

**Revision note (2026-07-15, after Phase 3 review of the first draft):** ChatGPT's review scored the original 9-10/10 across all categories and recommended approval for Phase 3, with one requested addition: Track A's three sequential production deploys had no per-step verification/rollback plan — a failure partway through (e.g., `resolve-recipient` succeeds, `report-location-event` fails) would leave production in an undocumented intermediate state. §3 below (new) adds deployment order, immediate verification, rollback trigger, rollback action, and success-criteria-before-proceeding for each of the three deploys. §8's wording (formerly §7) is also tightened per the reviewer's suggestion: "Track A involves no new coding" is replaced with "Track A introduces no newly authored logic; it promotes existing staging-validated logic to production" — more precise, since committing and deploying are still real production-changing actions even though no new logic is written. No other section changed; downstream section numbers shifted by one to make room for the new §3.

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. No code is written in this document — all evidence below is either read from the existing (uncommitted) working tree, downloaded directly from production via `npx supabase functions download`, or drawn from `docs/F19_PHASE1_PROBLEM_DEFINITION_2026-07-15.md` (fifth revision, closed). Builds on that document's dependency ordering (§4) and completion criteria (§9).

Touches Protected Core (Action Rules, Notification routing, Voice orchestration — `AI_DEVELOPMENT_GOVERNANCE.md` §4). Per §4 and Phase 1 §6, this is **High Risk** and requires Phase 3 (ChatGPT) technical review before any coding begins.

---

## 0. Correction to Phase 1, found while gathering Phase 2 evidence

Phase 1 §2g/§8-item-6 flagged `anthropic_tools.ts`'s production gap as **"partially, not fully characterized"** and listed a full line-by-line diff as required Phase 2 prep (§4 dependency-ordering item 4) before `naavi-chat` could be safely redeployed.

That diff has now been done directly, not inferred:

- `npx supabase functions download naavi-chat --project-ref hhgyppbxgmjrwdpdubcx` into an isolated scratch directory (not the working repo), then `diff` + `md5sum` against the local uncommitted copy of `supabase/functions/_shared/anthropic_tools.ts`.
- Result: **zero-byte difference.** Identical MD5 (`2555e0e231a0669ea877722fd328ebf2`), identical line count (867), identical `self_override` occurrence count (6) on both sides.
- Cross-checked against `npx supabase functions list --project-ref hhgyppbxgmjrwdpdubcx`: `naavi-chat` last deployed `2026-07-14T00:45:35Z` (version 279) — the same deploy Phase 1 §2b already established was deployed-but-uncommitted (the B9f/self-override work that predates commit `c33b494`). That deploy evidently bundled the current `anthropic_tools.ts` at the same time.

**Conclusion: `anthropic_tools.ts` requires no redeploy. Production's mobile tool schema is already fully in sync.** Phase 1's "partially behind" framing was itself imprecise — an artifact of only counting occurrences in the production copy without a byte-level diff against local. This is a correction, not a new defect: no user-visible behavior changes as a result, and no file in §2 below includes `anthropic_tools.ts`.

**What this does not change:** `report-location-event` and `get-naavi-prompt` were independently re-verified the same way (direct production download + diff against local) and **do** show substantial real differences — 56 changed lines against `report-location-event`'s last git commit alone (i.e., production is behind even the committed state, not just the uncommitted working-tree diff), and a materially different `get-naavi-prompt` (1655 production lines vs. 1659 local, `PROMPT_VERSION` string mismatch confirmed, self-override + location-tool-split guidance entirely absent from production). 1a (`resolve-recipient` missing) was independently re-confirmed a third way: it does not appear anywhere in the 71 functions currently listed on production. Phase 1's core findings (1a, 1g) stand unchanged; only the `anthropic_tools.ts` sub-claim is corrected.

This is the same "verify every carried-over claim against the live system, including this project's own prior documents" discipline Phase 1 itself demonstrated in its third revision — applied one layer further in, at Phase 2 kickoff.

---

## 1. Scope recap

Per Phase 1 §4, the six open sub-problems split into two categories that do not share an implementation path:

- **Track A — Infrastructure (deploy already-built, staging-verified code; no new code written):** 1a (`resolve-recipient`), 1g (`report-location-event` + `get-naavi-prompt`).
- **Track B — Application logic (code not yet written; root cause known, fix not yet designed):** 1c (voice recipient-name capture), 1d (self/third-party misclassification), 1e (voice SMS confirmation-loop + digit-capture).
- **Track C — Mobile build promotion (1f):** sequenced strictly after Track A ships and is verified on production, per Phase 1 §4 item 1 (promoting mobile first would expose production to the exact bugs 1a/1g are fixing).

This document plans Track A in full (files, classification, risk, regression impact — the governance-required shape). Track B is **scoped as an investigation spike, not designed** — Phase 1 §8 items 2/3 explicitly state these fixes are "not yet designed," and inventing a fix here without evidence would violate the No-Assumptions Rule. Track C is planned at the mechanics level only; its actual execution is gated on Track A's production verification, which hasn't happened yet.

---

## 2. Track A — Files that will change

| File | Classification | Change | Risk |
|---|---|---|---|
| `supabase/functions/report-location-event/index.ts` | Backend (Protected Core: fires every GPS-arrival alert) | (a) `git add`+commit the existing uncommitted diff — adds `self_override_email/sms/whatsapp/voice` extraction, `hasSelfOverride` classification checked before address-matching, per-channel target substitution. (b) Deploy to production (currently 56 lines behind even the last git commit; last deployed 2026-06-15, predates F15 by a month). | **High** — Protected Core, live-fire path, currently has zero self-override support in production |
| `supabase/functions/get-naavi-prompt/index.ts` | Backend/Configuration (shared prompt source — both mobile and voice fall back to their own local copies if this fails) | (a) Commit existing uncommitted diff — `PROMPT_VERSION` bump, self-override exclusion rule ahead of the draft_message rule, per-channel self-override guidance, `set_location_rule_chain`/`set_location_rule_address` example rewrite (the location-tool split), one new example teaching recipient-name capture on a location-triggered SMS/email ("text Bob when I arrive at 50 Elm St"). (b) Deploy to production (currently on `PROMPT_VERSION '2026-07-02-v132...'`, predates self-override entirely; last deployed 2026-07-03). | **High** — changes live prompt behavior for every mobile + voice user simultaneously, on first call after deploy, no gradual rollout possible |
| `supabase/functions/resolve-recipient/` (whole function, all files) | Backend, new deploy (not new code — exists and is validated on staging) | Deploy to production for the first time via `npx supabase functions deploy resolve-recipient --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx`. No code changes — deploying the exact staging-validated source. | **Medium** — new function, but additive (nothing on production currently calls it, so nothing can regress from its mere existence); risk is in what happens *after* mobile/voice start calling it, not the deploy itself |
| `supabase/functions/_shared/anthropic_tools.ts` | Shared Logic | **No change.** Per §0, already in sync on production via `naavi-chat`'s last deploy. | N/A — removed from scope this revision |

**Ordering within Track A:** commit the three uncommitted files together (single commit, since they were built and staging-validated as one unit per Phase 1 §2g) → deploy `resolve-recipient` first (nothing depends on its absence, and it's the lowest-risk of the three) → deploy `report-location-event` → deploy `get-naavi-prompt` last (highest blast radius, touches every live conversation immediately).

---

## 3. Track A — deployment verification and rollback (added per Phase 3 review)

Each deployment is gated: verify before proceeding to the next. A failed verification stops the sequence at that step — the next deployment does not happen until the failed one is either fixed and re-verified, or rolled back and the plan revisited. **Preparation step, before Deployment 1 begins:** re-download each function's current production source (`npx supabase functions download <slug> --project-ref hhgyppbxgmjrwdpdubcx`) into a durable location outside the ephemeral scratch directory used for Phase 2 evidence-gathering, and keep those three files until all three deployments are confirmed stable. These are the literal rollback artifacts for Deployments 2 and 3 — "redeploy the previous version" only works if that previous version is saved somewhere before it's overwritten.

### Deployment 1 — `resolve-recipient` (new function, first-time deploy)

- **Verification:** call the deployed production function directly with a known-good test input (mirroring the control-test method Phase 1 §2a already used for `resolve-place`) and confirm a real application-level response, not a 404. Confirm `npx supabase functions list --project-ref hhgyppbxgmjrwdpdubcx` now lists `resolve-recipient`. Compare the response shape against staging's known-working response for the identical input.
- **Rollback trigger:** deploy fails outright, OR the live test call errors/500s, OR the response shape doesn't match staging's for the same input.
- **Rollback action:** `npx supabase functions delete resolve-recipient --project-ref hhgyppbxgmjrwdpdubcx`. Safe and complete — nothing on production currently calls this function (confirmed additive-only in §2's risk note), so deleting it returns production to its exact pre-deployment state with no other side effects.
- **Success criteria before proceeding to Deployment 2:** live call returns correct resolved data for at least one known-good test case, matching staging's behavior for the identical input.

### Deployment 2 — `report-location-event`

- **Verification:** manually invoke the deployed function with a synthetic payload representing a self-alert carrying a `self_override_email` (mirroring the exact reproduction shape Phase 1 §2b used for `evaluate-rules`), and confirm the send routes to the override target on the email channel only. Separately, invoke with a synthetic payload for a plain self-alert (no override) and confirm the existing baseline behavior — fan-out to every enabled channel — still fires unchanged. Both cases must be checked; the second is a regression check on top of the first.
- **Rollback trigger:** either synthetic test fails — wrong channel targeted, wrong recipient reached, or the no-override baseline stops fanning to all enabled channels.
- **Rollback action:** redeploy the pre-change production source captured in the preparation step above, immediately.
- **Success criteria before proceeding to Deployment 3:** both the self-override test and the no-override baseline test pass.

### Deployment 3 — `get-naavi-prompt` (highest blast radius — last)

- **Verification:** fetch the deployed prompt directly and confirm `PROMPT_VERSION` matches the new value. Run `tests/catalogue/prompt-regression.ts` (or the specific self-override cases within it, if it already has F15 coverage — to confirm before relying on it) against this newly-deployed prompt. Additionally run at least one scripted live reproduction (e.g., "email me at test@x.com when I arrive at Costco") and confirm correct tool-call emission (`self_override_email` set, not a `draft_message` call).
- **Rollback trigger:** the prompt-regression suite fails against production's newly-served prompt, OR the scripted reproduction emits the wrong tool call, OR `get-naavi-prompt` itself starts erroring for any caller (both mobile and voice silently fall back to their own local hardcoded prompts on fetch failure — Wael should be told immediately if this happens, since the fallback masks the failure from users but not from monitoring).
- **Rollback action:** redeploy the pre-change production source captured in the preparation step above, immediately.
- **Success criteria (Track A complete):** prompt-regression suite green, scripted reproduction correct, no elevated error rate on `get-naavi-prompt` observed over a monitoring window Wael specifies before Track A is considered done and Track C's gate opens.

---

## 4. Track B — investigation scope (not designed, no files committed to yet)

Per Phase 1 §8, none of these have a fix design. Restating precisely what Phase 2 can respect right now rather than skip past:

- **1c (B9w) — voice never captures a third-party recipient name for "text NAME when I arrive at [literal address]."** Phase 1 §2c narrowed this to: both voice call sites capable of resolving a recipient are gated on `actionConfigNorm.to`/`locActionConfig.to` being non-empty, and the saved row has no `to` at all — meaning Claude's own tool-call JSON never populated it for this phrasing shape on voice's schema (`naavi-voice-server/src/anthropic_tools.js`), even though the identical phrasing on mobile's schema does capture it correctly. **Not yet investigated this revision:** whether voice's tool description needs the same example Phase 1 found added to mobile's `get-naavi-prompt`/`anthropic_tools.ts` (§2g, the "text Bob when I arrive at 50 Elm St" example) — voice has its own separate prompt/tool-schema files (confirmed different codebase, Phase 1 §2c). A side-by-side diff of voice's tool description against mobile's corrected one is the concrete next step, not yet done.
- **1d (B9x) — unresolved recipient silently misfires to self.** Root cause identified (`noRecipient = !toPhone && !toEmail` cannot distinguish "never specified" from "specified but unresolved"), but Phase 1 explicitly left open whether the existing `contact_id`-gated fire-time safety net in `evaluate-rules` is sufficient once 1a/1c land, or whether an explicit third state is needed. `report-location-event` has no safety net at all currently — Phase 1 flagged this as needing its own explicit accept-or-fix decision, not an assumption. This cannot be scoped further without first re-verifying, against current code, whether every write path (mobile orchestrator, voice, both `SET_ACTION_RULE` call sites) reliably captures `contact_id` on a successful resolution — that verification is itself the first step of this track, not something to design around blind.
- **1e (B9y) — voice SMS confirmation loop + digit-capture.** Two separately-unconfirmed issues per Phase 1 §5 (not established as the same bug). The confirmation-loop needs a live-traced reproduction with logging before a fix can be designed; the digit-transposition needs its own STT-path investigation. Neither has begun.

**Recommendation for this track:** treat 1c/1d/1e as their own Phase 1 (problem-definition-grade investigation, not implementation) before a Track B Phase 2 can be written. This is not scope creep — it is declining to skip Phase 1's own discipline for a sub-problem just because it's smaller than the one that triggered this document.

---

## 5. Track C — mobile build promotion (1f), mechanics only

Gated entirely on Track A shipping to production and being verified there (not just deployed — Phase 1 §9 completion criterion 2 requires F17's frozen Phase 7 matrix to actually re-pass under production conditions). Mechanics, once unblocked:

1. Bump `versionCode` in `app.json` past 307 (current staging) to the next unused Google Play value.
2. Full Two-Phase Build gate sequence applies since this is a production AAB: auto-tester green → voice regression green → Firebase Test Lab all-devices-passed → `eas build --profile production --auto-submit`.
3. Per Phase 1 §2f, this promotion is what makes mobile production dependent on `resolve-recipient` (1a) for the first time — shipping it before Track A is verified would import the exact silent-misfire bug class voice already exposed into mobile production. **Hard precondition, not a suggestion.**

No files identified yet beyond the routine version-bump files (`app.json`, `app/settings.tsx`) — this track has no design content of its own; it is a release-train step.

---

## 6. Regression impact (Track A — the only track with committed-to changes this revision)

Per governance §3, every plan must state impact on each of the eight standard areas explicitly — silence is not acceptable.

| Area | Impact | Why |
|---|---|---|
| Voice commands | **Affected — must verify.** `get-naavi-prompt` is voice's prompt source (with local fallback on failure). The self-override exclusion rule and location-tool-split examples change what Claude emits for phrasings voice already handles (e.g., "email me at X when..."). Voice's own `naavi-voice-server/src/index.js` call sites are untouched by Track A — only the prompt text changes, not voice's code. | `get-naavi-prompt` is the shared source per CLAUDE.md's "CLAUDE PROMPT — SHARED SOURCE OF TRUTH" section |
| Geofencing | **Not affected.** `report-location-event` fires *after* a geofence event already occurred; it doesn't touch `useGeofencing.ts`, `TaskManager`, or OS-level geofence registration. | Change is confined to `fireLocationAction`'s recipient/channel targeting, not trigger detection |
| Gmail integration | **Not affected.** No file in Track A touches `sync-gmail`, `extract-email-actions`, or any Gmail-scoped code path. | No overlap in files or shared functions |
| Calendar integration | **Not affected.** No file in Track A touches `sync-google-calendar` or calendar-scoped prompt sections beyond what's already unchanged. | No overlap in files or shared functions |
| Reminders | **Not affected directly.** `report-location-event` and `evaluate-rules` are distinct firing paths from `check-reminders`; this plan does not touch `check-reminders`. | Confirmed by file scope — `check-reminders` not in §2 |
| SMS / call alerts | **Affected — primary surface of this change.** This is precisely what 1a/1g touch: self-override channel targeting for location-fired alerts, and (once 1a is live) third-party recipient resolution for location-fired alerts that name a recipient. | Direct purpose of the deploy |
| Onboarding | **Not affected.** No file in Track A is reachable from onboarding flows. | No overlap |
| Staging build | **Not affected by this deploy** (staging already has all of Track A live and has for at least 5 days per Phase 1 §2g's deploy-timestamp table) — but staging is the reference behavior this deploy is bringing production up to. No staging regression expected since staging's code is unchanged. | Staging is the source of truth being promoted, not a target of new changes |

---

## 7. Risk classification — overall

**High**, per governance §4 (Protected Core) and §6 (silent-failure risk) — carried forward unchanged from Phase 1's own classification. Track A's individual file risk is noted in §2; the aggregate is High because `get-naavi-prompt` alone (prompt source for every live conversation on both platforms) is High, and it cannot be decomposed into a lower-risk sub-change — a partial prompt deploy (e.g., only the location-tool-split text, without the self-override text) was considered and rejected: the two are already merged in one uncommitted diff, staging-validated together, and splitting them now would mean deploying and testing a prompt variant that has never actually run anywhere, which is a worse risk position than deploying the exact thing already proven on staging.

---

## 8. Phase 3 requirement

Per `AI_DEVELOPMENT_GOVERNANCE.md` §4: Protected Core + High Risk automatically requires technical review (ChatGPT) before coding begins. **Track A introduces no newly authored logic; it promotes existing staging-validated logic to production** — but per a strict reading of §4 ("any modification touching the Protected Core automatically requires technical review"), a production deploy of Protected Core functions is in scope for review even without new code being written, since committing, deploying, and changing live production behavior are still real actions, and the review's stated purpose (assumptions, architecture, isolation, hidden coupling) applies equally to "should we promote this now" as to "should we write it this way." This plan is not self-approving — it is the input to that review, not a substitute for it.

Track B has no plan yet to review (§4) — it needs its own Phase 1 first. Track C has no design content to review (§5) — it is a mechanical release step gated on Track A's outcome.

---

## 9. Next step

Submit this document's Track A section to Phase 3 (external technical review) before any commit or deploy action is taken. Track B returns to Phase 1 as its own sub-investigation. Track C waits on Track A's Phase 7/8 outcome per Phase 1 §9's completion criteria.

No code has been written, committed, or deployed as part of producing this document.
