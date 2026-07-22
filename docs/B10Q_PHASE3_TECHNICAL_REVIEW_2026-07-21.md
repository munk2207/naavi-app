# B10q — Phase 3: Technical Review (Before Coding)

**Date:** 2026-07-21 (revised same day — see "Revision note" below)
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.6, Phase 3 — required, Phase 2's risk classification is Medium.
**Input:** `docs/B10Q_PHASE2_CHANGE_PLAN_2026-07-21.md`

This document originally contained no code — it was the implementation plan submitted for external technical review, self-assessed against the five Phase 3 evaluation dimensions before that review. **It has since been revised to reflect an implementation-time correction — see "Revision note" below.**

**Revision note:** the original version of this document authorized fixing voice's primary single-action speech path by checking the new error inside the existing `ACTION_DEFAULT_SPEECH` region (~3915-3936) and overriding the default. **That approach was reviewed and approved by the external reviewer** (PASS on all dimensions, "Overall Recommendation: APPROVE"). While implementing it in Phase 4, direct tracing found that assumption was wrong: `SET_EMAIL_ALERT` never reaches that synchronous region at all — it falls into the generic `backgroundActions` bucket (line ~12132-12134), executed via an un-awaited `Promise.all(...)` (line ~12285-12286) that runs *after* speech is already dispatched to Twilio as audio. The originally-approved fix could not have worked as written. With Wael's explicit approval (2026-07-21, mid-Phase-4), the corrected fix instead pulls `SET_EMAIL_ALERT` out into its own explicit, awaited branch in the primary dispatcher — mirroring the existing `LIST_READ`/`GLOBAL_SEARCH` pattern already used in the same file for exactly this reason. §"Implementation strategy" step 4 and §"Implementation Boundaries Confirmed" (voice file, item b) below are updated to reflect this. **This specific correction has not yet been reviewed by the external reviewer** — the reviewer's APPROVE verdict on this document covers the wording-distinction revision (§"Two wordings, deliberately") and everything else unchanged from the original submission, but predates this fire-and-forget finding.

This is a textbook case of Governance v3.6's **Invalidated Planning Assumption Rule** (§Phase 6): Phase 2/3 planned one implementation (check the `ACTION_DEFAULT_SPEECH` region); Phase 4 discovered it couldn't work, for a reason not evident during planning (the fire-and-forget execution model); a different implementation was required without changing the functional scope (still: reject the write, speak the correct decline). This will be recorded in Phase 6 as an Invalidated Planning Assumption per that rule, not as an omitted feature or a deliberate scope cut.

---

## Resolving the deferred decision (per Phase 2 reviewer's explicit request)

The Phase 2 reviewer noted the multi-action-queue wording question should be resolved in Phase 3, not carried into Phase 4 unresolved. Resolved here:

**Decision: the multi-action queue also gets the specific decline message, not the generic "That one failed — I'll move on."**

**Reasoning:** the entire point of this fix is that Naavi should tell the user *why* an email alert couldn't be created and *what to do about it*, not just fail silently or vaguely. If the exact same request — "alert me on every email" — gets a helpful, specific decline as a standalone sentence but a generic, unhelpful one when it happens to arrive as part of a compound request ("remind me to call mom and alert me on every email"), that's a real inconsistency, not a neutral scope boundary — the user did the same thing both times and gets a worse answer depending on phrasing structure they don't control. Kept terse to match the queue's existing per-item message length (`'Email drafted.'`, `'That one failed — I'll move on.'`): **"Couldn't set that email alert — needs a sender or subject."** This is now in scope for Phase 4, added to Implementation Boundaries below.

**Two wordings, deliberately, not an inconsistency — stated explicitly per reviewer request:**
- **Primary interaction** (standalone request, either surface): the full explanatory wording from Phase 1 — *"I can't set an alert for every email — that's what your email app is already for. Who should it be from, or what should it be about?"*
- **Multi-action queue** (voice, compound requests only): the intentionally abbreviated wording above — *"Couldn't set that email alert — needs a sender or subject."* — shortened specifically because the queue reports multiple action results in sequence and every other per-item message in that path is similarly terse (`'Email drafted.'`, `'That one failed — I'll move on.'`); matching the queue's existing message length is the reason for the shorter form, not a different or lesser standard of explanation.

---

## Self-assessment against the five review dimensions

### Assumptions

