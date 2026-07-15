# F19 — Phase 3: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3. Reviewer: ChatGPT (External Technical Reviewer). Subject: `docs/F19_PHASE2_CHANGE_PLAN_2026-07-15.md`, Track A (infrastructure promotion — `resolve-recipient`, `report-location-event`, `get-naavi-prompt`). Required because Track A touches Protected Core and Phase 1 classified this High Risk (`AI_DEVELOPMENT_GOVERNANCE.md` §4).

Two review rounds occurred before Phase 4 (implementation) began. Both are recorded below verbatim in substance, not paraphrased, per this project's evidence discipline.

---

## Round 1 — review of the original Phase 2 draft

**Scores:**

| Category | Score |
|---|---|
| Phase 2 structure | 10/10 |
| Dependency analysis | 10/10 |
| Risk analysis | 10/10 |
| Scope discipline | 10/10 |
| Architecture | 9/10 |

**Verdict:** "Overall, I would approve this for Phase 3 review, but I would ask one major question first."

**What the reviewer praised:**
1. Track separation (A/B/C) — "This is exactly the correct decomposition... greatly reduces implementation risk."
2. Refusing to design Track B's unknown fixes — "Many teams would have tried to design B9w/B9x/B9y anyway. Your governance prevented that. That is exactly the right discipline."
3. The regression table's "why" column, not just pass/fail claims.
4. The `anthropic_tools.ts` correction (§0) — "Instead of protecting previous conclusions, the document corrects them. That increases trust."

**The one concern raised — Track A's deployment sequencing had no operational safety net:**

> "Suppose: resolve-recipient PASS → report-location-event FAILS. Production is now halfway through the deployment."

**Two concrete requests:**
1. A rollback strategy per deployment — "documenting: 'If deployment N fails, production returns to state X.'"
2. Explicit production verification **after each** deployment, not batched at the end — "Deploy → Verify → Deploy → Verify → Deploy → Verify. Not: Deploy → Deploy → Deploy → Test."

**One wording suggestion (§7 at the time):** replace "Track A involves no new coding" with something acknowledging that committing and deploying are still real production-changing actions — suggested wording: *"Track A introduces no newly authored logic; it promotes existing staging-validated logic to production."*

**One strategic observation, carried forward as context (not a blocking item):** F19 "is no longer fundamentally a software implementation project. It is becoming a controlled production synchronization project... That is exactly the kind of project where discipline matters more than coding."

**Formal ask:** "Add a deployment verification and rollback subsection for Track A" — order, verification, rollback trigger, rollback action, success criteria before proceeding, for each deployment.

---

## Response — Phase 2 revised

