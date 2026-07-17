# F5c — Phase 6: Technical Review (After Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 6. Drafted by Claude, covering all six required review components, as the material for the External Technical Reviewer (ChatGPT, via Wael) to render a verdict against — same relationship as Phase 2 (drafted by Claude) → Phase 3 (reviewed by ChatGPT). This document is not itself the reviewer's verdict; §7 is left open for that.

Subject: the implementation completed in `docs/F5C_PHASE5_EVIDENCE_2026-07-17.md`, against the Implementation Boundaries confirmed in `docs/F5C_PHASE3_TECHNICAL_REVIEW_2026-07-17.md` §2.

---

## 1. The Git Diff

Full diff reproduced in `docs/F5C_PHASE5_EVIDENCE_2026-07-17.md` ("Git diff" section). Summary: inside `evaluate-rules/index.ts`'s F5c block, three changes — (a) a `to_name.trim().length < 2` guard added before the `lookup-contact` fetch; (b) the unconditional `const best = data.contacts?.[0]; if (best) {...}` replaced with `if (matches.length === 1) { const best = matches[0]; ... }`; (c) a `console.warn` added at the pre-existing `return null` fallback in `taskSends`. Every other statement in the block (the `fetch` calls, the `send_sms`/`send_email` execution branches, `Promise.allSettled`) is byte-identical before and after — confirmed by direct diff read, not inferred.

---

## 2. Changed files

| File | Repo | Nature of change |
|---|---|---|
| `supabase/functions/evaluate-rules/index.ts` | `munk2207/naavi-app` | F5c block only, +19/-2 lines. |
| `tests/catalogue/session-2026-07-17-f5c-taskactions-resolution.ts` | `munk2207/naavi-app` | New file, 5 tests. |
| `tests/runner.ts` | `munk2207/naavi-app` | Import + registration, 2 lines. |

Matches the Implementation Boundaries exactly — no file outside this list was touched. `lookup-contact/index.ts`, `naavi-chat/index.ts`, and `naavi-voice-server/src/index.js` remain untouched, per Phase 2 §5's explicit deferrals.

---

## 3. Architecture impact