- **Assumed:** `hooks/useOrchestrator.ts:4196-4198` (mobile's direct `manage-rules op:'create'` caller for non-location triggers) can, in principle, also create `trigger_type='email'` rows, even though its typical documented use is time/weather/calendar/contact_silence. Phase 2 flagged this as unconfirmed rather than assumed either way. **Resolved for Phase 3 by direct check:** grepping this call site's surrounding code for `trigger_type` shows it passes through whatever `pendingParams.trigger_type` already is — it does not special-case or exclude `'email'`. So this caller **can** reach the email path, and the fix in `manage-rules` protects it automatically (no separate change needed at this call site) — confirmed, not left as an open question into Phase 4.
- **Assumed:** the structured error shape `{error: 'email_alert_unscoped'}` is safe to add to `manage-rules`'s response without breaking any existing consumer's error handling. Verified: `naavi-chat/index.ts:2464` already does `(!_mrRes.ok || _mrData.error) ? (_mrData.error ?? 'manage-rules failed') : null` — a generic truthy-error check, not a check against specific known error strings. A new error value flows through this existing branch without requiring changes to the branching logic itself, only to what speech gets chosen once inside it.
- **Assumed:** no other currently-passing test in the existing suite depends on an unscoped `trigger_type='email'` rule being creatable (i.e., this fix isn't quietly breaking a test that expects today's buggy behavior). Not yet verified by running the suite — Phase 4 must run `npm run test:auto` before and after and confirm no previously-passing test regresses, per standard practice; not assumed clean in advance.

### Architecture

- Both changes stay within their respective entry points' legitimate jobs: `manage-rules` is Shared Core validating its own write, `SET_EMAIL_ALERT` is voice's own entry-point classifier/executor validating its own write — neither reaches into the other's territory.
- Does not touch `evaluate-rules`'s matching logic at all (confirmed unchanged in Phase 2's Change Impact Matrix) — the fix is entirely "prevent the bad row from being written," not "handle the bad row better once it exists."
- No new file created on either side — both changes are additions to existing handler functions, consistent with the existing shape of validation-at-the-chokepoint (e.g. F5c's `name_too_short`/`zero_matches`/`ambiguous_multiple_matches` fail-closed checks in `_shared/task_actions.ts` are the established precedent for "reject with a specific reason instead of guessing").

### Isolation

- `manage-rules`'s new check reads only the `trigger_type` and `trigger_config` already present in the request body — no new external calls, no new state.
- `SET_EMAIL_ALERT`'s new check is the same shape — reads only `action.fromName`/`action.fromEmail`/`action.subjectKeyword`, already present, no new external calls.
- The speech-surfacing changes (`naavi-chat`'s commit handler, voice's multi-action queue) each only add a conditional branch keyed on the new error string — they don't restructure the surrounding function. **Revised:** voice's primary-path fix (see "Revision note") adds one new `else if` branch to an existing if/else-if dispatcher chain, following the identical shape of the `LIST_READ`/`GLOBAL_SEARCH` branches immediately adjacent to it — additive, not a restructure of the chain itself, but a larger unit of new code than the single-conditional shape originally planned.

### Hidden coupling

- **Checked:** does anything else read `manage-rules`'s `op:'create'` response and assume it's always either "row created" or a generic failure, in a way a new specific error string could silently confuse? Per Phase 2's Regression Matrix, exactly two callers exist (`useOrchestrator.ts:4196-4198`, `naavi-chat/index.ts:2442-2472`) — the first uses `Prefer: return=minimal` and doesn't appear to branch on `_mrData.error` content at all (only on request success/failure generically, per its own surrounding code, not deeply parsed here — flagged for Phase 4 to confirm directly rather than assumed), the second explicitly handles `.error` already (checked above).
- **Checked:** does `SET_EMAIL_ALERT`'s existing `label` construction (`naavi-voice-server/src/index.js:4646`) get computed or logged anywhere before the new validation could run, such that moving the check earlier changes log/audit output? Direct read confirms `triggerConfig` (used for the empty-check) is built at lines 4642-4645, immediately before `label` at 4646 — the validation slots in cleanly between them, before `label` is ever computed, which is also what makes the `"undefined"` label bug become unreachable (per Phase 2) rather than requiring a separate fix.

### Implementation strategy

Order of implementation:
1. `manage-rules/index.ts` — add the validation + structured error, verify via the new tests in isolation (create with empty config → rejected; create with a filter → still succeeds).
2. `naavi-chat/index.ts` commit handler — recognize the new error, speak the agreed decline wording. Reconcile the existing Layer-2-classifier wording (`:1851`'s `missingParam`) to match the same phrasing, so a user gets the identical sentence whether blocked at the classifier stage or the chokepoint stage.
3. `naavi-voice-server/src/index.js`'s `SET_EMAIL_ALERT` case — add the identical validation + structured error.
4. **[Revised]** Voice's primary single-action path — `SET_EMAIL_ALERT` does not pass through the `ACTION_DEFAULT_SPEECH` region as originally assumed (it falls into the un-awaited `backgroundActions` bucket instead, executed after speech is already dispatched). Corrected fix: add an explicit, awaited `else if (action.type === 'SET_EMAIL_ALERT')` branch in the primary dispatcher (mirroring the existing `LIST_READ`/`GLOBAL_SEARCH` pattern), checking the result and speaking the decline wording before `finalSpeech` is finalized.
5. Voice's multi-action queue path — add the specific short decline message per the resolved deferred decision above.
6. Full regression pass (`npm run test:auto`, per Rule 15's own environment-banner discipline — confirm which environment before trusting the result) plus the new tests from Phase 2.

---

## Implementation Boundaries Confirmed

- **Authorized files, and the specific change in each:**
  - `supabase/functions/manage-rules/index.ts` — add scoped validation (`trigger_type==='email'` + empty `trigger_config` → reject with `{error:'email_alert_unscoped'}`) inside the existing `op:'create'` handler. No other change to this file.
  - `supabase/functions/naavi-chat/index.ts` — (a) the pending-confirmation commit handler (~2420-2472): recognize `email_alert_unscoped`, speak the agreed decline wording. (b) The Layer-2-classifier `missingParam` text at `:1851` reworded to match the same agreed phrasing exactly. No other change to this file.
  - `naavi-voice-server/src/index.js` — (a) `SET_EMAIL_ALERT` case (~4627-4668): add the identical validation, return `{success:false, error:'email_alert_unscoped'}`. (b) **[Revised, mid-Phase-4, Wael's explicit approval]** Primary single-action path: not the `ACTION_DEFAULT_SPEECH` region as originally authorized (confirmed unreachable for this action type — see "Revision note") — instead, a new explicit `else if (action.type === 'SET_EMAIL_ALERT')` branch in the primary dispatcher (near the existing `LIST_READ` branch), awaiting `executeAction` and setting `finalSpeech` directly. (c) Multi-action queue path (~9818-9835): special-case this error with the terse decline message resolved above. No other change to this file.
  - `tests/catalogue/session-2026-07-21-b10q-email-alert-validation.ts` (new) — the five tests listed in Phase 2.
  - `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` — close-out entry once shipped, both surfaces.
- **No additional files are approved beyond those listed.**
- **No opportunistic refactoring is approved** — e.g., no touching `evaluate-rules`'s matching logic (even though Phase 1 documents it), no touching the label-construction code beyond confirming it's unreachable, no cleanup of the four other `executeAction` call sites confirmed unaffected in Phase 2.
- **No architectural changes are approved beyond what Phase 2 describes** — no DB constraint, no cross-repo shared module, no unification of mobile/voice creation logic.
- **Excluded from this authorization:** the one-time production cleanup query (Phase 2's "One-time cleanup" section) is confirmatory only (currently zero affected rows, per Phase 1 §2) — re-run at Phase 5, not part of the code change itself.

## Deferred Architectural Decisions

1. **A DB-level `CHECK` constraint on `action_rules` requiring non-empty `trigger_config` for `trigger_type='email'`**, as a defense-in-depth layer beneath the application-level validation (matching this project's own "DATA INTEGRITY — FOUR LAYERS" pattern, CLAUDE.md). Considered in Phase 2 and not adopted for this pass, reasoning restated here since it's a real architectural fork: a DB constraint can enforce the rule but can't produce a spoken/displayed decline message with the specific wording either surface needs — it would only produce a hard insert failure, which both `manage-rules` and `SET_EMAIL_ALERT` would then need to catch and translate anyway, making it redundant with the application-level check rather than a genuine additional safeguard for this specific bug. **Reconsider if:** a third, currently-undiscovered write path to `action_rules` for `trigger_type='email'` is found later — at that point a DB-level floor would protect against paths this investigation didn't know to check, which the application-level checks in this plan cannot.
2. **Extending this same validate-before-write discipline to other trigger types that could theoretically have their own "unscoped" version of this bug** (e.g., is there a `contact_silence` trigger shape that could be created with no `from_name`, or a `weather` trigger with no location?). Not investigated — out of scope for B10q, which is specifically about `trigger_type='email'`, evidenced by a real production symptom. **Reconsider as:** its own holding-list item if a similar symptom is ever found for another trigger type — don't speculatively harden trigger types with no evidenced problem.

---

## Status and next steps

**Original scope:** self-assessment complete, external-reviewed, **APPROVE** (all dimensions PASS, including the wording-distinction revision). Wael gave explicit go-ahead to Phase 4 on this basis.

**Mid-Phase-4 correction (this revision):** the voice primary-path fix described in the original review turned out to be technically unimplementable as written (§"Revision note"). Implemented differently, with Wael's direct approval, but **this specific change has not yet been through external Phase 3 review** — everything else in this document (wording distinction, `manage-rules` validation, `SET_EMAIL_ALERT` validation, multi-action queue handling) has. Per the Independent Review Rule's spirit (applied here even though this is Phase 3, not Phase 1A), this correction should be surfaced to the external reviewer before treating Phase 3 as fully settled for the complete implementation — flagged here rather than silently folded in as if already reviewed.
