# Session Handoff — 2026-07-16 (session 2) — B10a + B10b shipped through full governance lifecycle; serious new defect found in `task_actions` multi-recipient resolution during B10b's own manual test

## ⭐⭐⭐ Next session priority (explicit): new Problem Definition for the `task_actions` recipient-resolution defect

**This is a different, more serious defect than B10a/B10b — real, unsolicited SMS messages were sent to real phone numbers during this session's manual testing.** Start next session here, before anything else.

**What happened, by direct evidence (not yet written up as a formal Phase 1 doc — that's the first job of the next session):**

Wael said (voice, real call): *"send message to abc saying good morning in 3 minutes."* Claude/Naavi parsed "abc" as three separate recipients — initials "A", "B", "C" — and created one `action_rules` row (`id: 2478079b-a286-452c-aa91-d84ce54bc974`, created `2026-07-16T14:49:28Z`) using a `task_actions` array:
```json
{
  "body": "Scheduled sends.",
  "tasks": [],
  "to_phone": "+16137697957",
  "task_actions": [
    {"body": "Good morning", "type": "send_sms", "to_name": "A"},
    {"body": "Good morning", "type": "send_sms", "to_name": "B"},
    {"body": "Good morning", "type": "send_sms", "to_name": "C"}
  ]
}
```
The confirm-gate said "Done" — correctly, for the top-level row (see "Why B10a/B10b are not at fault" below). Two minutes later the rule fired. `supabase/functions/evaluate-rules/index.ts:1074-1103` (function name: the fire-time handler; comment marks it "F5c") resolves each `task_actions` entry's `to_name` via a **separate `lookup-contact` call per name, taking `data.contacts?.[0]` (the first result) with zero ambiguity check, zero confirmation, and zero fail-closed handling** — nothing like F12's `resolve-recipient` (`ambiguous`/`not_found` states) exists in this path at all.

**Result: real "Good morning" SMS messages were sent to three real, unconfirmed phone numbers** (`sent_messages` table, all at `2026-07-16T14:51:0x UTC`):
- `(613) 832-4299` — matched from name-query "A" or similar
- `+13433332567` (Bob — the same test contact used throughout this session, now got a second, unrelated "Good morning")
- `+1 343-575-0023` — matched from another single-letter query
- Plus a "Scheduled sends." confirmation SMS to Wael's own number (`+16137697957`), from the top-level `to_phone` B4y default.

**Why B10a/B10b are not at fault, stated plainly so the next session doesn't waste time re-suspecting them:** B10a/B10b only touch the single top-level `to`/`to_phone` resolution flow inside `naavi-voice-server`'s `executeAction`'s `SET_ACTION_RULE` case. This request had no top-level `to` field at all (the three names live inside `task_actions`, a completely different schema) — so F12's block correctly did nothing (empty `toNameVoice`), and B4y correctly defaulted the top-level `to_phone` to Wael's own number, because from `executeAction`'s perspective there genuinely was no top-level recipient to resolve. That is exactly what B4y is *for*. The `task_actions` array itself is resolved later, at fire time, entirely inside `evaluate-rules` — a code path B10a/B10b's Phase 2 scope and grep-audit never covered (the audit was scoped to `naavi-voice-server/src/index.js`'s `to_phone` assignment sites, not `supabase/functions/evaluate-rules`).

**Open questions for next session's Phase 1 (not yet answered — do not assume):**
- Why did Claude split "abc" into three single-letter recipients "A", "B", "C" instead of treating it as one unresolvable name, or asking for clarification? (Prompt/tool-schema behavior, not yet traced.)
- Is `task_actions` reachable from every trigger type via voice, or only some? (This instance was `trigger_type: 'time'` — F5c's own comment describes it as originating from location alerts: *"auto-send tasks... attached when creating the location alert"* — so its use here, on a time trigger, may itself be an unintended cross-trigger-type reuse worth tracing.)
- Does mobile's `useOrchestrator.ts` have an equivalent `task_actions` creation path, and if so, does it share this same unresolved-recipient gap? (Unchecked — same discipline as B10a/B10b's mobile carve-out: not assumed broken or safe.)
- Does `lookup-contact` itself have a match-quality/length floor, or will it happily fuzzy-match a single letter against a whole contact list? This may be the actual root cause, shared by anything that calls `lookup-contact` with a short/ambiguous query.
- **Real-world follow-up, Wael's call, not investigated or acted on:** three real people just received an unsolicited "Good morning" text from Naavi. Whether/how to acknowledge that to them is a product/communications decision for Wael — no outbound message should be drafted about this without his explicit direction and without first confirming who those three numbers actually belong to.

---

## What closed this session (before the `task_actions` defect was found)

### B10a — closed, all 8 phases, live, verified

