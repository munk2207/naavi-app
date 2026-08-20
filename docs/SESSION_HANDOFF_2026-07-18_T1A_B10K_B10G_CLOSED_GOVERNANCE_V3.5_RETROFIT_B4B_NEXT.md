# Session Handoff — 2026-07-18 (T1a, B10k, B10g closed; Governance v3.5 retrofit pattern established; B4b next)

**Read this first, then `MEMORY.md`.** Three items closed this session, each with a full governed cycle, plus a new reusable pattern (retroactive Governance v3.5 compliance) validated end-to-end on one item. Next session's priority is **B4b**, one item, full Phase 1-8, starting fresh from Phase 1.

---

## What closed this session

### T1a — Architecture Integrity Audit
Triggered by Governance v3.5's Architecture Audit Trigger (a 4th confirmed duplicated-implementation instance — B10k's classifier duplication). Ran a full Phase 1-6 governed cycle in one session, all Approved. Disposed 7 items: 6 formally Accepted as dated Architecture Exceptions (ADRs 0001, 0002, 0005, 0006, 0007, 0008), 1 Deferred as its own fix candidate (`B10l` — voice's `reminders` write-path divergence, ADR 0003 pre-existing but never previously opened as a holding-list item). Architecture Reference updated to v2026.07.18.4. One self-caught error during Phase 4 (a draft holding-list edit briefly duplicated B10g's existing entry, caught on re-read, corrected) — recorded transparently, not scrubbed. Full record: `docs/T1A_PHASE1...` through `docs/T1A_PHASE6_TECHNICAL_REVIEW_2026-07-18.md`, Closed Tooling table.