`docs/F19_PHASE2_CHANGE_PLAN_2026-07-15.md` §3 ("Track A — deployment verification and rollback") was added, covering all three deployments with: verification method, rollback trigger, rollback action, and success criteria before proceeding — plus a preparation step (save each function's current production source before overwriting it, since "you cannot roll back to something you failed to preserve"). The wording suggestion was adopted verbatim in what became §8. Downstream sections renumbered.

---

## Round 2 — review of the revised Phase 2

**Scores:**

| Category | Score |
|---|---|
| Phase 2 structure | 10/10 |
| Dependency analysis | 10/10 |
| Deployment strategy | 10/10 |
| Rollback planning | 10/10 |
| Governance compliance | 10/10 |
| Implementation readiness | 10/10 |

**Verdict:** "I think this is now a reference-quality Phase 2 document... I would approve this Phase 2 document for Phase 3."

**What the reviewer highlighted as significantly stronger:**
1. Deployment is now a gated sequence, not a batch — "If something breaks after Deployment 2, you immediately know where to look."
2. "Rollback is no longer theoretical" — singled out the preservation step specifically: "You cannot roll back to something you failed to preserve. Adding the preparation step makes the rollback procedure practical instead of aspirational."
3. Explicit success criteria at every step — "That makes the process deterministic. Different engineers should arrive at the same go/no-go decision."
4. The `resolve-recipient` rollback design (delete, since nothing depends on it yet) — "Deleting the function if verification fails is actually cleaner than trying to redeploy some placeholder version... That returns production exactly to its previous state. That's good engineering."
5. `report-location-event`'s two-part verification (new behavior AND existing behavior) — "much stronger than simply saying 'run regression tests.'"
6. Deploying `get-naavi-prompt` last — "That ordering minimizes user impact if deployment stops midway."

**Non-blocking recommendations, explicitly marked as such:**
- "I would consider adding one additional success criterion after Deployment 3... Monitor production for X minutes/hours... I think that's acceptable [as written]. That is an enhancement, not a correction." — resolved operationally: Wael was asked directly after Track A's live verification passed and chose "call it done now" (no added monitoring window), recorded in `docs/F19_PHASE5_EVIDENCE_TRACK_A_2026-07-15.md`.
- **Future architectural recommendation, explicitly out of scope for F19:** a **Release Manifest** artifact for future Protected Core releases — "For every production release, it would record: Git commit, Mobile build number, Voice-server commit, Edge Function versions, Database migration level, Prompt version, Deployment date, Test evidence, Reviewer approvals... F19 has already collected most of this information manually. A Release Manifest would make it a standard deliverable. It also aligns perfectly with the Architecture Integrity Audit objectives." Not actioned in F19 — logged here for whenever the Architecture Integrity Audit (holding list, Tooling, T1a) is picked up.

**Closing framing from the reviewer:**

> "Version 1: Strong implementation plan, missing operational controls. Version 2: Strong implementation plan, strong operational controls, explicit rollback, explicit verification, explicit success gates. That closes the only gap I identified."

> "From this point forward, I would expect the Phase 3 review to focus less on document quality and more on validating whether the proposed production promotion sequence and deployment assumptions remain correct before any live changes are made."

---

## Review resolution table

Added per the reviewer's Round 3 recommendation ("not a correction... something I would consider for future governance documents") — makes every finding's disposition auditable at a glance rather than requiring a re-read of the prose above.

| Review finding | Action taken | Status |
|---|---|---|
| Deployment verification missing | Added Phase 2 §3 (per-deployment verify step) | Closed |
| Rollback strategy missing | Added per-deployment rollback trigger + action + preservation step | Closed |
| Wording clarification ("no new coding") | Updated Phase 2 §8 to "introduces no newly authored logic" | Closed |
| Explicit monitoring window | Deferred to Wael's direct decision post-verification — chose "call it done now" | Accepted |
| Release Manifest artifact | Deferred — tied to Architecture Integrity Audit (holding list, Tooling, T1a), out of scope for F19 | Future |

## Outcome

**APPROVE.** Track A proceeded to Phase 4 (implementation) with Wael's explicit go-ahead. All three deployments were executed in the approved order, each verified live before the next, per the plan this review approved. See `docs/F19_PHASE5_EVIDENCE_TRACK_A_2026-07-15.md` for what was actually done and observed — no rollback was needed; every verification passed.

Track B (1c/1d/1e) and Track C (mobile promotion, 1f) were not part of this review's scope and remain open, per `F19_PHASE2_CHANGE_PLAN_2026-07-15.md` §4/§5.

**Round 3 (this addition) — reviewer's strategic observations, recorded for continuity, not actioned in F19:** the reviewer noted that Phases 1–3 together now form something closer to a formal engineering change-control process than a typical feature workflow — "define with evidence → correct mistakes when new evidence appears → review independently → document why approval was granted → preserve the review history." The reviewer's suggested next step is at the release level, not the feature level: a **Release Manifest** (git commit, mobile build number, voice-server commit, Edge Function versions, migration level, prompt version, deployment date, test evidence, reviewer approvals — recorded as a standard deliverable per production release) as the operational proof that the Architecture Integrity Audit's two objectives (A: every deployed artifact reproducible from a tagged Git release; B: production/staging verifiably identical except for intended differences) were actually met. This is logged here and cross-referenced from the holding list (T1a) for whenever that audit is scoped — it is explicitly not part of F19.
