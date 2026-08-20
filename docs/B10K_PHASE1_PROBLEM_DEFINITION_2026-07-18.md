# B10k — Phase 1: Problem Definition

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1 (including the Phase 1A Architecture Completeness requirements now folded into this single document, per §6 below). No code is written in this document. Touches Protected Core (Voice orchestration, Action Rules — the Claude system prompt drives Action Rules creation on both surfaces).

**Origin:** found 2026-07-17 while answering Wael's question "will we test voice platform?" during B10j's own close-out — exposed a false claim in B10j's Phase 2/5/6 documents ("classifyIntent shared across mobile and voice, no voice-server change needed"). Wael's explicit instruction at the time: document thoroughly, do not attempt a fix that session, place at the top of the priority queue. T1a (Architecture Integrity Audit, closed 2026-07-18) has since formally resolved the *architecture* question this finding raised — ADR 0001 accepts the mobile/voice classifier duplication as a dated Exception. **This Phase 1 is scoped narrowly to what ADR 0001 does not resolve: the practical deployment gap that stops B10j's fix from reaching any real voice caller.**

---

## 1. What exactly is broken

B10j (closed 2026-07-18) fixed a real bug: a compound request like "remind me when I arrive home to lock the door AND text Bob" was making Bob the alert's primary recipient and dropping the user's own reminder entirely — the user got nothing on any channel. The fix has two parts: a `naavi-chat` classifier change, and a new rule added to the shared Claude system prompt (`get-naavi-prompt`) — the "SELF-ALERT PRIMARY RULE" for location alerts, mirroring an existing time-trigger rule.

**The fix is proven correct** — B10j's own Phase 1-6 governance cycle (all Approved), 3/3 live manual trials plus 2 live fire simulations confirmed correct end-to-end delivery on staging. **The fix is not reaching voice callers**, for a reason that is purely operational, not architectural: `get-naavi-prompt` was deployed to the staging Supabase project only; production is unpatched; voice has no staging environment to run against, so every real voice call is served by the old, unfixed prompt. A caller today who says the exact phrasing B10j fixed will still experience the original bug.

---

## 2. Evidence

### 2.1 — The fix is real, committed, and staging-only (proven, fresh verification this session)

`git log --oneline -- supabase/functions/get-naavi-prompt/index.ts` shows commit `958a686` ("B10j: fix compound location-alert self+third-party requests dropping the user's own reminder"), which touched `supabase/functions/get-naavi-prompt/index.ts` (+3 lines). The commit's own message states directly: *"Deployed to staging only; production untouched. Manual end-to-end validation still pending."* This is a **change from B10k's original 2026-07-17 finding**, which described the fix as "not committed" — it has since been committed (same day/next), but committed-to-git and deployed-to-production remain two different facts, and only the first has changed.

The actual rule text is present in the current source (`supabase/functions/get-naavi-prompt/index.ts:625-630`):
```
SELF-ALERT PRIMARY RULE: When the user says "alert ME at [time]" or "remind ME at [time]"
— even if they also say "and send SMS to Bob" — the PRIMARY action MUST be a self-alert...
```

**A minor, separate process gap found in the same read:** `PROMPT_VERSION` (`get-naavi-prompt/index.ts:32`) still reads `'2026-07-05-v133b-revert-schema-impossible-to_email'` — a date twelve days before the B10j commit. `CLAUDE.md`'s own instruction ("Bump the `PROMPT_VERSION` constant inside the function for change tracking") was not followed for this change. Not the cause of the deployment gap, but noted because it also means the deployed staging function's `PROMPT_VERSION` response wouldn't distinguish "has the B10j fix" from "doesn't" if queried — a minor observability gap, flagged for Phase 2/5, not fixed here.

### 2.2 — Voice depends on whichever Supabase project its live `SUPABASE_URL` resolves to, and no staging variant of voice exists (proven architecture, one inference flagged explicitly)

