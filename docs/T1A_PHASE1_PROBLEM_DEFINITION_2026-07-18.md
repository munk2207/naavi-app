# T1a — Phase 1: Problem Definition (Architecture Integrity Audit)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1, triggered by §5's Architecture Audit Trigger (met 2026-07-18). No code is written in this document. Touches Protected Core (Action Rules, Notification routing — the audit's subject matter spans multiple Protected Core areas by nature, since it audits duplication itself).

**Origin:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5 §5's duplication threshold — a fourth confirmed instance of "feature added to one of two independently-maintained implementations, never mirrored to the other" — was met when B10k was found 2026-07-17. Per the holding list's own recommendation (`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, priority-queue note, 2026-07-18): "recommend scoping T1a's Phase 1 first next session, with B10k as its first concrete finding, rather than fixing B10k in isolation." This document follows that recommendation.

---

## 1. What exactly is broken

Not a single bug — a **process gap**. MyNaavi's Architecture Reference (`docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` §5a) documents five capabilities where mobile and voice (or two functions within Shared Core) maintain independent implementations of the same logic, with nothing beyond a code comment enforcing that a change to one reaches the other. This is not a hypothetical risk — it has already produced **four confirmed real incidents**, each following an identical shape: a fix or feature ships to one implementation, the other silently does not receive it, and the gap is discovered by accident (a direct question, or incidental code-reading during an unrelated task) — never by a process step designed to catch it.

**The critical sub-finding this document adds, not previously stated together in one place:** of the four confirmed instances, **three share the exact same duplicated pair** (`evaluate-rules` vs. `report-location-event`), and **one is a structurally different pair** (mobile's `naavi-chat` classifier vs. voice's own classifier/reasoning loop, plus a separate staging/production split in `get-naavi-prompt`). This matters for scoping: fixing the `evaluate-rules`/`report-location-event` duplication once — a bounded, already-partially-scoped problem (B10g's Phase 2, Approved, already built a shared `_shared/task_actions.ts` module as a first step) — would retroactively close the *mechanism* behind 3 of 4 known instances. B10k's classifier duplication is architecturally unrelated and needs its own resolution (ADR 0001 already names three candidate approaches, none chosen).

---

## 2. Evidence

### 2.1 — Instance 1: Recipient resolution (F5c), three independently-drifting call sites

Per `docs/F5C_PHASE1_PROBLEM_DEFINITION_2026-07-17.md` (Phase 1, Approved) and `docs/ARCHITECTURE_NAAVI_CHAT_ACTION_SYSTEMS.md:52-61`: for time-triggered, third-party alerts, recipient-name resolution has **three separate `lookup-contact` call sites, none sharing code**: (1) Layer 2's own fallthrough branch, (2) Step 1.4's `lookupWithPhone` helper, (3) a third intercept point resolving Claude's tool_use output. F5c's fix (Approved, staging-deployed) hardened exactly one of these — `evaluate-rules/index.ts`'s fire-time resolver (~lines 1077-1096) — to require a single unambiguous match. The other two call sites were explicitly out of scope for that fix (F5c Phase 1 §5/§7). Separately, mobile's write-time resolver (`naavi-chat/index.ts:4104-4169`) only resolves the *first* `task_actions` entry per rule (`.find()`, not a loop) — a second, smaller drift within this same instance, flagged but not fixed. Voice has **zero** `task_actions` write-time resolution at all (confirmed by grep, per the F5c memory record).

### 2.2 — Instance 2: Channel-preference honoring (B10d), freshly re-verified this session

Not previously backed by file:line citation in the holding list (B10g's Phase 1 cited it only as "per B10k's finding," itself a summary, not a fresh grep). Re-verified directly for this document:

`supabase/functions/evaluate-rules/index.ts:765,780-781,1011` — reads `user_settings.alert_channels_enabled` (the F2g per-user channel opt-out) and gates each channel send on it.

`supabase/functions/report-location-event/index.ts` — grepped for `alert_channels|whatsapp|channel` (case-insensitive): every match is either self-override logic (F15's `self_override_whatsapp`/etc., a *different* feature) or literal channel-name strings passed to `callSMS`/`callWhatsApp`. **Zero references to `alert_channels_enabled` anywhere in the file.** `report-location-event` unconditionally sends WhatsApp (and every other enabled-by-default channel) for a self-alert regardless of whether the user opted out via F2g Settings.

**Net effect:** a user who disables WhatsApp in Settings (F2g, shipped) stops getting WhatsApp for time/email/calendar/weather/contact_silence-triggered alerts (via `evaluate-rules`) but keeps getting it for location-triggered alerts (via `report-location-event`) — the opt-out silently doesn't apply to one of the two alert-firing paths.

### 2.3 — Instance 3: `task_actions` execution (B10g), Phase 1-6 Approved, staging-deployed, not yet committed

Per `docs/B10G_PHASE1_PROBLEM_DEFINITION_2026-07-17.md` (Approved, exhaustive grep evidence): `task_actions` support was added to `evaluate-rules`' fan-out (F5c, 2026-06-15) but never ported to `report-location-event`'s independently-maintained duplicate fan-out (nor to `fire-pending-dwells`, which calls back into `report-location-event`). A location-triggered alert's third-party task actions are written successfully at create-time and never executed at fire-time — confirmed by exhaustive grep (zero references to `task_actions` in either file). B10g's own fix (Phase 4, built and tested, Phase 1-6 all Approved) extracted the F5c execution logic into `supabase/functions/_shared/task_actions.ts`, called by both functions — deployed to staging 2026-07-17, **not committed to git, Phase 7 manual test not yet run.**

### 2.4 — Instance 4: Action Rules classifier (B10k), the trigger-meeting instance

Per `project_naavi_b10k_voice_parity_gap.md` and ADR 0001: mobile's alert-creation classifier (`naavi-chat`'s `classifyIntent` + `buildActionConfirm`) and voice's own classifier/full-Claude-reasoning loop (`naavi-voice-server/src/index.js`, "ARCH-1" section, lines ~2260-2347) are **two completely independent implementations** — not a shared-vs-duplicated-fan-out case like 2.1-2.3, but two structurally different code paths that each decide, from scratch, what a natural-language alert request should become. B10j's classifier fix shipped only to mobile; discovered to have zero effect on voice only when Wael asked "will we test voice platform?" — not by any process step. Separately compounding this: `get-naavi-prompt`'s B10j fix (the LOCATION SELF-ALERT PRIMARY RULE, shared prompt content both classifiers' downstream Claude calls read) was deployed to **staging only** — production `get-naavi-prompt` is unpatched, and voice runs against production exclusively (no voice staging environment exists).

### 2.5 — Pattern check: this is 3+1, not 4 independent occurrences

Instances 2.1-2.3 all involve the same two Shared Core functions, `evaluate-rules` and `report-location-event` — one cron-bound, one event-bound, deliberately kept as separate implementations per `report-location-event`'s own docstring ("Architecture note: does not re-use evaluate-rules/fireAction because that function is cron-bound... Keep both in sync when changing the fan-out policy" — a comment-only contract, never enforced by test or shared module until B10g's Phase 4 partially addressed it for one feature). Instance 2.4 is architecturally unrelated — a mobile-vs-voice split, not an `evaluate-rules`-vs-`report-location-event` split — and is the one instance ADR 0001 already formally tracks as an unresolved Architecture Exception.

---

## 3. Root cause statement

| Finding | Root cause | Confidence |
|---|---|---|
| Four confirmed instances of feature/fix added to one duplicated implementation, not its counterpart | No enforcement mechanism (test, lint rule, shared module, or governance checklist item) existed prior to 2026-07-18 to verify a change applied to a "Duplicated" capability (per the now-formalized Architecture Reference §5a) actually reached every documented implementation. `report-location-event`'s "keep both in sync" docstring is the clearest evidence this was a known risk, acknowledged in prose, never backed by anything enforceable. | **Proven** — direct citation across 4 independently-investigated incidents, one freshly re-verified this session (§2.2) |
| 3 of 4 instances share one root mechanism | `evaluate-rules` and `report-location-event` are two independently-maintained fan-out implementations of overlapping business logic (channel selection, self-alert detection, `task_actions` execution, recipient resolution); B10g's Phase 2 already extracted one shared piece (`_shared/task_actions.ts`) as a proof of concept that more can be shared without merging the cron-vs-event-bound distinction itself. | **Proven**, file:line (§2.1-2.3) |
| Governance itself did not previously require checking "did I verify every documented implementation of a Duplicated capability" as a formal gate | Confirmed by the governance document's own version history — Phase 1A's Architecture Scope Rule / Cross-Repository Verification Rule, and Phase 6's Architecture Completeness verdict, were both added 2026-07-18, in direct response to B10k being discovered (see `docs/AI_DEVELOPMENT_GOVERNANCE.md` §13 Changelog, v3.0→v3.1 and v3.1→v3.2 entries). Prior to today's governance v3.5, no phase required this check explicitly. | **Proven**, document version history |
| Whether undiscovered drift exists in the other Duplicated-row capabilities not yet tied to a confirmed incident (Calendar reads, Gmail live reads, List reads, Conversation/turn state — Architecture Reference §5a) | Not established. No incident has surfaced for these four rows; that is different from confirming no drift exists — it may simply mean no one has looked, or no feature has been added to only one side since these were split. | **Not proven** — this is precisely what T1a's audit scope must determine; recommended as Phase 2's primary work, not assumed either way here. |

---

## 4. What alternatives were considered

- **"Just fix B10k in isolation, skip the broader audit."** Rejected — this is the option the Architecture Audit Trigger (§5, adopted today) was specifically written to override. The trigger's own text: "Feature development pauses and an Architecture Integrity Audit becomes the highest-priority work item" — B10k alone is a symptom; fixing it without checking whether the same drift exists elsewhere (which it does, per §2.1-2.3) would repeat exactly the narrow-fix pattern that let three prior instances go unnoticed.
- **"Treat all four instances as one root cause and design one unified fix."** Rejected — §2.5 shows this is factually wrong. Instances 2.1-2.3 share a root mechanism (`evaluate-rules`/`report-location-event` duplication); instance 2.4 (B10k) does not — it's a different pair of files, a different kind of duplication (full independent classifiers, not two fan-out functions), and already has its own ADR (0001) with its own unresolved decision (voice calls mobile's Edge Function vs. voice re-implements vs. leave as debt). Conflating them would produce a plan that's either too narrow (misses B10k) or too broad (tries to solve two structurally different problems with one design).
- **"Audit every Duplicated row in the Architecture Reference exhaustively before touching anything."** Not rejected, but not decided here — this is a real Phase 2 scoping question (audit depth: the 4 confirmed instances only, vs. all 5 Duplicated rows including the 4 unconfirmed ones). Flagged in §5 below as the primary open question for Phase 2, not resolved unilaterally in this document.
- **"Skip the audit's own Phase 1-8 governance and just write a report."** Rejected — the Architecture Audit Trigger explicitly names T1a as a governed work item ("scoped and run before any other Protected Core work resumes"), and per the holding list's own governance note, "Governance: Phase 1 (the audit) first, decide depth once scoped" — meaning the audit itself follows Phase 1 (this document), then Phase 2 decides how deep it goes, rather than skipping process because the work is "just investigation."

---

## 5. Scope boundary

**In scope for this document (Phase 1 only):** establishing that the problem is real, evidenced, and has a known partial mechanism (§2.5) — not designing the audit's methodology or fix.

**Explicitly NOT decided here, left for Phase 2 (Change Planning) to scope:**
1. **Audit depth.** Does T1a's Phase 2 (a) confirm and formally resolve only the 4 already-known instances (set expiration/review dates per ADR/Exception format, decide fix-vs-accept for each), or (b) additionally audit the other 4 Duplicated rows in Architecture Reference §5a (Calendar reads, Gmail live reads, List reads, Conversation/turn state) for undiscovered drift the same way §2.2 did for B10d this session? Recommendation, not a decision: given §2.2 took roughly one grep-and-read cycle to independently confirm, a shallow first-pass check (grep each documented "shared" claim against both codebases, per Governance §7a's "declare functionality shared without verification" prohibition) across the remaining 4 rows seems cheap relative to the risk a 5th silent instance represents — but this is Phase 2's call, informed by how much time Wael wants to commit.
2. **Whether to fix the `evaluate-rules`/`report-location-event` duplication as a structural unification (Deferred Architectural Recommendation, B10g Phase 1 §7) rather than continuing to patch it feature-by-feature** (as B10g's Phase 2 chose to do — share only the `task_actions` piece, not the whole fan-out). This was explicitly deferred in B10g's own Phase 1 as "premature to design until Phase 2 has scoped the immediate fix" — T1a is the first point where reconsidering it is actually appropriate, per B10g Phase 1 §7's own stated reconsideration condition ("three instances is the threshold... already met").
3. **B10k's own resolution path** — ADR 0001 names three candidates (voice calls `naavi-chat` directly / voice re-implements a matched copy / leave as tracked debt) with none evaluated against real data. Phase 2 should decide whether T1a resolves this choice directly, or scopes it as its own governed follow-on item once the audit's broader findings are known.
4. **Expiration/review dates for ADR 0001's Architecture Exception**, currently blank ("none set yet — must be set when T1a is scoped," per the ADR's own text) — a direct, concrete Phase 2 deliverable.
5. **Whether B10d and B10g are fixed together** (same files, same session, given B10g's Phase 1-6 are already Approved and B10d has no Phase 1 yet) or kept as separately governed items — a sequencing question, not an architecture question, but relevant to Phase 2's plan.

**Not in scope for T1a at all:** the specific code fixes themselves (those belong to B10g's own remaining phases, a new B10d Phase 1, and a new or extended B10k resolution item) — T1a's output per Governance §5 is an audit (verification + a resolved/tracked state for each finding), not a single code change.

---

## 6. Audit Success Criteria

Per Phase 1 review feedback (§10 below): this document previously explained why the audit exists and what triggered it, but never stated what "done" means — leaving Phase 1 without a completion target Phase 2 could plan against, or Wael could later verify was actually met.

**Objective, stated explicitly:** T1a's job is to **identify and classify** every duplicated implementation within its audited scope, and produce an explicit **disposition** for each one. It is not to guarantee elimination of all duplication — ADR 0001 already establishes that duplication can be a legitimate, formally-accepted outcome (an Architecture Exception with an expiration/review date), not a defect that must always be removed. Conflating "audited" with "eliminated" would make the audit's scope unboundedly large (every Duplicated row would require a full unification project) and contradicts the Exception mechanism Governance §5a already provides.

**T1a is complete, and feature development may resume (per Governance §5's trigger), only when all of the following hold:**

1. **Coverage check.** Every Duplicated-row capability in Architecture Reference §5a — at whatever depth Phase 2 sets (§5, item 1 of this document) — has been checked against current code. Each row's outcome is recorded as either "no undocumented drift found" or "new instance found and logged" (with its own file:line evidence, matching the standard §2 of this document applied to §2.2's B10d re-verification).
2. **Disposition, not silence, for every confirmed instance.** Each of the four instances named in this document (§2.1-2.4), plus any newly found during the coverage check, receives exactly one of three dispositions, each requiring Wael's own explicit sign-off:
   - **Fixed** — resolved via its own governed Phase 1-8 item, closed in the holding list.
   - **Accepted** — formalized as an Architecture Exception (ADR + owner approval + expiration date + review date, per Governance §5a's format), not left as an implicit justification.
   - **Deferred** — opened as its own separately-tracked holding-list item with an explicit priority tier, distinct from "accepted" (accepted means "we're choosing to keep this," deferred means "we haven't decided yet, but it's tracked").

   "No disposition recorded" is not an acceptable end state for any confirmed instance — mirroring this document's own §2 Change Impact Matrix language ("silence is not acceptable, in either direction").
3. **ADR 0001's currently-blank fields are filled in.** Its Architecture Exception block (`docs/adr/0001-...md`) has "Expiration date: none set yet — must be set when T1a is scoped" and "Owner approval: (pending)" — both must be resolved (a concrete date, and Wael's named approval) as part of T1a reaching completion, not left open indefinitely.
4. **The Architecture Reference reflects final dispositions.** Per Governance §Phase 8's existing precondition, any capability whose status changes (Duplicated → Fixed/Shared, or Duplicated → formally Accepted-as-Exception) must be updated in the Reference's §5/§5a tables in the same work item that resolves it — not deferred to a later cleanup pass.
5. **Wael explicitly confirms closure.** Consistent with the Phase-Gate Approval Rule already governing every other transition in this process — a checklist being satisfied is a recommendation, not authorization. T1a does not self-close because items 1-4 are checked; Wael's own separate word ends the "feature development paused" state.

**What this does NOT require:** zero duplication remaining in the codebase. An audit that ends with "3 Fixed, 1 formally Accepted with a 2027-01-18 review date" has met these criteria exactly as well as one that ends with "4 Fixed" — the measurable target is disposition-for-everything, not elimination-of-everything.

---

## 7. Which capability owns this behavior (Architecture Reference citation)

T1a does not audit one capability — it audits the **duplication-tracking mechanism itself**, which per the Architecture Reference spans:

| Sub-finding | Owning component(s), per Architecture Reference §0a | Classification |
|---|---|---|
| Recipient resolution (2.1) | Shared Core (`evaluate-rules`, `naavi-chat`) + Voice Server (its own resolution gap) | Duplicated |
| Channel-preference honoring (2.2) | Shared Core (`evaluate-rules`, `report-location-event` — both are Shared Core Edge Functions; this is an intra-Shared-Core duplication, not a mobile/voice split) | Duplicated |
| `task_actions` execution (2.3) | Shared Core (`evaluate-rules`, `report-location-event`) | Duplicated |
| Action Rules classifier (2.4 / B10k) | Shared Core (`naavi-chat`, called by Mobile) + Voice Server (independent classifier) | Duplicated — the "single most important duplication in the system," per Architecture Reference §2a |

All four are explicitly named in Architecture Reference §5's Current Architecture Debt (Priority 1) and §5a's Duplication Inventory. No capability here is Protected-Core-adjacent by accident — Action Rules and Notification routing are both named Protected Core areas (Architecture Reference §4), so this audit's findings (and any resulting fixes) require full Phase 1-8 governance, consistent with how B10g, B10d, and B10k are each already classified in the holding list.

---

## 8. Next step

Phase 2 — Change Planning, per governance — **not started, and will not be started without Wael's own separate, explicit go-ahead**, per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3). This document establishes and evidences the problem only; it does not select an audit methodology or a fix. Phase 2 should resolve the five open questions in §5, using the Architecture Reference's Change Impact Matrix and Mandatory Architecture Impact Checklist (Governance §Phase 2) as its structure, should explicitly state its recommended audit depth (§5, item 1) before any further investigation work begins, and should plan directly against §6's completion criteria — Phase 2's deliverable is, in effect, a plan for reaching every item in §6, not just a generic "investigate more" scope.

---

## 9. Phase 1 review record (2026-07-18)

Reviewer feedback received via Wael. One substantive gap identified, adopted:

1. **Missing completion target.** The document explained why the audit exists, what evidence triggered it, and what was out of scope — but never defined what "T1a is done" means. Reviewer noted Governance v3.5's emphasis on measurable gates makes this a real gap, not a stylistic one: without it, Phase 2 has no fixed target to plan against, and there's no way to later verify the audit actually closed versus just fading out.
2. **Resolution adopted:** new §6, "Audit Success Criteria" — states the audit's objective explicitly (identify + classify + disposition, not mandatory elimination, consistent with ADR 0001's existing Exception mechanism), and defines five concrete conditions that must all hold before T1a is considered complete and feature development resumes: coverage check across all Duplicated rows, an explicit disposition (Fixed / Accepted / Deferred) for every confirmed instance with no silent gaps, ADR 0001's blank fields filled in, the Architecture Reference updated to match final dispositions, and Wael's own explicit closure confirmation (consistent with the Phase-Gate rule already governing every other transition).

Reviewer's stated assessment: fully compliant with Phase 1 process — disciplined separation between problem definition and solution design, strong evidence, correct application of the Architecture Reference, appropriate Phase 2 boundary. The only recommended improvement (completion criteria) is the one adopted above.

**This is the reviewer's assessment of the document's quality — it is not, by itself, authorization to begin Phase 2.** Per the Phase-Gate Approval Rule, moving to Phase 2 requires Wael's own separate, explicit go-ahead regardless of this review verdict. That has not yet been given.

---

## 10. Status

**Phase 1 drafted 2026-07-18, revised same day per review feedback (§9). Phase 2 has NOT started and will not start until Wael gives explicit, separate approval for this specific transition.**