### B10k — voice-parity production gap
B10j's fix (location self+third-party compound alert rule) had been staging-only; production `get-naavi-prompt` was never promoted, so voice callers never got it. Root cause proven in two parts: voice's own classifier structurally can't have B10j's specific bug (it falls through to full Claude reasoning, which does fetch the shared prompt); the actual gap was pure deployment promotion. Full Phase 1-6, all Approved. **A pre-deploy verification check first came back a false alarm** — searched for `SELF-ALERT PRIMARY RULE`, found it, but that matched a pre-existing unrelated time-trigger rule of the same name; corrected to the more specific `LOCATION SELF-ALERT PRIMARY RULE`, confirmed absent as expected. Deployed to production 2026-07-18 (Wael's own separate, explicit production authorization, distinct from ordinary phase-gate approval — the two-authorization model used throughout). Live voice call confirmed working. **A follow-on live fire simulation (same closing validation) surfaced B10g's real production exposure** (Bob's message silently never sent) and gave F19 Track C concrete on-device evidence (Wael's own phone missing V310/V311's Alerts-screen display fix). Full record: `docs/B10K_PHASE1...` through `docs/B10K_PHASE5_EVIDENCE_2026-07-18.md`, Closed Bugs table.

### B10g — task_actions never executed for location alerts
Original Phase 1-6 (2026-07-17, prior governance version) fixed the actual defect — extracted F5c's fail-closed `task_actions` logic into `_shared/task_actions.ts`, called by both `evaluate-rules` and `report-location-event`. **This session ran a full Governance v3.5 compliance retrofit** (Phase 1A-6A, 2026-07-18, all Approved) closing the gap left by the original approval predating v3.5's Phase 1A/Architecture Impact Checklist/Non-Determinism Rule/four-verdict Phase 6 requirements. Confirmed B10g is one of the three incidents ADR 0005 was itself built from, not merely consistent with it. **Found and corrected a real stale fact along the way:** the code was already committed to git (`e4a3c54`, 2026-07-17) — "not committed" status had been repeated across the holding list, T1a's closure record, and B10k's sequencing note. **Phase 7 (live manual test) passed 2026-07-18** — real texts landing on Wael's own phone (screenshot-confirmed), self-alert on 3 channels + Bob's third-party message both delivered, exactly one of each. Direct same-day contrast with B10k's own production fire simulation (identical scenario, Bob's message silently never sent there) — same defect, opposite side of the staging/production boundary, proving the fix. **Staging only, not promoted to production** — separate decision, not implied by this closure. Full record: `docs/B10G_PHASE1A...` through `docs/B10G_PHASE6A_TECHNICAL_REVIEW_2026-07-18.md`, Closed Bugs table.

---

## New pattern established: retroactive Governance v3.5 compliance retrofit

B10g's Phase 1A-6A is the reference template if any other pre-v3.5-approved item needs the same treatment (anything approved before 2026-07-18 under the prior governance version, not yet merged to production). Each phase answers a genuinely distinct question — don't collapse them:
- **1A** — did we investigate the complete architecture (ownership, classification, Architecture Reference citation)?
- **2A** — does the approved plan respect the architecture (Mandatory Architecture Impact Checklist, duplicated-pair rows addressed individually)?
- **3A** — does the approved technical strategy still stand (Non-Determinism Rule, Implementation Boundaries re-confirmed, Deferred Architectural Decisions updated to their actual resolution)?
- **4A** — did implementation actually follow that strategy (direct code verification, not trusting the original Phase 5's description — this is where B10g's git-status correction was found)?
- **5A** — evidence for the compliance pass itself (the retrofit is not invisible administrative overhead — it gets its own evidence package).
- **6A** — four-verdict structure (Technical Review / Architecture Completeness / Governance Compliance / Overall Recommendation) + explicit Architecture Drift Rule application.

None of this reopens the original technical decisions — it re-validates them against requirements that didn't exist when they were approved.

---

## Loose ends, named explicitly so nothing gets rediscovered from scratch

- **Environment mix-ups are real and easy to make — verify precisely, not just "the query came back empty."** During B10g's Phase 7, an initial claim that Wael's phone was on production (not staging) was wrong — caused by a query that ran before seeing a rule's already-updated content. Corrected only because Wael pushed back and asked for careful re-validation, not because the first check was thorough enough on its own. Worth remembering: "not found in environment X" is not the same as "confirmed to be in environment Y" — check both directions before asserting either.
- **F19 Track C (mobile production promotion)** now has concrete on-device evidence (Wael's phone missing V310/V311's Alerts display fix) but has not been started. It's the release step that bundles whichever of the five mobile-touching items below are ready into one AAB — not itself a bug to govern.
- **Five items on the current priority queue need a new mobile build** if/when fixed: F19 Track C itself (#3, the promotion step), B9x (#9, Full Phase 1-8 mandatory), B9d (#13, recommend at least Phase 3), B10i (#17, candidate for waiver — ask Wael), F9a (#19, recommend at least Phase 3). **Explicitly confirmed this session: these do NOT get bundled into one governance session** — one item per session stays the standing rule, no exceptions from here forward. They can still ship together in one AAB once each is independently approved (same pattern B10g+B10h already used).
- **B10d and B10l are next in line after B4b** (per T1a's own sequencing recommendation) — B10d should reuse B10g's now-proven `_shared/task_actions.ts`-style extraction pattern (a `_shared/channel_preferences.ts`-style module); B10l needs its own Phase 1 (none written yet).
- **ADR 0001, 0002, 0005, 0006, 0007, 0008 all share the same review date** (2027-07-18, or the next Architecture Audit Trigger, whichever comes first) — a deliberate simplification, not six independently-reasoned dates. If any one's underlying reasoning goes stale sooner (e.g., the Voice Staging platform gets built, changing ADR 0001's calculus), review it early rather than waiting for the shared date.

---

## Next session: B4b, one item, full cycle

**[[B4b]] — Deepgram drops leading words on barge-in.** Top of Tier 1. Confirmed voice-only (mobile has no live-streaming STT with barge-in — `useWhisperMemo.ts` is batch record-then-transcribe only). 4 fresh reproductions already on record from a prior session. Directly feeds into F5c's failure mode (a dropped recipient name silently becomes a self-alert) but is a separate root cause — investigate and fix in its own session, not combined with F5c. **Governance: Full Phase 1-8** (Voice orchestration, Protected Core). No Phase 1 written yet — start there.

**Standing rule reaffirmed this session, explicitly, going forward:** one governed item per session. No bundling multiple items' governance into one sitting, even when they'd ship in the same build.
