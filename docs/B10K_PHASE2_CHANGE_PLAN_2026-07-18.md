# B10k — Phase 2: Change Planning

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. Builds on `docs/B10K_PHASE1_PROBLEM_DEFINITION_2026-07-18.md` (reviewed, revisions adopted, approved for Phase 2). Touches Protected Core (Voice orchestration, Action Rules) — automatically requires Phase 3 technical review before coding, per governance §4.

Scope is bounded by Phase 1 §7: choosing among the three candidate resolution paths (a) promote `get-naavi-prompt` to production, (b) build the Voice Staging platform first, (c) careful production `/test/ask` validation — or a combination. §2 below answers this directly.

---

## 0. Supporting evidence gathered before choosing an approach

Per Phase 1 §7's explicit recommendation to inform, not pre-select, the choice — checked one thing Phase 1 didn't: **is production `get-naavi-prompt` missing only B10j's change, or has it drifted further behind staging?** This materially changes every option's blast radius.

`git log --oneline -- supabase/functions/get-naavi-prompt/index.ts` shows the commit immediately preceding B10j's (`958a686`) is `a13b07c` — **"F19 Track A: catch up git on F15/F12 self-override + location-tool-split work already live on staging."** The holding list's own F19 closure record (`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, F19 entry, sub-item 1g) states directly: *"`report-location-event` + `get-naavi-prompt` deployed to production, committed to git — CLOSED (Track A)."*

**Reading this precisely:** as of F19 Track A's closure (2026-07-15/16), production `get-naavi-prompt` was brought in sync with git/staging. The very next commit to touch the file is B10j (2026-07-17), which is confirmed staging-only (Phase 1 §2.1). No commit exists between the two. **This means the current production-vs-staging delta for `get-naavi-prompt` is very likely exactly B10j's 3-line addition — not an accumulated backlog of unpromoted changes**, despite the file's long history of staging-iteration commits (20+ shown in `git log`, spanning compound-request handling, email-subject rules, birthday disambiguation, etc.) predating F19 Track A's promotion.

**Stated with the same honesty Phase 1 required of its own inference:** this is **inferred from the holding list's own prior closure record, not directly re-verified against the live production endpoint** — the same category of evidence gap Phase 1 §2.2 already flagged. Phase 1's "Required Phase 5 evidence" note (capture direct deployment evidence) now does double duty: it also confirms or corrects this narrower-than-fresh-looking delta before any production deploy proceeds.

---

## 1. Files that will change

**None, in the traditional sense.** `supabase/functions/get-naavi-prompt/index.ts` was already changed and committed under B10j (`958a686`) — that work is done, reviewed, and Approved. This Phase 2 plans a **deployment action**, not a code change:

| Action | Target | Risk |
|---|---|---|
| Deploy `get-naavi-prompt` (no code change from what's already committed) | Production (`hhgyppbxgmjrwdpdubcx`) | Medium-High — see §4 |
| Bump `PROMPT_VERSION` (currently `'2026-07-05-v133b-...'`, stale per Phase 1 §2.1) | `supabase/functions/get-naavi-prompt/index.ts:32` | Low — a version-string change only, no behavioral effect |

**The `PROMPT_VERSION` bump is a small, deliberate scope addition, not drift.** It closes Phase 1 §2.1's flagged process gap (the constant wasn't bumped when B10j's rule was added) and gives Phase 5 a direct, queryable signal that the new prompt is actually live in production — the exact kind of evidence Phase 1 §2.2 called for, obtainable by checking the `version` field `get-naavi-prompt` returns (`index.ts:1653`) against the pre-deploy value.

---

## 2. Proposed change — which option, and why

**Chosen: Option (a) — promote `get-naavi-prompt` to production — not Option (b), not a standalone Option (c).**

**Why not (b), build Voice Staging first:** a real, valuable initiative (already Tier 5, placeholder'd) — but gating this specific, already-proven, already-committed 3-line fix behind building an entire second Railway/Supabase environment is disproportionate. The bug stays live for real callers for the full duration of that build, which could be weeks. B10j's fix does not need a voice staging environment to be *correct* — it needs one to be *conveniently re-testable before every future voice-affecting prompt change*, which is a different, longer-horizon problem than closing this one gap. Recommend (b) proceed as its own separately-scoped Tier 5 project, informed by this item as one motivating example, not blocked on by it.

**Why not (c) as a standalone resolution:** `/test/ask` (Phase 1 §2.3) validates behavior but does not itself close the gap — even a successful test still leaves production unpatched for every real caller. Its value is as a **verification step embedded in (a)**, not a substitute for it.

**Sequencing for (a), in order:**

1. **Pre-deploy evidence capture (closes Phase 1 §2.2's inference and confirms/corrects §0's finding above).** Before deploying, capture direct evidence of production `get-naavi-prompt`'s current state — either by calling the live production `get-naavi-prompt` endpoint directly (it's a public-callable Edge Function returning `{ prompt, version }`, per `index.ts:1653`) and confirming the `SELF-ALERT PRIMARY RULE` text is **absent** and the version string matches the pre-B10j value, or via a Supabase dashboard check. This step is read-only — no production data is modified — and requires no special authorization beyond ordinary Phase 4 execution.
2. **Bump `PROMPT_VERSION`** to a value that identifies this exact change (e.g. `'2026-07-18-b10k-production-promotion'`), committed alongside no other change.
3. **Deploy to production** — `npx supabase functions deploy get-naavi-prompt --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx`, the standard command per `CLAUDE.md`. **This step requires Wael's own explicit "deploy to production" authorization, separate from and in addition to ordinary Phase-Gate approval for Phase 4** — per `CLAUDE.md`'s STAGING-FIRST rule and Absolute Rules, and per Phase 1 §11's own flag that this is the first production touch in this session's entire B10-series work.
4. **Post-deploy verification.** Re-fetch the live production endpoint, confirm the new `version` string and the presence of the `SELF-ALERT PRIMARY RULE` text.
5. **Live voice-call manual test against production** — Wael calling Naavi's real number with the exact compound phrasing B10j fixed ("remind me when I arrive home to lock the door and text Bob"), confirming the user receives their own self-alert on the expected channels and Bob receives the third-party message, with the primary self-alert not silently dropped. **This is the mandatory acceptance criterion this entire item exists to satisfy** — mobile-side staging validation (B10j's own Phase 5/6) already proved the fix works; voice has never been tested against it, on any environment, until this step. Per Phase 1 §4's governance-impact finding, this is exactly the validation-per-execution-surface gap that let B10k happen in the first place — this Phase 2 does not repeat it.

---

## 3. Regression impact

| Area | Impact | Why |
|---|---|---|
| Voice commands | **Affected — this is the fix's purpose.** Every voice call fetches `get-naavi-prompt` live (`index.js:1883`); the new rule becomes active for every voice-originated location-alert request the moment production is deployed, not just the specific bug's repro phrasing. | Direct, intended |
| Geofencing | Not directly affected — this changes prompt-time classification of a *request to create* a location alert, not the geofence-firing execution path (`report-location-event`/`evaluate-rules`, untouched by this item). | No overlap |
| Gmail integration | Not affected. | No overlap |
| Calendar integration | Not affected. | No overlap |
| Reminders | Not affected — `get-naavi-prompt`'s new rule is scoped to location-alert compound phrasing, not the `reminders` table or its write paths. | No overlap |
| SMS / call alerts | **Affected indirectly** — correct classification upstream (this fix) is a precondition for the downstream send logic (already-shared, already-correct per T1a's audit) to fire on the right recipient. No change to the sending logic itself. | Upstream precondition only |
| Onboarding | Not affected. | No overlap |
| Staging build | N/A — no AAB, no mobile client change. Staging Supabase (`xugvnfudofuskxoknhve`) already has this change (deployed under B10j); this item's staging side is done. | Production-only remaining step |

**Broader regression risk, since `get-naavi-prompt` is used by every Claude call on both surfaces, not just location alerts:** B10j's own Phase 5 (18 new tests: 15 negative controls confirming ordinary single-action location phrasing is *not* mis-routed by the new rule, 2 positive controls × 3 trials each per the Non-Determinism Rule, 1 untested novel phrasing to guard against overfitting) already covers this concern directly — reused here as existing evidence, not re-derived. **This regression suite exercised staging, not production** — the pre-deploy/post-deploy verification in §2 steps 1 and 4 is the closest analogue to re-running it against the actual deploy target, though a full 18-test re-run against production is not proposed here as disproportionate to a same-content deploy already tested elsewhere.

---

## 4. Risk classification

**Overall: Medium-High.** Protected Core (Voice orchestration + Action Rules) — automatically requires full Phase 1-8 per governance §4.

**The risk shape here is unusual — not a code-correctness risk, a deployment/blast-radius risk.** The code itself carries Low-Medium technical risk: it's already committed, already reviewed (B10j Phase 1-6, all Approved), and already validated by 18 passing tests plus live staging trials. What elevates this to Medium-High is exclusively **where** it deploys: production `get-naavi-prompt` is fetched by every live Claude call on both mobile and voice, for every real user, the instant it's deployed — there is no staged rollout, no canary, no per-user flag. If the new rule text somehow interacted badly with unrelated prompt behavior (not indicated by any evidence gathered so far, but not disprovable in advance either), the exposure is immediate and total across both surfaces.

**This is mitigated, not eliminated, by:**
- §0's finding that the actual diff is narrow (3 lines, one self-contained rule) rather than a large accumulated backlog.
- B10j's own regression suite already covering the negative-control concern (ordinary phrasing not mis-routed).
- The pre/post-deploy verification steps (§2, steps 1 and 4) converting Phase 1's open inference into direct evidence before and after the deploy, not just after.
- Trivial rollback — `get-naavi-prompt` is a stateless read function with no schema/data dependency; reverting to the prior deployed version (redeploying from the pre-B10j commit, or restoring the pre-bump `PROMPT_VERSION`) fully undoes this change with no data cleanup required.

---

## 5. Explicitly deferred

- **Building the Voice Staging platform** (Tier 5, placeholder'd) — this item's finding (voice has no staging path to validate against) is offered as concrete motivating evidence for that separate initiative, not folded into this item's scope, per §2's reasoning above.
- **B10g's and B10d's own fixes** — T1a already dispositioned the architectural question (ADR 0005, `_shared/task_actions.ts` pattern); their own governance cycles (B10g Phase 7, B10d not yet started) proceed independently, unaffected by this item.
- **A full 18-test regression re-run against production** — considered and not proposed as disproportionate to a same-content deploy already validated on staging; the narrower pre/post-deploy verification (§2) is judged sufficient. Flagged here explicitly as a choice, not an oversight, so Phase 3 can revisit if it disagrees.
- **The candidate governance rule from Phase 1 §5** (per-execution-surface staging validation) — still not adopted, still requires its own pass through Governance §9, not actioned by this Phase 2.

---

## 6. Next step

Phase 3 — Technical Review (Before Coding/Deploying), mandatory per governance §4 (Protected Core) and this document's Medium-High risk classification — **not started, and will not be started without Wael's own separate, explicit go-ahead**, per the Phase-Gate Approval Rule.

**Two distinct authorizations will be needed before this item closes, not one:** (1) ordinary Phase-Gate approval to proceed through Phases 3-6 (technical review, implementation planning, evidence, review-after), and (2) per §2 step 3, Wael's own explicit "deploy to production" instruction at the specific moment Phase 4 reaches the actual `supabase functions deploy ... --project-ref hhgyppbxgmjrwdpdubcx` command — distinct from and not satisfied by approval of the phases surrounding it. Phase 3 should restate this two-authorization requirement explicitly in its own Implementation Boundaries, so it isn't lost by the time Phase 4 actually executes.
