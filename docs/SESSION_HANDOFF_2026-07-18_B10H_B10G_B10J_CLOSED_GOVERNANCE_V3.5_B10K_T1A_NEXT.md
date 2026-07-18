# Session Handoff — 2026-07-18

**Read this first, then `MEMORY.md`'s index, then the holding list's priority queue (top of file).**

---

## 1. What shipped this session

### B10h — CLOSED (staging only)
Location-triggered "text NAME MESSAGE" alerts were silently dropping the message content. Root cause revised live during Phase 7 manual testing: a `naavi-chat` forwarding omission (the classifier extracted the message correctly, but `buildActionConfirm` never copied it into `action_config`), not a Claude-reliability issue as first assumed. Fixed, plus a related readback gap (confirmation speech didn't name the recipient/message). Validated end-to-end on staging APK V309 with a real delivered SMS confirmed by Wael. **Not promoted to production.**

### B10j — CLOSED (staging only)
Natural, compound location-alert requests ("remind me to lock the door AND text Bob") silently dropped the user's own reminder — the third party became the sole primary recipient. Full Phase 1-6 governed cycle, every phase externally reviewed and Approved (9.7-9.9/10 across phases — reviewer's own recommendation was to stop scoring numerically going forward, adopted in governance v3.5). Root cause: `naavi-chat`'s Layer 2 classifier has a location "CRITICAL EXCEPTION" that unconditionally forces all location-alert phrasing through a single-action path, bypassing the same multi-action check that correctly protects identical time-trigger phrasing. Fixed by narrowing that exception + adding a location-specific self-alert-primary rule to `get-naavi-prompt`, reusing the already-proven time-trigger mechanism.

Two follow-on bugs found and fixed live during manual testing, each needing their own staging APK:
- **V310** — Alerts screen's "Also notifies" section filtered `task_actions` for `type==='sms'`, but every real entry uses `type==='send_sms'` — permanently dead code, exposed (not caused) by B10j making the data correct for the first time.
- **V311** — B10h's Rule 12 readback fix only checked top-level `to_name`/`to`; a self-primary alert with a `task_actions` recipient got a bare "Alert set" with zero mention of the third party. Fixed in both insert paths in `hooks/useOrchestrator.ts`.

**Full manual validation, confirmed:** 3/3 live trials of the compound phrase all produced correct self-primary + `task_actions`; 2 live fire simulations both confirmed correct independent delivery (self got the reminder on SMS+WhatsApp+voice, the third party got a separate correctly-worded SMS). Committed across 3 commits, pushed. **Not promoted to production.**

