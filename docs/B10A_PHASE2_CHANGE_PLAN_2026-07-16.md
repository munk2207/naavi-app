# B10a — Phase 2: Change Planning

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. No code is written in this document. Touches Protected Core (Voice orchestration, Action Rules).

Builds on `docs/B10A_PHASE1_PROBLEM_DEFINITION_2026-07-16.md` (Approved, 9.8/10 confidence). Root cause: `naavi-voice-server/src/index.js`'s general (non-location) `SET_ACTION_RULE` handler runs B4y's default-to-self block (`:4725-4739`) *before* F12's named-recipient resolution block (`:4755-4787`), so B4y's assignment satisfies F12's guard condition before F12 ever runs — recipient resolution is skipped every time a name is present.

---

## 1. The fix

Re-reading the live code against Phase 1's two sketched candidates, they collapse into one simple change: **move the B4y block to run after the F12 block. No condition logic changes.**

This works without any new guard condition because of how the two blocks already behave:

- F12's block (`:4755-4787`) only runs when a name (`to`) is present and no destination is resolved yet.
- If it resolves successfully, `to_phone`/`to_email` get set — B4y's existing guard (`!actionConfigNorm.to_phone`) already evaluates false once that's true, so it does not fire.
- If it fails (`ambiguous` / `not_found` / `error`), it already `return`s immediately (`:4782`, `:4786`) — execution never reaches B4y at all.
- If no name was ever present, F12's block is skipped entirely (its own `toNameVoice` guard is false) and B4y's original no-recipient default fires exactly as designed for the genuine self-alert case ("text me... in 3 minutes").

So the diff is a block reorder, not new logic. This satisfies Phase 1's request to check whether a smaller/simpler fix exists than either originally-sketched option implied.

### Grep-audit requested by Phase 1 §6 — completed

Checked every other `to_phone` assignment site in `naavi-voice-server/src/index.js` for the same "default before resolution" pattern:

- `:10148-10158` — the contact-clarification follow-up flow. Sets `to_phone` only from a phone number the user just spoke directly; if none was given, the resolved action re-enters the same `SET_ACTION_RULE` handler above and goes through the (fixed) B4y/F12 order. Not a separate instance of the defect.
- `:11375-11449` — the location-trigger handler. Resolves the named recipient first, with no B4y-style pre-default in front of it; fails closed with spoken feedback (`:11433`, `:11439`) on ambiguous/not_found. Confirmed unaffected, consistent with Phase 1 §2.
- `supabase/functions/evaluate-rules/index.ts:1043` — at fire time, a rule with no `to_phone`/`to_email` errors out rather than defaulting to the user. No equivalent defect here either.

**Conclusion: the general (non-location) `SET_ACTION_RULE` handler at `:4696-4787` is the only call site with this pattern.** No other fix locations required.

---

## 2. A second, related defect found while tracing the failure path — spun out to B10B

While tracing the failure path, `naavi-voice-server/src/action_rule_confirm_gate.js:73-75` (`failSpeechForAction`) was found to always speak a hardcoded message — *"I couldn't set that up — you may already have an identical alert"* — on any post-confirmation failure, written when the only proven failure mode was a duplicate-timestamp conflict (F19 Track B-1e, 2026-07-15). Once B10A's fix makes F12's fail-closed path reachable from this call site, a new failure reason becomes possible (`not_found` / `ambiguous` / `resolve_failed`), and the hardcoded message would tell the user a specific, false reason for the failure — a Rule 18 problem if left as-is.

**Per Wael's review (2026-07-16): this is a different user-facing defect from B10A's recipient-resolution-ordering bug and is tracked separately as its own governance item, not bundled into B10A.** See `docs/B10B_PHASE1_PROBLEM_DEFINITION_2026-07-16.md`. B10A's scope is recipient resolution ordering only.