Root cause (proven, Phase 1): `naavi-voice-server/src/index.js`'s general (non-location) `SET_ACTION_RULE` handler ran B4y's default-to-self block *before* F12's named-recipient resolution block, so a time-trigger SMS/WhatsApp alert naming a real contact silently redirected to the user's own phone instead of the named contact.

Fix (Phase 4): reordered the two blocks — F12's resolution now runs first; B4y's self-default only fires if no name was ever present. No condition logic changed, only execution order. Pushed to `naavi-voice-server` `main`, commit `5e81e76`.

Manual test (Phase 7, real production calls): all three scenarios passed — "Text Bob" correctly reached Bob's real number (both SMS + WhatsApp, correct third-party fan-out); "Text me" still self-defaults; an unresolvable name failed closed (no row created). One unexplained detail: test #1 needed "two repetitions" during the call, but produced no duplicate/wrong row — likely the pre-existing, already-tracked STT/barge-in issue, not a B10a regression. Not investigated further this session.

Full governance chain, all in `docs/`: `B10A_PHASE1_PROBLEM_DEFINITION_2026-07-16.md` → `B10A_PHASE2_CHANGE_PLAN_2026-07-16.md` → `B10A_PHASE3_TECHNICAL_REVIEW_2026-07-16.md` → `B10A_PHASE5_EVIDENCE_2026-07-16.md` → `B10A_PHASE6_TECHNICAL_REVIEW_2026-07-16.md` (§9 records closure).

### B10b — code shipped and live; Phase 7 manual validation still unconfirmed

Root cause (proven, Phase 1): `naavi-voice-server/src/action_rule_confirm_gate.js`'s `failSpeechForAction` always spoke a hardcoded duplicate-alert message on any post-confirmation failure — inaccurate once B10a made F12's fail-closed resolution errors reachable from this call site for the first time.

Fix (Phase 4): `failSpeechForAction` now branches on `result.error` — specific messages for `ambiguous` and `not_found`/`invalid`/`resolve_failed`, falling back to the original message unchanged when `error` is absent (the duplicate-conflict case). Pushed to `naavi-voice-server` `main`, commit `e03b976`.

**Important, do not overstate this as verified:** the manual test intended to confirm B10b's new spoken message live never actually exercised it — Wael's test phrase ("send message to abc...") got routed through the unrelated `task_actions` path described above, not the single-recipient path B10b fixed. **B10b's Phase 7 manual validation is still outstanding.** To actually test it: trigger a time-trigger SMS/WhatsApp naming a single contact that doesn't exist or is ambiguous (e.g., "Text Xyzabc... in 3 minutes" — a name shaped like one person, not multiple initials), confirm with "yes," and confirm the spoken message names the contact problem specifically instead of "you may already have an identical alert."

Full governance chain, all in `docs/`: `B10B_PHASE1_PROBLEM_DEFINITION_2026-07-16.md` → `B10B_PHASE2_CHANGE_PLAN_2026-07-16.md` → `B10B_PHASE3_TECHNICAL_REVIEW_2026-07-16.md` → `B10B_PHASE5_EVIDENCE_2026-07-16.md` → `B10B_PHASE6_TECHNICAL_REVIEW_2026-07-16.md`.

---

## Governance process note (applies to both B10a and B10b, and should carry forward)

This session ran the full 8-phase governance workflow twice, end to end, with a strict phase-gate discipline enforced by Wael mid-session after an initial slip:

- Each phase produced its own separate document (Phase 1, Phase 2, Phase 3, Phase 5, Phase 6 — Phase 2 and Phase 3 were initially conflated into one document for B10a before Wael corrected this; every ticket since has kept them separate from the start).
- **No phase was started before the prior phase's document received Wael's explicit comments/approval.** Early in B10b, Claude jumped from "yes, move to B10B" straight into drafting Phase 2 without pausing for Phase 1 approval — caught and corrected by Wael; the rule going forward: Phase 1 → comments → approval → Phase 2 → comments → approval → Phase 3, no exceptions, for every future ticket.
- Phase 3 and Phase 6 (both "ChatGPT reviews," per governance) were, in both tickets, drafted by Claude first (covering every required review component) and then reviewed/approved by Wael relaying ChatGPT's critique — mirroring how Phase 2 (drafted by Claude) becomes Phase 3 once reviewed.
- Every review round produced concrete, adopted edits (wording precision, risk-classification splits, added regression tests, scope splits) — none of this session's reviews were rubber-stamps.

---

## What did NOT happen this session