### B10g — Phase 1-6 complete, Approved, staging only. Phase 7 (manual test) NOT yet run.
`task_actions` on location-triggered alerts were never executed at all (zero-recipient indefinitely, higher severity than F5c's wrong-recipient bug). Fixed by extracting F5c's fail-closed logic into a shared module (`_shared/task_actions.ts`) called by both `evaluate-rules` and `report-location-event`. Deployed to staging. **Phase 7 manual testing was blocked all session** — natural phrasing kept hitting B10j's bug instead of producing a real `task_actions` row to test against. **Now unblocked** since B10j is closed — this is genuinely ready to test first thing next session if B10k/T1a scoping doesn't take the whole session.

### F5c — CLOSED (staging only, not committed to git as of last check — verify before assuming)
Closed on existing evidence (8 automated tests + Phase 5 simulation against the real 2026-07-16 incident + 2 live manual passes) rather than a contrived Test 3 reproduction Wael correctly rejected as testing an artificial code path. **Still needs Wael's own separate go-ahead to commit the uncommitted fix and promote to production** — neither is implied by the closure decision.

### B10k — Found, documented, deliberately NOT fixed this session
While retesting B10j, Wael asked "will we test voice platform?" — which surfaced that a governance document (this session's own draft) had confidently claimed "classifier shared across mobile and voice, no voice-server change needed." **That claim was false.** Direct verification: `naavi-voice-server` has its own separate, simpler classifier (only handles read-only lookups) — every voice action-creation request falls through to full Claude reasoning using the genuinely-shared `get-naavi-prompt`, but B10j's fix to that file was only ever deployed to **staging**; production `get-naavi-prompt` (which is what voice actually runs against, since there is no voice staging environment yet) was never updated.

Three candidate resolution paths, none chosen:
1. Promote `get-naavi-prompt` to production now (first production touch in this entire effort).
2. Build the Voice Staging platform first (already a placeholder'd Tier 5 item).
3. Carefully use `naavi-voice-server`'s `/test/ask` endpoint (secret-gated, bypasses Twilio) against production with a disposable scenario and manual cleanup.

Wael's explicit instruction: document thoroughly, put at the top of the priority queue, **do not attempt a fix this session.**

### Governance documents — finalized as canonical, v3.5
`docs/AI_DEVELOPMENT_GOVERNANCE.md` replaced (was v2.2) with v3.5, developed through roughly six rounds of external review this session, directly in response to the B10k discovery. Key additions: Phase 1A Architecture Completeness Review with a Cross-Repository/Architecture Scope Rule; Phase 2 Change Impact Matrix + Mandatory Architecture Impact Checklist + per-change Regression Matrix; Phase 3 Non-Determinism Rule (classifier changes need 3 trials minimum — found empirically during B10j, the same compound phrase produced different Layer-2 routing across two live calls with zero code changes); Phase 6 four-verdict review structure (numeric scores removed) + three-outcome Architecture Drift Rule; Phase 8 Architecture Reference version-supersession check; Protected Core Ownership Change Rule; **Architecture Audit Trigger** (§5 — see next-session priority below); Architecture Exception format; Architectural Decision Records (ADRs) with an annual review lifecycle; explicit Governance Change Approval Process; full Changelog (§13).

**New companion document, `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`** — the authoritative Architecture Reference, built from a real capability-by-capability investigation (not assumption) across mobile, voice, and shared Supabase functions. Contains the Ownership Model, Architecture Principles, Protected Core file mapping, a Duplication Inventory, a prioritized Current Architecture Debt list, a Data Flow diagram, Decision Rules, and a versioned metadata block.

**New `docs/adr/`** — a template plus four backfilled Architectural Decision Records, honestly distinguishing genuine documented decisions (ADR-0004, Google App Actions being Android-only is a real platform constraint) from undocumented drift being formalized for the first time (ADR-0001 classifier duplication, ADR-0002 calendar-read duplication, ADR-0003 voice's reminders write path) rather than inventing a rationalized decision narrative that never happened.

**A near-miss worth recording:** mid-session, the governance draft file was accidentally deleted (user error) while still only in Downloads, uncommitted. Recovered via the Windows Recycle Bin (PowerShell `Shell.Application` COM object, since Git Bash's `find` can't reach the protected `$Recycle.Bin` folder) — confirmed all edits intact before continuing. No data lost, but a reminder that uncommitted governance drafts are one accidental delete away from being gone.

---

## 2. Current deployment state (staging vs. production)

| Component | Staging | Production |
|---|---|---|
| `naavi-chat` (classifier fix, B10j) | Deployed | **Not deployed** — this is B10k's core problem |
| `get-naavi-prompt` (B10h + B10j fixes) | Deployed | **Not deployed** |
| `report-location-event`, `evaluate-rules` (B10g, B10h Layer 4) | Deployed | **Not deployed** |
| Mobile app | V311 built and validated (B10h + B10j + both follow-on fixes) | Not built |
| F5c fix | Deployed | **Not deployed**, and not yet committed to git |

**Nothing from this session has touched production.** Every fix is staging-only, per the project's standing staging-first rule.

---

## 3. Next session priority — my recommendation, Wael's call on sequencing

**Do not try to cram this into a session that's already run three full governed cycles.** That's not a pacing preference — it's the same "one governed item per session" rule this project's own holding list already enforces, now applying to a fourth item on top of an unusually dense session.

**Top of the queue: [[B10k]] and [[T1a]] together, not sequentially.**

The Architecture Audit Trigger we finalized in governance v3.5 §5 fires on a fourth confirmed instance of the duplicated-implementation pattern — and that fourth instance is exactly B10k's root cause (documented in `docs/adr/0001-action-rules-classifier-duplication-accepted.md`). Per the rule we just adopted, T1a should now take precedence over other feature work, not sit in Tier 5 as background debt where it's been sitting. B10k is a narrower, already-scoped decision; T1a is the broader "does this same pattern exist elsewhere too" audit. They overlap enough that scoping them separately risks solving B10k in isolation and leaving T1a exactly where it's been.

**Concretely, recommended for next session's start:**
1. Scope T1a's Phase 1 with B10k as its first, already-investigated finding — a meaningful chunk of T1a's actual audit work is arguably already done, since today's Architecture Reference investigation already checked 15 capabilities across both codebases with real evidence (not assumption).
2. Decide B10k's actual fix path (production promotion / voice staging / test-endpoint) as part of that same scoping, not as an isolated bug fix — it's a genuine architecture decision, not a quick patch, and deserves the weight of a fresh session rather than a tired one.
3. **Only after that:** B10g's Phase 7 manual test (fully unblocked now, quick to run) and B4b (Deepgram barge-in, confirmed voice-only, its own separate session).

**What I would NOT recommend:** starting B10k's actual production-promotion decision cold, without T1a's broader context, since B10k's own resolution options were explicitly left undecided pending exactly this kind of scoping.

---

## 4. Loose ends, explicitly named so they aren't rediscovered from scratch

- **F5c**: uncommitted fix still sitting in the working tree (or wherever it was left) — needs Wael's explicit go-ahead to commit, separate from the closure decision itself.
- **B9x**: a third location-alert insert path (`useOrchestrator.ts`'s compound/numbered-list handler, zero contact resolution) was logged onto this existing item during B10h's Phase 2 design, not yet independently confirmed as the actual cause of B9x's own reproductions.
- **I4b** (Ideas table): Wael's own observation that alert messages have no friendly framing (voice calls speak the bare body, third-party SMS has no signature) — logged as a comment, explicitly not folded into B10j, not yet scoped.
- **Confirmation-speech gaps** (Tier 3, item 6): the recipient/message-naming half is now resolved (B10h + B10j's readback fixes); the "silent alert replacement not disclosed" half is still open and unscoped.
- **A duplicate copy of the governance draft** exists in the Windows Recycle Bin (`AI_DEVELOPMENT_GOVERNANCE_v3.0_FINAL (1).md`) from the accidental-deletion incident — harmless, not cleaned up, mentioned here only so it isn't mistaken for something meaningful if noticed later.

---

## 5. Where to actually start

`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` — the Architecture Audit Trigger note is right at the top of the priority queue, above Tier 1. Read that, then `docs/adr/0001-action-rules-classifier-duplication-accepted.md` for the concrete finding driving it, then decide sequencing with Wael before writing any Phase 1 document.