`naavi-voice-server/src/index.js:1883` — `fetchSharedPrompt()` calls `${SUPABASE_URL}/functions/v1/get-naavi-prompt`, confirmed by direct read. `SUPABASE_URL` is a Railway-managed environment variable, not present in this repository (`CLAUDE.md`'s own env-var list for the voice server confirms this — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc. are "Railway env vars required," not committed config).

**What is directly proven:** the code path exists and depends on this variable. **What is inferred, not directly grep-confirmed from this codebase:** that the live value currently points to production (`hhgyppbxgmjrwdpdubcx`), not staging. This inference rests on `CLAUDE.md`'s own architecture documentation — the entire "HOW THE VOICE SERVER DEPLOYS" section describes exactly one Railway deployment with exactly one set of env vars, no staging variant, and the holding list's own Tier 5 item ("Voice Staging platform for `naavi-voice-server`... Placeholder'd 2026-07-17, not started") confirms no second environment exists to point to instead. Stated explicitly per governance's No Assumptions Rule: **this is architecturally proven (one voice deployment exists) and operationally inferred (that deployment's live env var points to production), not directly observed** — direct observation would require Railway dashboard access, out of scope for a code-level Phase 1.

**Required Phase 5 evidence if Option (a) or (c) proceeds:** capture the live production `SUPABASE_URL` value (or equivalent direct deployment evidence — a Railway dashboard screenshot, or a `/test/ask` response header/log line that identifies which Supabase project served it) before or during implementation, converting this operational inference into direct evidence. Phase 5's Evidence Package for whichever option Phase 2 selects should not rely on this document's inference alone.

### 2.3 — A production-only test path exists but was never used, for a stated reason

`naavi-voice-server/src/index.js:8233-8238` — `/test/ask`, gated by `VOICE_TEST_SECRET` (`process.env.VOICE_TEST_SECRET`), confirmed present, calls `askClaude` directly, bypassing Twilio/phone infrastructure entirely. Because the voice server has only one deployment, this endpoint — like every other code path in the file — runs against whatever `SUPABASE_URL` the live deployment resolves to (production, per §2.2). It was not used in the original 2026-07-17 investigation specifically because doing so risks real side effects on production data without explicit authorization for that specific production touch — correctly treated as its own decision, not bundled into "just check the fix."

### 2.4 — This is not the same problem T1a already resolved

T1a's ADR 0001 (Accepted, dated 2027-07-18 review) formally accepts that mobile (`naavi-chat`'s classifier) and voice (its own classifier/reasoning loop) are independent implementations of *alert-creation classification*. That is an architecture decision about *code duplication*, and it is closed. This Phase 1 is about something ADR 0001 does not cover: the **shared, non-duplicated** `get-naavi-prompt` function (Architecture Reference §2: "Claude system prompt (non-classifier) | `get-naavi-prompt` | Genuinely shared — voice fetches this Edge Function live, same bytes mobile uses") has a version of itself sitting in staging that has never reached the one and only environment voice actually calls. The bug class is a **deployment/promotion gap**, not a duplication.

---

## 3. Root cause statement

| Finding | Root cause | Confidence |
|---|---|---|
| Voice callers do not receive B10j's fix | `get-naavi-prompt` was deployed to staging only (commit message, §2.1); voice's only deployment calls whichever Supabase project its live env var resolves to, inferred to be production given no voice-staging environment exists (§2.2) | **Proven** for the staging-only deployment fact (commit message is direct evidence); **inferred, stated as such** for "voice therefore serves the old prompt" (architecturally sound, not directly observed via Railway) |
| The standard staging-first promotion gate (`CLAUDE.md`) did not catch this | Staging validation for B10j was performed via mobile (APK builds, live manual trials) — a genuinely different runtime than voice's Twilio/Node.js call path. Mobile-staging-validated does not equal voice-staging-validated when the two surfaces have no shared staging environment to jointly exercise. This is a gap in what "staging works" is assumed to mean, not a process violation — no rule was broken, but the rule's implicit assumption (one staging environment covers all surfaces) does not hold for voice. | **Proven** by direct comparison of B10j's validation record (mobile APK trials, per its Phase 5/6) against voice's actual test surface (§2.3 — the only voice-specific test path available touches production) |
| No PROMPT_VERSION bump on the B10j change | Process step in `CLAUDE.md` not followed for this specific commit | **Proven**, file:line (§2.1) — minor, not causal to the main defect |

---

## 4. Why this escaped governance

Root process analysis, not blame — every phase gate B10j actually passed was correctly applied; no existing rule was violated.

Governance's Phase 8 merge checklist (both the pre-v3.5 process B10j ran under and v3.5's current version) treats "manual validation passes" as a single binary gate — it does not require enumerating *which execution surfaces* that validation actually covered. B10j's manual validation was real and rigorous (3/3 live trials + 2 fire simulations, Approved) — but by construction it could only exercise mobile's runtime, since that's the only surface with a staging environment to validate against. Nothing in Phase 5's Evidence Package template or Phase 6's review checklist asked "which surfaces does this validation *not* cover, and why is that acceptable." The gap is a **blind spot in what "staging validated" is assumed to mean for a Shared Core capability with more than one calling surface** — not a process failure in the sense of a skipped step.

