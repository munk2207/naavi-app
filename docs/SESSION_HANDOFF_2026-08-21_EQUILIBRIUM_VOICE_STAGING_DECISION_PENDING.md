# Session handoff — 2026-08-21

**The one thing to read first:** Wael has provisionally decided to **cancel voice staging** and run
voice on production only. He has not given the final go, and one question is unanswered. Nothing has
been deleted. See §1.

---

## 1. ⭐⭐⭐ THE OPEN DECISION — cancel voice staging

**Wael's words:** *"revert back to the Voice on production only and cancel voice staging."*

**Why he reached it, and the reasoning is his, not a summary of mine:** two environments only have
value if you can start from a state where they are equal — change staging, test, promote, return to
equal. He calls that **equilibrium**. If you cannot start there, staging is not a rehearsal of
production; it is a second system, and *"validated on staging"* means nothing about production.

**The measurement that triggered it.** Of the **32 Edge Functions the voice server calls**, comparing
deployed content hashes between the two Supabase projects:

| | |
|---|---|
| identical deployed code | 11 |
| **different** | **20** |
| **missing on production** | **1** (`receive-demo-sms-reply`) |

**Not equilibrium, and bidirectional** — production is ahead on two (`create-calendar-event`
timezone support, `ingest-note` dedup), staging on thirteen. Neither is a superset.

**Scope if he proceeds** (corrected by Wael — an earlier draft of this list was wrong):

1. Railway service `naavi-voice-staging` — delete
2. Twilio `+1 343 504 1572` — release (**irreversible**)
3. Branch `staging` in `naavi-voice-server` — **UNANSWERED: keep as history, or delete?**

**Explicitly NOT in scope**, per Wael: `generous-tenderness` and `+1 873 446 2284` (demo staging —
it predates voice staging and is unrelated), the staging Supabase project, mobile staging.

**Consequence if executed:** `main` becomes the only voice branch, so every change goes straight to
the branch Railway auto-deploys to production. The `no-undef` pre-push hook becomes the last check
before a live caller.

**Do not re-argue this in the next session.** Claude argued against it twice; Wael corrected both
attempts on the facts, and correctly. Ask for the branch decision and execute.

---

## 2. What the voice gap actually is, if he reverses

**16 deploys of already-shared source.** No code changes, no migrations — both projects deploy from
the same repo; the difference is *which commit* each got. Roughly an hour.

| Direction | Count | Notes |
|---|---|---|
| Staging ahead → deploy to production | 13 | incl. `save-hosted-reply`, `save-to-drive`, `send-email` |
| Production ahead → deploy to staging | 2 | `create-calendar-event`, `ingest-note` |
| Missing on production | 1 | `receive-demo-sms-reply` |
| **Leave alone** | 3 | `send-sms`, `send-user-email`, `send-push-notification` — differ ONLY by the T2 outbound guard, which is **staging-only by design and must never reach production** |
| Nothing to do | 3 | `manage-list`, `resolve-place`, `search-google-drive` — same source, different deploy date |

**⚠ Inside that list is a live production defect, independent of the parity question:**
`fetch-calendar-pdf` on production was deployed **2026-04-25**, four days before commit `22ca8f1`
(*"multi-user safety: remove user_tokens fallback from 4 Edge Functions"*). **Production still
carries the `user_tokens` fallback CLAUDE.md Rule 4 forbids** — the Hussein-bug pattern.
`search-knowledge` deployed the same day as that commit; which side of it it fell was not
established.

---

## 3. Completed this session

**Voice production caught up to staging on code.** `src/` and `test/` are now byte-identical on both
branches.

- **S1 promoted to voice production** — three `user_settings` columns + `record_voice_pin_failure`,
  then `manage-voice-pin` v19→v20 and `receive-sms-reply` v11→v12, then 22 commits of voice code.
  **The Edge Function half was nearly missed**: S1's logic lives in Shared Core, so grepping the
  voice server for its identifiers returns nothing *on either branch*.
- **B11f — Phases 0–8 complete, promoted to production.** ⚠ **A plain merge would have shipped a
  broken production**: `main` held the revert, Phase 4 had only touched some files, so git would
  have left `pauseCommand.js` missing while `index.js` called `isPauseCommand()` twice — the exact
  failure that caused the 19 August revert. Correct sequence: revert the hold commit, *then* merge.
  **Production no longer has barge-in**: any word used to interrupt Naavi; now only a recognised
  pause word does. Wael weighed that and approved it.
- **T4 CLOSED** — T5 closed (12 NOT NULL constraints on production, zero blocking rows), production
  fingerprint recaptured (83 → 67 → 66), push notifications validated on a real device.
- **T7 triaged in full** — of 40 items, exactly one was worth promoting:
  `sync-active-email-alerts` + its 5-minute cron. Email alerts on production had been waiting up to
  30 minutes.
- **T6 closed**, superseded by T8. It guarded 12 rows of sandbox data under a user id that does not
  exist.
- **T8 — Epic disconnected, marked, kept.** It was NOT dormant: `getEpicHealthContext()` ran on
  every chat turn against five permanently-empty tables. No UI, three empty Edge Function folders.
