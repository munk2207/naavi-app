# B10k — Phase 3: Technical Review (Before Coding/Deploying)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3. Subject: `docs/B10K_PHASE2_CHANGE_PLAN_2026-07-18.md`, which chose Option (a) — promote `get-naavi-prompt` to production — sequenced as five steps. This document resolves the implementation-strategy ambiguity Phase 2 left open (§2 below), then formalizes Implementation Boundaries (§3) and Deferred Architectural Decisions (§4), including an explicit restatement of Phase 2 §6's two-authorization requirement.

Required because the plan touches Protected Core (Voice orchestration, Action Rules) and is classified Medium-High Risk (Phase 2 §4).

---

## 1. Basis for this review

Phase 2 chose Option (a) over (b)/(c) with stated reasoning (disproportionate to gate a proven 3-line fix behind building an entire staging environment; a test alone doesn't close the gap). Nothing in this document reopens that choice. §2 resolves the two things Phase 2 left as "either/or" or approximate rather than exact: the verification method for pre/post-deploy checks, and the precise `PROMPT_VERSION` string.

---

## 2. Implementation strategy decisions

### 2a. Verification method, made concrete and pre-checked

Phase 2 §2 step 1 offered two options ("either by calling the live production endpoint directly... or via Supabase dashboard check") without choosing. Checked directly for this review: `get-naavi-prompt/index.ts:1640-1660` shows the function requires only a JSON body with `channel: 'app' | 'voice'`, returns `{ prompt, version }`, and is deployed `--no-verify-jwt` (per `CLAUDE.md`'s own deploy command for this function) with open CORS (`index.ts:27-29`). It is a pure read — no database write, no side effect, no user-specific state. **This makes a direct HTTPS call the correct method, not the dashboard** — faster, scriptable, and produces a literal saved response for the Evidence Package rather than a screenshot claim.

**Decision — the exact command, for both pre-deploy and post-deploy checks:**
```bash
curl -X POST https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/get-naavi-prompt \
  -H "Content-Type: application/json" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -d '{"channel":"voice"}'
```
**Pass/fail criteria, stated concretely so this isn't left to interpretation at execution time:**
- **Pre-deploy:** response body must NOT contain the substring `LOCATION SELF-ALERT PRIMARY RULE`, and `version` must equal the pre-B10j value (`2026-07-05-v133b-revert-schema-impossible-to_email`) — confirms §0's inference (production is exactly one commit behind) rather than assuming it.
- **Post-deploy:** response body MUST contain `LOCATION SELF-ALERT PRIMARY RULE`, and `version` must equal the new string decided in §2b below.
- **If pre-deploy fails** (rule text already present, or version doesn't match the expected pre-B10j string) — **stop before deploying.** This means §0's inference was wrong and production has drifted further than one commit; Phase 4 returns to Phase 2 rather than proceeding on a falsified assumption.

**Correction made during Phase 4 execution (2026-07-18), recorded here rather than silently fixed:** the pre-deploy check was first run using the plain substring `SELF-ALERT PRIMARY RULE` (without "LOCATION"), per this section's original wording. It came back "found," appearing to falsify §0's entire premise. Investigation (direct `git show 958a686` diff read) revealed `get-naavi-prompt` already contains an older, unrelated rule literally named `SELF-ALERT PRIMARY RULE` for **time-triggers** (line 625, pre-dates B10j) — B10j's own addition is specifically named `LOCATION SELF-ALERT PRIMARY RULE` (with "LOCATION" prefix) to distinguish the two, per B10j's own commit diff ("Mirrors the existing time-trigger SELF-ALERT PRIMARY RULE above (line 625)"). The original check text matched both rules; the corrected text above matches only B10j's. Re-run with the corrected string: **not found** in production — §0's premise holds. Separately, direct evidence now confirms *when* production was last touched: `npx supabase functions list --project-ref hhgyppbxgmjrwdpdubcx` shows `get-naavi-prompt` `updated_at` = 2026-07-15 6:29:50 PM EST — roughly 30 minutes after the F19 Track A commit (5:59 PM EST) and about two days before B10j's commit (2026-07-17 9:44 PM EST), directly confirming production reflects F19 Track A's state and nothing added since, exactly as §0 inferred from the commit-message chain alone.

**Why this stops the whole plan, stated explicitly rather than left implicit:** the pre-deploy check is doing two distinct jobs, not one. First, it verifies deployment state (does production currently lack the rule text) — a narrow, mechanical check. Second, and more consequentially, it verifies the assumption Phase 2 §0 built its entire risk classification on (that the production/staging delta is exactly B10j's 3 lines, not an accumulated backlog). Phase 2's Medium-High risk rating, its "narrow, well-understood diff" framing, and its decision to skip a full regression re-run (§4, Idea 2) all rest on that assumption being true. **If the pre-deploy check fails, the assumption is false — which means Phase 2's implementation plan was built on incorrect information, not just that one field doesn't match.** Proceeding to deploy anyway would mean deploying an unknown-sized diff under a risk assessment written for a known-small one. That is why this is a stop-and-reassess condition, not a log-and-continue one.

### 2b. `PROMPT_VERSION` string, decided

Phase 2 proposed an illustrative example (`'2026-07-18-b10k-production-promotion'`). Adopted as the actual value, unchanged — it's descriptive, dated, and greppable, consistent with the constant's existing naming pattern (`'2026-07-05-v133b-revert-schema-impossible-to_email'`).

---

## 3. Implementation Boundaries Confirmed

Per governance's Phase 3 requirement:

- **Authorized changes, exactly:**
  - `supabase/functions/get-naavi-prompt/index.ts:32` — `PROMPT_VERSION` constant value changed to `'2026-07-18-b10k-production-promotion'`. No other line in this file changes (the B10j rule content itself is already committed and correct — untouched).
  - One deploy action: `npx supabase functions deploy get-naavi-prompt --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx`.
  - Two verification calls (§2a's exact `curl` command), pre- and post-deploy, both read-only against the production endpoint.
  - One live manual voice-call test (Phase 2 §2 step 5) — performed by Wael, not scriptable, not substitutable.
- **No additional files are approved.** Not `naavi-chat/index.ts`, not `naavi-voice-server/src/index.js`, not any test file — B10j's own 18 tests already exist and passed on staging; this item deploys already-tested code, it does not add new tests for the deploy action itself (Phase 2 §5 explicitly considered and declined a full regression re-run against production as disproportionate).
- **No opportunistic changes.** The B10j rule text itself, already live on staging and already reviewed, is not touched, reworded, or "improved" while this file is open for the version-bump edit.
- **No architectural changes are approved beyond the version bump and the deploy itself.** No change to how `get-naavi-prompt` is fetched by either surface, no change to caching behavior (`naavi-voice-server/src/index.js:1876-1880`'s per-call cache and local-fallback logic), no change to `naavi-chat`'s own consumption of this function.

### 3a. The two-authorization requirement, restated explicitly (per Phase 2 §6's own instruction)

**This implementation requires two separate, non-substitutable approvals from Wael, not one:**
1. **Ordinary Phase-Gate approval** to proceed from this Phase 3 into Phase 4 — the standard "Go Phase 4" every other item in this project's history has required.
2. **A separate, explicit "deploy to production" instruction**, given at or immediately before the specific moment Phase 4 reaches the `supabase functions deploy ... --project-ref hhgyppbxgmjrwdpdubcx` command in §3's authorized list above — per `CLAUDE.md`'s STAGING-FIRST rule ("NEVER run ... deploy to `hhgyppbxgmjrwdpdubcx` without clear explicit approval") and its Absolute Rules.

**Approval #1 does not imply or satisfy approval #2.** If Phase 4 begins on approval #1 alone, execution must pause at the deploy step (§3's second bullet) and explicitly request approval #2 before running that specific command — the PROMPT_VERSION edit and the two verification calls do not require it (they're a local file edit and read-only production reads respectively), but the deploy itself does.

---

## 4. Deferred Architectural Decisions

Per governance's Phase 3 requirement:

**Idea 1: build the Voice Staging platform before promoting anything to production.** Not approved for this implementation. Already resolved in Phase 2 §2 (chose (a) over (b) directly, with reasoning: disproportionate to gate a proven, narrow, already-tested fix behind a multi-week infrastructure project). Recorded here per governance's requirement, not newly raised. **Reconsideration condition:** unchanged from Phase 2 — this remains its own separately-scoped Tier 5 initiative, informed by this item as one motivating example among others (B10c, B9y, and other voice-only defects already in the holding list share the same "no safe pre-production test path" root cause).

**Idea 2: run a full 18-test regression suite against production before/after this deploy, not just the two-call spot-check in §2a.** Not approved. Phase 2 §5 considered and explicitly declined this as disproportionate to a same-content deploy already validated on staging. The narrower pre/post-deploy verification (§2a) plus the mandatory live voice-call test (Phase 2 §2 step 5, §3's authorized list) are judged sufficient — the live voice-call test specifically closes the one gap a source-level regression suite structurally cannot (it proves voice's actual runtime, not just staging's, produces correct behavior). **Reconsideration condition:** if the post-deploy spot-check (§2a) or the live voice-call test surfaces any unexpected behavior, escalate to a fuller regression pass before considering this item's deploy step complete.

**Idea 3: adopt Phase 1 §5's candidate governance rule (per-execution-surface staging validation) as part of closing this item.** Not approved — Phase 1 §5 itself already states this is a finding, not an adopted rule, and requires its own pass through Governance §9's change-approval process, independent of this item's own close-out. Recorded here for completeness, not newly raised.

---

## 5. Phase 3 review record (2026-07-18)

Reviewer feedback received via Wael. One substantive clarification adopted, one general observation noted without changing this document:

1. **The pre-deploy check's stop condition needed explicit reasoning, not just the instruction to stop.** Added a paragraph to §2a explaining that the check does two jobs (deployment-state verification and Phase 2 §0's risk-classification assumption verification), and that a failure means Phase 2's entire plan was built on incorrect information — not merely that one field didn't match — which is why it's a stop-and-reassess condition rather than a log-and-continue one.
2. **General observation, not adopted here (correctly, per the reviewer's own framing):** hardcoding the production URL and expected version string is appropriate for *this* implementation, since the deploy target and expected state are genuinely fixed and known — but should not become a default Phase 3 pattern. Future Phase 3 documents should default to "verify expected production state" as a described procedure, hardcoding specific values only when a change's target is similarly fixed. No edit made to this document, since the observation itself says the hardcoding here is correct — recorded here as a note for future Phase 3 authors rather than folded into this item's own boundaries.

Reviewer's stated assessment: strongest B10-series Phase 3 to date — resolves implementation ambiguity rather than restating Phase 2 (exact verification method, exact command, exact pass/fail criteria, exact version string), Implementation Boundaries specify file/line/what-changes/what-doesn't/what's-prohibited precisely enough to prevent drift, the two-authorization model correctly separates governance approval from production authorization (the merged-approval failure mode behind many real deployment incidents), and Deferred Architectural Decisions demonstrates recording "considered, not chosen, why, reconsideration condition" without expanding scope. Eight-point compliance table (Phase 2 alignment, technical reasoning, risk identification, implementation specificity, scope control, Protected Core handling, production safeguards, governance compliance) — all ✅.

**This is the reviewer's assessment of the document's quality — it is not, by itself, authorization to begin Phase 4.** Per the Phase-Gate Approval Rule, that requires Wael's own separate, explicit go-ahead — and, per §3a, a second, separate authorization specifically for the production deploy step within Phase 4. Neither has been given.

---

## 6. Outcome

**Phase 3 approved for Phase 4, 2026-07-18, §5's clarification adopted.** Implementation is authorized only within §3's boundaries, using the exact verification command and pass/fail criteria decided in §2 (now with explicit stop-condition reasoning), subject to §3a's two-authorization requirement. Any change outside those boundaries requires returning to Phase 2 (or Phase 1, if new evidence changes scope — including, per §2a, if the pre-deploy check itself falsifies §0's "production is one commit behind" inference). No code has been changed and no deploy has occurred under this document. Phase 4 (Implementation), Phase 5 (Evidence Package), and Phase 6 (Technical Review After Coding) follow, per governance — none have started, and Phase 4 will not start without Wael's own separate, explicit go-ahead per the Phase-Gate Approval Rule (and, at the deploy step specifically, the second authorization named in §3a).