## 5. Governance impact

**This is a finding, not an adopted rule.** Per Governance §9's Governance Change Approval Process, any actual change to `docs/AI_DEVELOPMENT_GOVERNANCE.md` requires its own stated problem, stated benefit, concrete example, external review, Wael's explicit approval, and a version increment — a Phase 1 problem-definition document has no authority to amend governance unilaterally, and does not attempt to here.

**Candidate rule, surfaced for Wael's consideration:** *"Staging validation" cannot be considered complete for a Shared Core capability unless every execution surface that calls it either has an equivalent staging validation path, or an explicitly named and approved alternative validation method is recorded in the Evidence Package.* Concretely, if adopted, this would add one line to Phase 5's Evidence Package template ("which execution surfaces does this validation cover, and how was each one validated") and one line to Phase 8's merge checklist ("for Shared Core capabilities, was validation coverage confirmed for every calling surface, or was a gap explicitly accepted"). Applied retroactively to this exact case: B10j's Phase 5 would have had to write "voice: not validated, no staging path exists" in plain text — forcing the gap into view at close-out instead of being discovered by accident, three weeks and one direct question later.

This example — the concrete incident the candidate rule is built from — is this document's own §1-3 findings, offered as the evidence Governance §9 requires if Wael chooses to pursue adopting it as an actual governance change.

---

## 6. What alternatives were considered

Per Wael's original 2026-07-17 instruction, three candidate resolution paths were named and none chosen — restated here with concrete tradeoffs now that governance requires Phase 1 to inform, not decide, the choice:

- **(a) Promote `get-naavi-prompt` to production now.** Smallest, fastest step — a single `npx supabase functions deploy get-naavi-prompt --project-ref hhgyppbxgmjrwdpdubcx` (per `CLAUDE.md`'s standard production deploy pattern). Directly closes the gap for every real voice caller immediately. **Risk:** this would be the first production touch in the entire B10-series effort this session's history covers — `get-naavi-prompt` is fetched live by both mobile and voice (Architecture Reference §2), so a production deploy affects mobile's production users too, not just voice, even though voice is the surface with the actual gap. B10j's staging validation (mobile-side, live trials + fire simulations) provides real evidence of correctness for the mobile path; voice's correctness would be promoted un-validated on its own actual runtime, since no safe way to validate it pre-promotion currently exists (§2.3).
- **(b) Build the Voice Staging platform first** (already a Tier 5 holding-list item, placeholder'd, not started). Slower — a real infrastructure project (own Railway service, staging phone number, staging Supabase connection, controlled promotion path per that item's own description). Would close this specific gap and prevent the same gap recurring for every future voice-affecting prompt change, not just this one. **Risk:** meaningfully larger scope than the immediate problem; the immediate problem (one unfixed bug in production) persists for the duration of building it.
- **(c) Carefully use `/test/ask` against production with a disposable test scenario and manual cleanup.** Doesn't promote anything — validates whether the currently-unpatched production prompt actually exhibits B10j's bug (confirming the gap is real and current, not stale) and, if staging's `get-naavi-prompt` were temporarily pointed at via a modified request, could validate the fix's behavior without a full production promotion. **Risk:** runs directly against real production Supabase data; any test scenario needs explicit disposability (a throwaway test user/rule, confirmed cleanup) to avoid leaving artifacts in real user data — exactly the kind of production-touching decision `CLAUDE.md`'s Absolute Rules require Wael's own separate authorization for, not something to attempt on initiative.

None of the three is chosen here — that is Phase 2's job, informed by whichever tradeoffs above Wael weighs most heavily (speed vs. safety vs. root-cause permanence).

---

## 7. Scope boundary

**In scope for Phase 2, once authorized:** choosing among (a)/(b)/(c) above, or a combination (e.g., (c) first to confirm current exposure, then (a) or (b)) — this Phase 1 does not pre-select one.

**Not in scope for this document:**
- Re-litigating whether B10j's fix itself is correct — already Approved, closed, staging-validated (B10j's own Phase 1-6).
- Re-litigating the mobile/voice classifier duplication — already formally resolved (ADR 0001, Accepted, T1a).
- Whether B10g's and B10d's fixes have the same practical voice-can't-trigger-it caveat B10k originally noted for them — that was T1a's own finding (Architecture Reference §5a, ADR 0005), separately tracked, not re-opened here.
- Building the Voice Staging platform itself, if (b) is chosen — that remains its own Tier 5 scoped project with its own checkpoints, not folded into this item's governance cycle.