- **T9 — Azure voice enrolment retired.** Reachable by saying *"set up my voice ID"* on the
  production line, ran a three-step enrolment, and the database silently discarded the result.
- **Governance v4.1** — Wael's Reviewer Response Format Rule.
- **Architecture Reference → 2026.07.18.8** — §0d (a feature is not one deployable thing), §3
  rewritten (interruption is now three designs, not one).

**Two live production bugs fixed:**

- **`knowledge_fragments.updated_at`** — missing on production, so `ingest-note`'s UPDATE path
  failed with 42703. **Every correction to an existing memory had been silently lost since 13
  August.** New memories saved fine; corrections did not.
- **`twilio_from_number`** — applied before it fired. The next deploy of `evaluate-rules` or
  `check-reminders` would have stopped **every alert and reminder**, silently.

**Morning calls: two → one.** Two production accounts hold `+1 343 333 2567`; morning call disabled
on the auto-tester account. **No phone number was removed** — a shared number is legitimate, and
[[S2]] is the real fix.

---

## 4. New gate built — and it found three defects on its first run

`scripts/schema-code-check.js`, wired into `.githooks/pre-push` and `npm run schema:check`.

**Why:** the drift check compares the two **databases** to each other. Nothing compared either to the
**code**. It resolves 1,552 column references across 160 files and fails on NEW mismatches; the
inherited backlog is in `docs/schema_code_known_findings.json`.

**Its first proper run found three, all open as [[T10]]:**

1. **`naavi-chat:4569`** filters `pending_actions` on `expires_at` — **a column that exists on
   neither environment.** *"Retrieve any stored pending actions from a previous clarification turn"*
   always returns nothing. **Multi-turn clarification cannot resume and never could.**
2. `analyze-ticket:134` selects `recipient, status` from `sent_messages`; the real columns are
   `to_name`/`to_email`/`to_phone` and `delivery_status`.
3. `check-ticket-replies:85` filters `user_tokens` on `email`, which it has not got.

**Nothing was deleted.** Wael: *"I do not like to delete anything, because we do not know
everything."* Both dead clarification paths carry explanatory comments instead — including a **DO NOT
DROP THE TABLE** warning, because `pending_actions` is live: the voice server writes
`conversation_labeling` rows to it so recorded calls can have speakers labelled.

---

## 5. Open items

| Item | State |
|---|---|
| **Voice staging cancellation** | **Wael's decision — branch question unanswered** |
| `fetch-calendar-pdf` multi-user fallback | live on production since April |
| **T10** | 3 schema/code defects, one breaking multi-turn clarification |
| **T11** | production `send-sms` will send a real SMS to an anon-key caller, unattributed |
| **T7** | 28 remaining, all triaged as do-not-promote |
| **S2** | the PIN-as-private-ID design (Wael's) |
| **B11i** | push registration never re-runs when permission is granted; 17 dead tokens |
| Mobile AAB | production 1.0.325 vs staging 1.0.327 — the gap is S1's mobile half, so **S1 is dormant on production**: the server requires 6 digits, the shipped app sends 4 |

**Gate status for a production AAB:** auto-tester ran against staging (517 passed / 0 failed / 1
errored — that error is the false positive since fixed); voice regression 133/133; **Firebase Test
Lab not run.**

---

## 6. ⭐ Read this before trusting an assessment in the next session

Wael asked, directly: *"How can I trust your coming assessment?"* It was a fair question.

**Claude's assessments were wrong repeatedly this session**, and the corrections came from Wael or
from a measurement — never from Claude reasoning harder:

- *"Voice staging and production are functionally identical"* — had checked only the voice repo, not
  the 32 Edge Functions the voice server calls.
- **The parity task list given hours earlier was incomplete**, and was presented as complete. That
  is what produced the whole equilibrium discussion.
- *"Both pending tables are dead"* → `pending_actions` is live. *"Superseded by V282"* → true of one
  consumer, not the table. **Recommended dropping a table the voice server actively writes to.**
- *"Railway does not reliably auto-deploy"* — had checked build logs seconds after pushing. Retracted
  in the Architecture Reference.
- Reported that new tests had not run — they had; the output had been piped through `tail -60`.
- **Fourth violation of the phase-gate rule** (2026-07-15, 07-17, 08-15, and this one), against three
  escalating written rules and zero mechanical enforcement.

**The pattern:** each was a partial truth treated as complete. Reading enough to form a confident
picture, and stopping there.

**What worked instead — every time:** running the check. The drift check refused a push when schemas
separated. The schema/code gate caught its own cry-wolf bug. The merge dry-run caught a broken
production before it shipped. The environment banner proved the test run targeted staging.

**So: do not accept "we are at equilibrium" — or any parity claim — as an assessment.** The proposed
answer, not built, is a check that compares deployed Edge Function hashes between projects, records
deliberate differences as a baseline, and runs on push like the other two. Then the question has an
answer that does not depend on anyone's judgement.

**And the standing rule this session earned:** Wael, on the third misreading in fifteen minutes —
*leaving a silent, bounded, non-user-facing inefficiency costs little and is known; removing
something misread costs an unknown amount.* Those are not symmetric.
