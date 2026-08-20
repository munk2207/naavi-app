# T1a — Phase 3: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3. Subject: `docs/T1A_PHASE2_CHANGE_PLAN_2026-07-18.md`, reviewed and revised per that document's own §11 (conditional-ADR wording fix adopted). This document does not repeat that review — it resolves the implementation-strategy ambiguity Phase 2 left for Phase 3 (§2 below), then formalizes the two elements governance requires specifically of Phase 3: Implementation Boundaries Confirmed (§3) and Deferred Architectural Decisions (§4), ahead of Phase 4.

Required because Wael chose to run full Phase 3 rather than the waiver Phase 2 §10 raised as an open option — resolved by his "Go - Phase 3" instruction. Subject matter is Protected Core (Action Rules, Notification routing, Reminder Engine), even though, as Phase 2 §7 states, this phase's own risk classification is Low (no code changes).

---

## 1. Basis for this review

Phase 2 (`docs/T1A_PHASE2_CHANGE_PLAN_2026-07-18.md`) §11 records reviewer feedback (the conditional-ADR wording fix) and a verdict of PASS across all five governance-compliance checks (builds from Phase 1, complete file inventory, Architecture Impact walked through despite no code, scope control, measurable Definition of Done), plus explicit technical agreement on all five resolved questions (Q1-Q5). Nothing in this document reopens that assessment. §2 resolves the one class of ambiguity Phase 2 left implicit — exactly how Phase 4 executes the "shallow check" for items 4-6, and how it protects against acting on stale information. §3-4 are the formal artifacts Phase 3 requires in addition to review.

---

## 2. Implementation strategy decisions

### 2a. The "shallow check" method, made concrete and pre-executed for items 4-6

Phase 2 §2 Q1 described the shallow check only in general terms ("grep both sides, confirm the Duplicated claim still holds"). Left that vague, Phase 4 could interpret "confirms" inconsistently across the three items. Resolved here by actually running the check as part of this technical review — a legitimate Phase 3 activity (evaluating "implementation strategy" before coding begins), not itself Phase 4's deliverable, since no ADR is drafted and no document is edited by this step.

**Gmail live reads — CONFIRMED duplicated, unambiguously:**
- `supabase/functions/naavi-chat/index.ts:1126,1176` — direct `gmail.googleapis.com/gmail/v1/users/me/messages` fetch calls.
- `naavi-voice-server/src/index.js:730,748` and, separately, `:1467,1484` — voice has **two** independent live-fetch call sites of its own, both hitting the same Gmail REST endpoint directly, neither routed through `sync-gmail` (the genuinely-shared background cron per Architecture Reference §2).

**List reads — CONFIRMED duplicated, unambiguously (different client mechanisms, same pattern):**
- `supabase/functions/naavi-chat/index.ts:1328` — Supabase JS client, `.from('lists')`.
- `naavi-voice-server/src/index.js:322,428,476,2117` — raw REST fetch, `${SUPABASE_URL}/rest/v1/lists?...` (voice's runtime doesn't use the Supabase JS client the same way; this is the equivalent direct-table-read, just a different call style — still a second, independent implementation of the same read).

**Conversation/turn state — CONFIRMED duplicated, structurally different shapes:**
- Mobile: `PendingAction` type (`lib/voice-confirm.ts`, imported into `hooks/useOrchestrator.ts:43`).
- Voice: a `pending_confirm` state value (`naavi-voice-server/src/index.js:254`) plus its own surrounding pending-action tracking logic (lines 91-120, per that file's own comments — e.g. the 2026-05-06 incident note about pending-location state surviving 31 minutes). Confirms Architecture Reference's own characterization ("architecturally difficult to unify... different runtimes, different session models") rather than a simple oversight.

**Consequence for Phase 4:** all three checks already pass. Phase 4's work for items 4-6 is not "determine whether an ADR is warranted" (Phase 2's conditional framing anticipated a real chance the answer would be no) — it is now "draft the ADR," using the file:line evidence gathered above. This does not change Phase 2's disposition of these as conditional in principle (a future item could come back "no drift" and this precedent stands for any future audit), but for this specific run, the condition is already met for all three.

**The file:line references gathered above are implementation guidance, not the formal evidence package.** Phase 3's job is to verify readiness before execution begins; Phase 5 remains the phase that documents evidence of what Phase 4 actually did (summary, files changed, diff, tests, rollback instructions, known risks, per governance's Phase 5 structure). This distinction matters specifically because verification happened unusually early here — a future contributor should not read this section as substituting for T1a's own Phase 5, which still must independently record what Phase 4 produced (the actual ADR files created, the actual Architecture Reference diff, the actual holding-list changes) once Phase 4 runs.