---

## 8. Which capability owns this behavior (Architecture Reference citation)

Per Architecture Reference §2: "Claude system prompt (non-classifier) | `get-naavi-prompt` (Shared Core) | Genuinely shared — voice fetches this Edge Function live, same bytes mobile uses." Classification: **Shared Core, genuinely shared — not Duplicated.** Owning component per §0a's Ownership Model: **Shared Core** (`munk2207/naavi-app/supabase/functions/*`).

**This is a meaningfully different classification than every T1a finding** — T1a's seven items were all about *duplicated* implementations drifting apart from each other. `get-naavi-prompt` is the opposite case: a single, correctly-shared implementation whose *deployment* (not its code) has drifted between two environments. The Architecture Reference's existing "genuinely shared" label for this capability remains accurate and needs no correction — the defect is entirely in the promotion pipeline, not in the architecture. Protected Core applies (Architecture Reference §4: "Claude system prompt drives Action Rules creation... Voice orchestration... a mistake here is heard live by a real caller with no undo") — full Phase 1-8 governance required, per the holding list's own existing classification for this item.

---

## 9. Phase 1 completion criterion

**Phase 1 is considered complete once external review confirms sufficient evidence exists to support Phase 2 planning** — not once every inference is converted to direct proof (§2.2's operational inference is explicitly carried forward as a Phase 5 evidence requirement, §2.2, rather than blocking Phase 1 itself) and not once every governance-process question is resolved (§5's candidate rule is explicitly deferred to Wael's own separate governance-change decision, not resolved here). This criterion is satisfied by this document's Phase 1 review record (§10, below).

## 10. Phase 1 review record (2026-07-18)

Reviewer feedback received via Wael, evaluated against Governance v3.5 and the architecture principles established in T1a. Four governance-strengthening additions identified, all adopted (none changed the technical conclusions):

1. **§2.2's operational inference lacked a stated path to direct evidence.** Added a "Required Phase 5 evidence" note — capture the live production `SUPABASE_URL` (or equivalent deployment evidence) if Option (a) or (c) proceeds, converting the inference into direct proof rather than carrying it forward unresolved.
2. **No root-process explanation for why this gap wasn't caught earlier.** Added new §4, "Why this escaped governance" — explains the blind spot (Phase 8's "manual validation passes" checkbox doesn't ask which execution surfaces were covered) without assigning blame; every phase gate B10j passed was correctly applied.
3. **The finding's broader governance lesson was at risk of living only inside this document.** Added new §5, "Governance impact" — a candidate rule (staging validation must be confirmed per-execution-surface for Shared Core capabilities, or an alternative explicitly recorded) surfaced for Wael's consideration, explicitly not self-adopted, since only Governance §9's own change-approval process can actually amend `docs/AI_DEVELOPMENT_GOVERNANCE.md`.
4. **No explicit Phase 1 exit criterion.** Added §9, above.

Reviewer's stated assessment: strongest Phase 1 in the B10 series to date — clean separation of proven vs. inferred facts, correctly treats ADR 0001 as already-closed rather than reopening it, alternatives presented without selecting one, scope boundaries reduce review ambiguity. Ten-point compliance table (problem definition, root cause, evidence/assumption separation, scope, architecture ownership, alternatives, no implementation, regression awareness, governance traceability, mobile/voice distinction) — all ✅. No major revisions requested; all four recommendations were governance-strengthening additions, not corrections.

**This is the reviewer's assessment of the document's quality — it is not, by itself, authorization to begin Phase 2.** Per the Phase-Gate Approval Rule, that requires Wael's own separate, explicit go-ahead. That has not yet been given.

---

## 11. Next step

Phase 2 — Change Planning, per governance — **not started, and will not be started without Wael's own separate, explicit go-ahead**, per the Phase-Gate Approval Rule. This document proves and evidences the deployment gap only; it does not select a resolution path. Phase 2 should evaluate the three candidates in §6 against the Change Impact Matrix and Regression Impact checklist (Governance §Phase 2), and — because option (a) would be the first production touch in this session's B10-series history — should explicitly flag whichever option is recommended as requiring its own separate production-authorization confirmation from Wael, distinct from ordinary phase-gate approval, per `CLAUDE.md`'s STAGING-FIRST rule.
