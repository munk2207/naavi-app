# Session Handoff — 2026-07-21

**Read this first, then `MEMORY.md`'s index.**

---

## Closed this session

### B10o + B10p — CLOSED, shipped, manually confirmed on build 313

Location-alert confirmation now correctly names the self-task ("feed the cat") alongside the third-party message (B10o), and renders as a numbered list when it carries 2+ facts (B10p). Full Phase 1-8 governed cycle for both, all externally reviewed and Approved.

**Real defect found and fixed during Phase 7 manual testing, same cycle:** the first shipped fix (build 312) didn't apply to the actual live scenario — for a compound self+third-party request, `get-naavi-prompt`'s LOCATION SELF-ALERT PRIMARY RULE puts the self-task text in `action_config.body`, not `.tasks`; `formatSelfTaskClause` never read `.body`. Fixed same day (commit `11ca55c`), confirmed on build 313 with real delivery evidence — Bob's SMS and the self-alert (SMS/WhatsApp/voice) all correct in `sent_messages`.

**Not completed before closure, closed anyway on Wael's explicit call:** by-ear TTS check of the numbered confirmation speech, and spot-checks of the reactivated/re-arm alert paths specifically.

Full doc trail: `docs/B10O_PHASE1_PROBLEM_DEFINITION_2026-07-21.md` through `docs/B10O_PHASE6_TECHNICAL_REVIEW_2026-07-21.md`, `docs/B10P_PHASE1_PROBLEM_DEFINITION_2026-07-21.md` through `docs/B10P_PHASE6_TECHNICAL_REVIEW_2026-07-21.md`.

### F19 Track C — CLOSED

Mobile production promotion completed: production AAB (build 311) built and submitted, plus the three Edge Functions it depended on (`naavi-chat`, `evaluate-rules`, `report-location-event`) deployed to production — closing a real gap where the shipped mobile app was assuming a server-side fix (B10g/B10h/B10j) that was never actually promoted past staging. Verified live: the exact B10j bug reproduced on production before the fix, then confirmed fixed 3/3 after.

### Governance — bumped to v3.6

Added the **Invalidated Planning Assumption Rule** to Phase 6: when Phase 4 implementation finds a Phase 2 plan can't be carried out exactly as written, without that being an implementation error, Phase 6 must record it as an invalidated planning assumption — distinct from an omitted feature or a deliberate scope cut. Originating example: B10o's Deviation #2 (task_actions merging on the 2 merge-into-existing-alert sites, walked back during implementation).

---

## ⭐⭐⭐ NEXT SESSION — start with B10q, then B10r

Both are top of the priority queue in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, ahead of B10m/B4b, per Wael's explicit instruction. **Neither has a Phase 1 written yet.**

### B10q — email-trigger alert fires on every incoming email, not just one sender

Root cause confirmed: `evaluate-rules/index.ts:285-303`'s matching logic treats an absent `from_name`/`from_email`/`subject_keyword` as "match anything," not "match nothing." The "at least one field required" check only exists in the chat classifier (`naavi-chat/index.ts:1848-1853`) — the actual DB write path (`manage-rules`) has zero server-side validation. Symptom that surfaced it: a live fired alert's notification read "Naavi: You received an email from someone." (the `'someone'` fallback at `evaluate-rules/index.ts:744`).

**Fix direction discussed, not formalized:** (1) move/duplicate the validation to `manage-rules`, the single write chokepoint; (2) one-time query to find and disable any already-enabled email rules with all three fields empty — the already-broken rule causing the "someone" notification is likely still live right now.

### B10r — birthday/anniversary shows a computed future year instead of the real one

Root cause confirmed via live evidence: Fatma Elmehelmy's real Google Contact shows birthday Jan 15 **1948**, anniversary Dec 8 **1982** — Naavi's "Tell me about Fatma" answer showed "Jan 15, **2027**" / "Dec 8, **2026**". Month/day correct; year is Google Calendar's computed next-occurrence of the auto-generated "Contacts' birthdays" calendar, displayed with no indication it's recurring. Exact misleading phrasing is taught by `get-naavi-prompt/index.ts:565`'s own worked example.

**Fix direction, revised mid-discussion:** don't patch the Calendar adapter's output — extend the Contacts adapter (`global-search/adapters/contacts.ts:146`, `lookup-contact/index.ts`) to request the `birthdays` personField directly from Google People API (neither currently requests it). More reliable than the Calendar path, which silently breaks if the user disables "populate calendar from contacts." Connects to CLAUDE.md Rule 18.

Full detail for both: `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, priority queue items 0a/0b, and Bugs table rows B10q/B10r.

---

## Other open threads, not yet started, no ID assigned to the first one

- **List-attachment bug (no ID yet)** — a real list ("shopping") can exist and never get attached to its alert. Found via screenshots mid-session. Different root cause from B10o (attachment/matching logic, not readback text) — kept deliberately separate.
- **I4b — SMS/Email sender-framing gap, mid-investigation.** Confirmed real for SMS and Email via the `task_actions` mechanism (`_shared/task_actions.ts`): SMS sends bare body with zero framing (`send-sms/index.ts:136-139`); Email has a subject-line hint ("Message from Robert") but the body itself is equally bare. WhatsApp already has full sender framing via an approved Twilio template, but **only confirmed for self-alerts (B9k)** — never confirmed for a genuine third party via any code path actually traced. **Open question, not resolved:** is there a separate top-level third-party WhatsApp path (when a third party is the alert's sole primary recipient, not a `task_actions` side-send) that behaves differently? Not yet checked.
- **F20 — MAKE_CALL mobile confirm card.** Scoped, design decided (Option 2 — UI wrapper on the existing proven "say yes" text loop), governance waived. No code written.
- **YouTube demo doc** (`docs/YOUTUBE_TOP5_DEMOS_2026-07-20.md`) — Demo 1 fully scripted and validated with real live evidence (including the exact B10o/B10p confirmation text). Demos 2-5 scripted with researched phrasings, not live-tested.

---

## Process/tooling fixes shipped this session

- `tests/runner.ts` now prints a loud environment banner (`STAGING`/`PRODUCTION`/`UNKNOWN`) at the top of every `test:auto` run — this would have caught the F19 Track C environment gap immediately instead of by accident. See CLAUDE.md's new **CROSS-CUTTING CHANGE PARITY CHECK** rule.
- New memory: `feedback_verify_test_env_before_trusting_gate` — never trust a green test run without checking which environment it actually hit.
- New memory: `feedback_batch_apk_builds` — Wael batches multiple fixes before triggering a new APK build; never build without asking first, even for staging/Phase 7 validation.

## Housekeeping

All doc/code work from this session is committed and pushed to `main` (commits `1d12f67` through `56ca7f9`). A handful of pre-existing, unrelated modified files (3 screenshot PNGs, `.claude/settings.local.json`, `docs/.obsidian/workspace.json`, a one-line `get-naavi-prompt` version-label mismatch) remain uncommitted, untouched by this session — explicitly left alone per Wael's instruction, not cleaned up.