### 2b. Freshness re-check required at actual Phase 4 execution time — do not trust this session's snapshot

Phase 2 was drafted and this Phase 3 review is happening in the same session (2026-07-18), but per this project's "one governed item per session" pacing (`CLAUDE.md`, holding list governance block), Phase 4 may not execute until a later session. Two specific staleness risks, both requiring re-verification immediately before Phase 4 writes anything:

1. **ID collisions.** `B10l` (holding list) and ADR numbers 0005 onward were confirmed unused as of this session (2026-07-18). Before creating any new file or ID, Phase 4 must re-run the same check (`grep` the holding list for the exact ID, `ls docs/adr/` for the next unused number) rather than trusting this document's snapshot — another session could have claimed either in the meantime.
2. **B10g and B10k's live status.** This document's dispositions (§2a of Phase 2: B10g "Fixed, pending Phase 7 + commit"; B10k split into Accepted-classifier / Deferred-production-gap) reflect status as of 2026-07-18. If B10g's Phase 7 completes and it closes before Phase 4 runs, or if B10k's own dedicated scoping session (already recommended, not yet held) resolves its production-promotion question, Phase 4 must re-read the holding list and relevant memory files fresh, not carry forward Phase 2's wording verbatim.

---

## 3. Implementation Boundaries Confirmed

Per governance's Phase 3 requirement:

- **Authorized files, exactly** — per Phase 2 §1(A), unchanged by this review:
  - `docs/adr/0001-action-rules-classifier-duplication-accepted.md` — fill Expiration date, Review date, Owner approval only. No other content change.
  - `docs/adr/0002-calendar-reads-remain-duplicated.md` — same, fields only.
  - `docs/adr/0005-action-rules-execution-fanout-duplication-accepted.md` (**new**) — modeled on ADR 0001's structure, covering the `evaluate-rules`/`report-location-event` intra-Shared-Core duplication (Phase 2 §2 Q2/Finding C).
  - Up to three additional new ADRs (next-unused numbers, confirmed fresh per §2b above) for Gmail live reads, List reads, Conversation/turn state — using the file:line evidence in §2a of this document directly, not re-derived from scratch.
  - `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` — new Architecture Version; corrected "Action Rules — execution/firing" row (Finding C); "Reminders" row gains ADR 0003 cross-reference (Finding B); §5a Duplication Inventory gains the two currently-missing rows named in Phase 2 §1.
  - `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` — new `B10l` item (reminders write-path fix, per ADR 0003), T1a's own entry updated with closure status and a link to this document set, B10d/B10g annotated per Phase 2 §2 Q5's sequencing note.