**Sequencing note:** B10B's fix only becomes user-reachable once B10A's reordering ships (today, F12's fail-closed path here is dead code — B4y always wins first, so `failSpeechForAction` never actually sees a resolution-failure `result.error`). B10B can be written and reviewed independently, but should not be merged/deployed ahead of B10A, or its new branch is unreachable and untestable in production.

---

## 3. The architectural policy decision (per Phase 1 §6 — explicitly not pre-selected there)

F12 was already built fail-closed on 2026-07-06: when a named recipient can't be resolved (ambiguous/not_found/error), the row is never created — this is existing, already-approved design elsewhere in the same file (e.g., the location handler). Reordering the two blocks does not introduce this policy; it removes the accidental bypass that was preventing this already-approved policy from applying to this call site.

The alternative is fail-open: if resolution fails, fall back to texting/messaging the user instead of the named contact. This is not recommended — it is the same silent-misdirection behavior this bug exists to close, and conflicts with Rule 18 (never silently redirect or misrepresent a fact to fit a constraint). B4y's original fail-open intent is preserved for the case it was actually designed for — no name present at all — and only that case, once reordered.

**Decision: fail-closed. Confirmed by Wael, 2026-07-16.** Matches F12's existing precedent; reasoning affirmed — a silent redirect ("Text Bob" actually texting the user) changes user intent without telling them, which is more dangerous than "I couldn't resolve Bob," which is honest.

---

## 4. Files that will change

| File | Classification | Change | Explanation |
|---|---|---|---|
| `naavi-voice-server/src/index.js` | Backend / Shared Logic — **Protected Core** (Action Rules, Voice orchestration) | Move the B4y default-to-self block (`:4696-4739`) to run after the F12 resolution block (`:4755-4787`), within the `SET_ACTION_RULE` case. No condition logic changes. | Restores the intended ordering so F12's already-approved resolution/fail-closed behavior actually runs before any self-default can apply. |
| `tests/catalogue/*.ts` (new or extended, per Rule 15a) | Configuration / Test | Three regression tests: (1) third-party time-trigger SMS naming a real contact resolves to the contact's number, not the user's own; (2) an unresolvable name fails closed (row not created); (3) **"Text me in three minutes" (no named recipient) still defaults to the user's own number** — proves B4y's original purpose survives the reorder. | Mandatory sister rule to Rule 15. Test (3) added per Wael's review — without it, the reorder's effect on the genuine self-alert case is asserted, not proven. |

`naavi-voice-server/src/action_rule_confirm_gate.js` is explicitly **not** in B10A's file list — spun out to B10B (§2).

No other files. No refactoring, renaming, or cleanup beyond these two — per governance Phase 4's No Extra Changes Rule, stated here in advance so Phase 3 has a clean boundary to authorize against.

---

## 5. Risk classification

| Dimension | Rating | Reasoning |
|---|---|---|
| Implementation risk | **Low** | The change is mechanically a block reorder — no new condition logic, no new abstractions. |
| Regression risk | **Medium** | The change site is inside Protected Core (Action Rules, Voice orchestration) — even a small change there carries a higher regression cost than the diff size alone would suggest. |
| Architecture risk | **Low** | No new architecture introduced; this reconciles two existing, already-approved behaviors (B4y's self-default, F12's fail-closed resolution) into their originally-intended order. |

Per Wael's review: rating refined from a blanket "Medium" to this three-way split — the mechanical simplicity of the change shouldn't be lost inside a single risk label, but Protected Core involvement still requires Phase 3 (ChatGPT review) before coding, same as governance §4 mandates regardless of how simple a Protected Core change looks.

---

## 6. Regression impact (explicit answer required for every item, per governance §3)

| Area | Affected? | Explanation |
|---|---|---|
| Voice commands | **Yes, narrowly** | Only the general (non-location) time-trigger `SET_ACTION_RULE` path for `sms`/`whatsapp` naming a third party. Self-alerts ("text me...") unaffected — identical defaulting behavior, just runs later in the function. |
| Geofencing | No | Location-trigger handler (`index.js:11375+`) is a structurally separate code block, untouched by this plan. |
| Gmail integration | No | No shared code path with `SET_ACTION_RULE`'s sms/whatsapp resolution logic. |
| Calendar integration | No | `SET_REMINDER`'s calendar-event creation (`index.js:4834+`) is a separate case block, untouched. |
| Reminders | No | Different case block (`SET_REMINDER`, not `SET_ACTION_RULE`) entirely. |
| SMS / call alerts | **Yes, directly** | Scoped precisely: only third-party SMS/WhatsApp alerts using the general (non-location) `SET_ACTION_RULE` path. Those will now correctly reach the named contact, or fail closed (row not created), instead of silently reaching the user's own phone. Self-alerts, email-trigger alerts, and location-trigger alerts on this same action type are unaffected. |
| Onboarding | No | No onboarding flow calls `SET_ACTION_RULE`. |
| Staging build | **Not applicable in the usual sense — flagged as a known gap** | `naavi-voice-server` is a separate repo/service (Railway, auto-deploys from its own `main`) with no staging tier distinct from production. This is a pre-existing process gap, not introduced or fixable by this plan. Once pushed to that repo's `main`, the change is live. Manual test on a real call is mandatory before that push (governance Phase 7), since there is no staging gate to catch a regression first. |

---

## 7. What alternatives were considered

- **Reorder only (chosen)** vs. **add a guard condition to B4y instead of reordering** (Phase 1's original Option 2) — the guard-condition approach would require B4y's condition to also check `!actionConfigNorm.to`, duplicating knowledge of F12's guard condition in two places that must stay in sync. Reordering achieves the same outcome structurally, with no duplicated condition to maintain. Simpler diff, same effect.
- **Extend the fix to other trigger types (email, calendar, weather, contact_silence)** — not in scope. Phase 1 confirmed those aren't proven to share this defect (no B4y-style pre-default exists for them in the general handler); extending speculatively would violate the No Assumptions Rule.
- **Fix mobile's `useOrchestrator.ts` in the same pass** — not in scope. Unchecked against this defect class per Phase 1 §5; a separate investigation, not assumed broken or safe here.

---

## 8. Scope boundary (stated in advance for Phase 3)

Covers only: (a) the B4y/F12 block reorder in the general `SET_ACTION_RULE` handler, (b) the three regression tests in §4. Does not cover: `failSpeechForAction` (spun out to B10B, §2), location alerts (confirmed unaffected), mobile's equivalent code (unchecked, separate item), other trigger types (unproven, separate item), or any broader recipient-resolution refactor.

---

## 9. Next step

This document covers Phase 2 (Change Planning) only. Phase 3 (Technical Review) is now its own document — `docs/B10A_PHASE3_TECHNICAL_REVIEW_2026-07-16.md` — per Wael's direction (2026-07-16) to keep Phase 2 and Phase 3 as separate artifacts going forward, rather than recording the review inline here as was done as an interim measure.

See that document for the review record, the fail-closed decision's confirmation, the Implementation Boundaries, and Phase 4 readiness.