None. No new function, module, abstraction, or data flow was introduced. The change alters decision logic inside an existing caller (`evaluate-rules`'s F5c block) only — it does not modify `lookup-contact`'s own matching/search/sort algorithm (the exact-first-name filter, the community sort, or the underlying Google `searchContacts` call), consistent with the "Implementation philosophy" stated in `docs/F5C_PHASE2_CHANGE_PLAN_2026-07-17.md` §2 and confirmed here by direct diff read: `lookup-contact/index.ts` does not appear in the diff at all.

---

## 4. Regression risk

Per `docs/F5C_PHASE3_TECHNICAL_REVIEW_2026-07-17.md` §2's classification (reaffirmed): High, driven by Protected Core membership rather than diff size. Concretely bounded by:

- **The change is a strict tightening** — it can only cause a `task_action` that used to send to now not send; it introduces no new way to send to a wrong recipient. This asymmetry was established in `docs/F5C_PHASE2_CHANGE_PLAN_2026-07-17.md` §4 and is unchanged by implementation.
- **The two mechanisms carry unequal risk, by design.** (b), the exact-match-count check, can only withhold a send that was already a guess (0 or 2+ real matches) — never a case the prior code was getting right. (a), the length guard, is the only piece that could theoretically reject a currently-legitimate short name; no evidence exists today of any real contact identified by a 1-character name (Phase 1 §2.3's live data).
- **Regression test proving adjacent logic survives:** `f5c.primary-alert-fanout-unaffected` asserts the primary self/third-party alert fan-out logic (outside the F5c block) still runs first, unchanged — the ordering guarantee stated in the block's own pre-existing comment ("Runs after the main notification so the primary alert always fires first") is not disturbed.
- **No change to `SET_REMINDER`, mobile's `naavi-chat.ts`, or voice's `index.js`** — confirmed by the diff itself (single file, single block) and by Phase 2 §5's explicit scope boundary.

---

## 5. Isolation

**Confirmed by direct code read, not assumed:** the F5c block (`evaluate-rules/index.ts`, inside `fireAction()`) is reached for every `action_rules` row that carries a non-empty `task_actions`/`tasks` array, regardless of `trigger_type` — confirmed live in production data (Phase 1 §2.1): both a `time`-trigger rule (the incident) and `location`-trigger rules (e.g. "Call Natalie," "message Wael," found in the same diagnostic pull) carry `task_actions` and pass through this same block.

**What this means, stated plainly:**
- The fix protects `task_actions` resolution for **every trigger type**, not only the `time`-trigger shape the incident happened to reproduce — this was the intended scope per Phase 1 §5 ("the single code path every `task_actions` entry from either surface... ultimately passes through") and is confirmed, not just assumed, by this diff touching the shared block rather than a trigger-specific branch.
- The primary self/third-party alert fan-out (the code above this block, same function) is a separate code path entirely — confirmed unaffected by direct read (§4 above), not merely by proximity.
- Voice-originated and mobile-originated `task_actions` both reach this exact block with equal force, since neither surface performs any equivalent check before this point that this fix would duplicate or conflict with (Phase 1 §2.5: voice does no write-time resolution at all; mobile's `naavi-chat.ts` only resolves the first entry, leaving any additional entries to reach this same fire-time code unresolved, same as before).
- **Reminders are structurally isolated** — the `reminders` table and `check-reminders` Edge Function are a separate code path (`CLAUDE.md`'s Rule Store section), not reachable through `evaluate-rules` at all.

---

## 6. Test coverage

`npm run test:auto` — 431 tests, 426 passed, 0 failed, 3 errored (pre-existing, unrelated — 2 stale prompt-version strings, 1 website-nav wording mismatch, all pre-dating this session's changes), 2 skipped (pre-existing OAuth-not-connected skips, unrelated).

Five new tests, all passing, each mapped to a specific claim:
- `f5c.name-too-short-guard-precedes-lookup-fetch` → proves the defense-in-depth guard exists and runs first.
- `f5c.exact-match-count-required-not-unconditional-index-zero` → proves the correctness guarantee is in place AND the old unsafe pattern is gone (positive + negative control in one test).
- `f5c.ambiguous-and-zero-match-log-distinct-reasons` → proves the two ambiguity outcomes are distinguishable in logs.
- `f5c.unresolved-task-action-no-longer-silently-dropped` → proves the prior silent-failure gap (Rule 21) is closed.
- `f5c.primary-alert-fanout-unaffected` → proves the adjacent, unrelated logic is untouched (regression guard).

**Coverage gap, stated plainly (not hidden):** these are source-assertion tests (confirm the fix is shaped correctly in the source), not live end-to-end calls against real Twilio/Supabase/Google Contacts. `docs/F5C_PHASE5_EVIDENCE_2026-07-17.md`'s "Summary" does include one code-level simulation applying the new decision logic to real, same-day `lookup-contact` API data (confirming "A"/"B"/"C" would all now be skipped) — but this is not a deployed re-fire through `evaluate-rules` itself. **Nothing has been deployed anywhere yet.** The three manual tests listed in Phase 5 (re-create the incident shape live; confirm the safe single-match path still sends; confirm primary-alert ordering is preserved live) are explicitly marked mandatory for this Phase 6's approval to convert into an operationally-verified change — per Phase 5's own review record, listing them is not the same as having run them.

---

## 7. Reviewer verdict

Technical review based on ChatGPT's review, documented by Wael.

**Verdict: Approved.** The implementation faithfully matches the Phase 3 authorization, remains within the approved implementation boundaries, introduces no unauthorized architectural changes, and provides appropriate automated regression coverage. The remaining identified gap is operational rather than technical: the mandatory staging deployment and manual validation described in Phase 5 have not yet been completed. This implementation is therefore approved from a technical review standpoint and is authorized to proceed to staging validation. Production deployment should occur only after successful completion of those manual verification steps.

**This distinguishes two separate decisions, not one:** implementation approval (granted here) and deployment/production approval (contingent, not yet granted). **Approved from a technical implementation perspective. Production approval remains contingent on successful completion of the mandatory staging/manual validation described in Phase 5.**

**Governance checklist, per the reviewer's final assessment:**
- Phase 1 proved the defect.
- Phase 2 defined the solution.
- Phase 3 constrained implementation.
- Phase 4 implemented only the approved changes.
- Phase 5 demonstrated implementation evidence.
- Phase 6 confirmed architectural compliance and documented remaining operational validation.

**Final Verdict: APPROVED (Technical Review).** The implementation is technically sound and consistent with the approved design. The next milestone is staging deployment and completion of the required manual validation before any production promotion.

---

## 8. Outcome

**Phase 6 closed — APPROVED (Technical Review only).** This is not production authorization. Per governance §8 (Approval Philosophy), this is the reviewer's recommendation, not final authorization — and per §7 above, it is explicitly scoped to the implementation, not to deployment.

**Next, in order, none started:**
1. Deploy `evaluate-rules` to **staging** (`xugvnfudofuskxoknhve`) — per `CLAUDE.md`'s STAGING-FIRST rule, production is not touched until staging is verified.
2. Run the three mandatory manual tests from `docs/F5C_PHASE5_EVIDENCE_2026-07-17.md` against staging.
3. Only after all three pass, and only on Wael's explicit instruction to promote, deploy to production (`hhgyppbxgmjrwdpdubcx`).

---

## 9. Addendum — 2026-07-17 (later session): closure decision on manual test #3

Step 1 above completed — deployed to staging, confirmed success. Step 2: **tests 1 and 2 of Phase 5's three mandatory manual tests passed live** (safe single-match path sends correctly, confirmed via `sent_messages`; primary self-alert fires regardless of task_action outcome, confirmed partially/by coincidence — see the session handoff for detail). **Test 3 — a genuinely ambiguous name reaching fire time and being refused — was never achieved live**, across three attempts in the prior session and further analysis in this one.

**Why it wasn't pursued further:** reaching the exact condition Test 3 needs (an ambiguous `to_name` surviving all write-time resolution to arrive at `evaluate-rules` fully unresolved) turned out to require deliberately routing around two separate write-time contact-resolution code paths inside `naavi-chat/index.ts` (a first-task-action-only resolver at Turn 1/Turn 2, and a full-loop resolver in Step 1.4's `SET_ACTION_RULE` handler) — neither of which behaves consistently enough, on direct code inspection, to guarantee which one runs for a given message shape. The only reliable way found to manufacture the condition was an artificial message ("text Bob good morning, and text Sarah good morning too" — Bob first, ambiguous name second, exploiting a first-entry-only resolution gap) that does not reflect how a real user phrases a request. **Wael's explicit call: reject this as testing a contrived code-path ordering trick, not real user behavior — do not manufacture the scenario.**

**Closure basis accepted instead:** `F5C_PHASE5_EVIDENCE_2026-07-17.md` §"Summary" already simulated the fix's decision logic against the **real `lookup-contact` API data pulled during the original Phase 1 investigation of the 2026-07-16 incident** — confirming the exact real inputs that caused the incident ("A"/"B"/"C") would now be blocked (`ambiguous_multiple_matches`/`zero_matches`), not just a synthetic equivalent. Combined with 8 passing automated tests (source-level proof the guard code is shaped correctly) and the 2 live manual passes above (proof the safe path and primary fan-out are unaffected), this is accepted as sufficient evidence without a live Test 3.

**Decision: F5c closed on this evidence.** Recorded in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`'s F5c entry. Still outstanding, both requiring Wael's own separate explicit go-ahead (not implied by the closure decision): (a) committing the uncommitted code/tests/docs, (b) promoting to production.

**Found during this scoping work, spun out as its own item:** [[B10g]] in the holding list — `task_actions` on **location**-triggered alerts appear to never execute at all (a different, higher-severity bug: zero-recipient indefinitely, not wrong-recipient). Root cause traced via direct code read across all four location-alert-execution files; not yet live-confirmed, no Phase 1 opened.

Nothing in this Outcome authorizes starting step 1 — per the standing rule (`feedback_governance_phase_gate_wait`), that requires its own separate go from Wael.