- **No production/application code files are authorized.** Restated explicitly per Phase 2 §1(B) — this remains true after Phase 3 review, not loosened by it.
- **No additional files beyond the list above.** Not `docs/ARCHITECTURE_NAAVI_CHAT_ACTION_SYSTEMS.md` (a related but separately-owned doc — if it needs updating as a consequence of Architecture Reference changes, that's its own small follow-on, not silently bundled here). Not any test file (T1a adds no tests of its own, per Phase 2 §4 Change Impact Matrix).
- **No opportunistic changes.** While `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` is open for editing, no unrelated row may be touched, reformatted, or "cleaned up" beyond the specific additions/annotations named above.
- **No re-litigating Q1-Q5.** Phase 4 executes the plan Phase 2 already decided (audit depth, no fan-out unification, the classifier/production-gap split, the ADR date formula, B10d/B10g sequencing) — it does not reopen any of those five decisions. If Phase 4's actual execution surfaces evidence that contradicts one of them (for example, the shallow check for a conditional item coming back "not actually duplicated" — did not happen for the three checked in §2a, but remains procedurally possible for any future re-run of this pattern), Phase 4 stops and returns to Phase 2, per Governance's own change-control discipline, rather than deciding unilaterally.
- **Explicitly excluded from this authorization** — each needs its own future Phase 1/2/3, not implied here:
  - Choosing among ADR 0001's three candidate resolution paths (voice calls `naavi-chat` / voice re-implements / leave as debt) or B10k's three candidate paths (promote to production / build voice staging / careful `/test/ask` use).
  - Any actual code fix — B10d, `B10l` (reminders), F5c's remaining two recipient-resolution call sites, B10g's own Phase 7 + commit.
  - Full structural unification of `evaluate-rules`/`report-location-event` (formalized as Exception via ADR 0005, not implemented).

---

## 4. Deferred Architectural Decisions

Per governance's Phase 3 requirement:

**Idea 1: perform full incident-style Phase 1 investigations for Gmail reads / List reads / Conversation-state, instead of the shallow check.** Not approved. Phase 2 Q1 already scoped this down deliberately, reasoning that no known incident exists for any of the three (unlike F5c/B10d/B10g/B10k, which each started from a real, reported or discovered defect). §2a's pre-execution confirms all three are genuinely duplicated implementations, but confirms nothing about whether they have actually drifted in a user-visible way — that remains unproven, consistent with the ADR 0002 precedent (Calendar reads: "this item has not received the same investigation ADR-0001 got"). **Reconsider only if** a future session finds a concrete drift instance in any of these three (a fix applied to one side, provably missing from the other) — the same reconsideration trigger already used for the `evaluate-rules`/`report-location-event` pair (three instances).

**Idea 2: unify `evaluate-rules` and `report-location-event`'s full fan-out logic now, given the pattern is now formally documented (ADR 0005).** Not approved. Already resolved in Phase 2 Q2 — formalizing as an Exception is the decision, not a placeholder for later reversal within this same work item. Recorded here per governance's requirement (any idea raised but not approved must be logged), though it isn't newly raised — Phase 2 already closed it, and B10g's own Phase 3 (2026-07-17) recorded the same idea as deferred once before. **Reconsider condition, restated:** at ADR 0005's review date (2027-07-18 or the next Architecture Audit Trigger, whichever comes first, per Phase 2 §2 Q4) — not before, absent a fifth confirmed drift instance on this same pair.

**Idea 3, newly surfaced during this Phase 3's own investigation (§2a): should voice's two independent Gmail live-fetch call sites (lines 730/748 and 1467/1484) be unified with each other, separately from the mobile-vs-voice question?** Not evaluated — out of scope for T1a, which audits mobile-vs-voice (and, per Finding C, Shared-Core-internal) duplication, not intra-file duplication within a single codebase. Noted for whoever eventually works on Gmail live reads, not acted on here.

---

## 5. Phase 3 review record (2026-07-18)

Reviewer feedback received via Wael, evaluated against Governance v3.5 as the first documentation-only Protected Core item to go through this process. One substantive clarification identified, adopted:

1. **Verification-vs-evidence boundary not stated explicitly.** Section 2a performed real verification (grep + file:line confirmation) unusually early — during Phase 3 rather than Phase 4/5 — which is appropriate for Phase 3's "implementation strategy" charter, but risked being read as substituting for T1a's own Phase 5 Evidence Package. Reviewer's point: Phase 3 verifies readiness; Phase 5 documents evidence of execution. Conflating them, even unintentionally, would erode the distinction for future governed items that verify early the same way this one did.
2. **Resolution adopted** — added an explicit sentence at the end of §2a: the file:line references are implementation guidance for Phase 4, not a substitute for Phase 5's own record of what Phase 4 actually produced (the real ADR files, the real Architecture Reference diff, the real holding-list changes).

Reviewer's stated assessment (per governance section, all PASS): Phase 3 correctly resolves ambiguity/confirms boundaries/records deferred decisions without reopening Phase 2; §2's pre-execution of the shallow check turns Phase 4 into an execution activity rather than another investigation; the freshness-protection requirement (§2b) is called out as a standout addition, functioning as regression protection many governance systems lack; Implementation Boundaries are extremely explicit (allowed/not-allowed/no-code/no-opportunistic-edits/no-reopened-decisions); Deferred Architectural Decisions consistently pairs each idea with why it's rejected/deferred and what would reopen it. Broader observation: across Phases 1-3, this project's governance has evolved from controlling code changes specifically to governing architectural decisions and documentation with the same discipline — problem (Phase 1) → plan (Phase 2) → frozen execution boundaries (Phase 3) → execution only within those boundaries (Phase 4).

**This is the reviewer's assessment of the document's quality — it is not, by itself, authorization to begin Phase 4.** Per the Phase-Gate Approval Rule, that requires Wael's own separate, explicit go-ahead. That has not yet been given.

---

## 6. Outcome

**Phase 3 drafted and reviewed 2026-07-18, §5's clarification adopted. Implementation is authorized only within §3's boundaries, using the pre-verified implementation guidance in §2a for the three conditional items (not a substitute for Phase 5's own evidence record), subject to the freshness re-checks in §2b.** Any change outside those boundaries requires returning to Phase 2 (or Phase 1, if new evidence changes scope). No code has been written under this document, and no target file (ADR, Architecture Reference, holding list) has been edited yet — §2a's grep/read was verification only. Phase 4 (Implementation), Phase 5 (Evidence Package), and Phase 6 (Technical Review After Coding) follow, per governance — none have started, and Phase 4 will not start without Wael's own separate, explicit go-ahead per the Phase-Gate Approval Rule.