- The `task_actions` defect has **no Problem Definition document yet** — this session only gathered evidence in conversation; writing it up as a proper Phase 1 doc is the next session's first task.
- B10b's actual live manual test (hearing the new spoken failure message) was never performed — see above.
- No fix, code change, or message was sent regarding the `task_actions` defect — investigation stopped at evidence-gathering per Wael's instruction to close the session here.
- Whether real people who received the unsolicited "A"/"B"/"C" texts should be contacted/acknowledged — not decided, not actioned.
- Mobile's `useOrchestrator.ts` — still not checked against either B10a's, B10b's, or the new `task_actions` defect class. Three separate open questions about mobile, not assumptions in any direction.
- `git commit`/`git push` in the main `naavi-app` repo — **not done.** `tests/runner.ts` (modified) and the two new test files (`tests/catalogue/session-2026-07-16-b10a-recipient-order.ts`, `tests/catalogue/session-2026-07-16-b10b-fail-speech.ts`) are uncommitted, along with all the new `docs/B10A_*`, `docs/B10B_*` files and a large pre-existing backlog of untracked `docs/*` files from prior sessions (this appears to be the established pattern in this repo — documentation files are routinely left untracked; confirm with Wael before assuming this needs to change). Per standing rule, commits only happen when explicitly requested.

---

## State at handoff

| Item | Status |
|---|---|
| B10a | **Closed** — all 8 phases, pushed live (`naavi-voice-server` commit `5e81e76`), manually verified on 3 real-call scenarios |
| B10b | **Code shipped and live** (`naavi-voice-server` commit `e03b976`) — governance phases 1-6 done and approved; **Phase 7 manual validation still outstanding** |
| `task_actions` recipient-resolution defect | **New, not yet triaged as a formal ticket** — real messages sent to unconfirmed real numbers; top priority for next session |
| Main repo (`naavi-app`) commits | **Not done** — `tests/runner.ts` + 2 new test files + all new `docs/B10A_*`/`docs/B10B_*` docs are uncommitted |
| `naavi-voice-server` commits | Done — both `5e81e76` and `e03b976` pushed to `origin/main` |

---

## Documents produced this session (all in `docs/`, none yet committed)

`B10A_PHASE1_PROBLEM_DEFINITION_2026-07-16.md` (from prior session, reviewed further this session), `B10A_PHASE2_CHANGE_PLAN_2026-07-16.md`, `B10A_PHASE3_TECHNICAL_REVIEW_2026-07-16.md`, `B10A_PHASE5_EVIDENCE_2026-07-16.md`, `B10A_PHASE6_TECHNICAL_REVIEW_2026-07-16.md`, `B10B_PHASE1_PROBLEM_DEFINITION_2026-07-16.md`, `B10B_PHASE2_CHANGE_PLAN_2026-07-16.md`, `B10B_PHASE3_TECHNICAL_REVIEW_2026-07-16.md`, `B10B_PHASE5_EVIDENCE_2026-07-16.md`, `B10B_PHASE6_TECHNICAL_REVIEW_2026-07-16.md`. Code: `naavi-voice-server/src/index.js` (B10a reorder), `naavi-voice-server/src/action_rule_confirm_gate.js` (B10b rewrite), `tests/catalogue/session-2026-07-16-b10a-recipient-order.ts` (new), `tests/catalogue/session-2026-07-16-b10b-fail-speech.ts` (new), `tests/runner.ts` (2 registrations).

## Groundwork already done — don't re-derive

- **`tests/.env` has real production credentials** (confirmed again this session) — direct `curl` queries against `action_rules` and `sent_messages` via the Supabase REST API (using `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from that file) were how every claim in this handoff about what actually got sent/created was verified. No Railway CLI is available in this environment (`railway` command not found) — use direct DB queries instead of trying to pull Railway logs for this kind of verification.
- **`naavi-voice-server` is its own separate git repo**, not covered by the main repo's `git status`/`git diff` — always `cd naavi-voice-server` first for any git operation there.
- **Full auto-tester run this session: 426 tests, 421 passed, 0 failed.** The 3 errored tests are pre-existing and unrelated to anything touched this session (stale prompt-version strings on `b6d.prompt-version-bumped-to-v98` and `session-2026-05-28.b6d-prompt-version-v100`; a wording mismatch on `f10a.website-nav-feedback-link-homepage-only`). 2 pre-existing skips (Google OAuth not connected for the *test* user specifically).
- **The `task_actions` fire-time resolution code** lives in `supabase/functions/evaluate-rules/index.ts:1064-1103`, function-internal comment tag "F5c." It accepts both `task_actions` (canonical key) and `tasks` (a key Claude sometimes uses instead) — both were present (empty `tasks: []`, populated `task_actions`) on the row this session produced.
- **Bob (test contact)** has one real card: name "Bob," phone `+13433332567`, email `aggan2207@gmail.com` — confirmed again this session (Bob received messages in both the B10a test and, unrelated, in this new `task_actions` incident).
