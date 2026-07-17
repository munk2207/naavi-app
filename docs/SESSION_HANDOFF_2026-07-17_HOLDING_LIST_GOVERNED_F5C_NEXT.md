# Session Handoff — 2026-07-17 — F17 Phase 7 closed, security incident resolved, holding list fully audited and governed

## ⭐⭐⭐ Next session priority (explicit): F5c — `task_actions` recipient resolution defect

**Real, unconfirmed SMS were sent to real people in production this session (and the session before it). This is the project's #1 open risk.** No Phase 1 has been written yet. Start there — do not skip to a fix.

**What's already known (do not re-derive):**
- Root cause is in `supabase/functions/evaluate-rules/index.ts`, the fire-time handler tagged "F5c" in its own code comment (~line 1064-1103). It resolves each `task_actions[]` entry's `to_name` via a **separate `lookup-contact` call per name, taking `data.contacts?.[0]` (the first result) with zero ambiguity check, zero confirmation, and zero fail-closed handling.**
- `lookup-contact` itself (`supabase/functions/lookup-contact/index.ts`) has a documented contract at lines 287-289: *"Caller picks best (single match) or shows a picker (multi)."* F5c violates that contract — it's the only caller that doesn't.
- Real incident evidence: a real voice call ("send message to abc saying good morning in 3 minutes") got parsed into three `task_actions` entries — `to_name: "A"`, `"B"`, `"C"` — and each single-letter query fuzzy-matched to a real, unrelated saved contact (confirmed live: "A" → Hussein El-Aggan via his surname "Aggan"; "B" → a contact named "Bob"; "C" → a contact named "Cottage"). Real "Good morning" SMS went to all three.
- Mechanism for why single letters match: Google's `searchContacts` matches on *any* name token (first/middle/last), not just first name. `lookup-contact`'s own "exact first-name" safety filter never engages for single-letter queries because no real contact's first name is literally one letter — so it silently falls through to Google's full loose result set. A `mynaavi_community: true` sort then pins real, connected users to the front of that loose list — meaning a meaningless query gets resolved straight to real people specifically *because* they're real.
- **Still genuinely unresolved, not yet investigated:** *why* the original utterance ("abc") got split into three single-letter `task_actions` entries in the first place. This is a `naavi-chat`/prompt-following question, upstream of everything above — the shared prompt (`get-naavi-prompt/index.ts`) instructs Claude to use `task_actions` for both single- and multi-recipient time-trigger sends, but neither `naavi-voice-server`'s nor `naavi-chat`'s tool schema actually declares `task_actions` as a valid field (checked directly — zero matches in both `anthropic_tools.js` and `_shared/anthropic_tools.ts`). Its shape is governed only by prose examples in the prompt, not a validated schema. This mismatch is a plausible contributing factor but not proven as *the* cause of the letter-split specifically.
- **Governance: full Phase 1-8 required** — this touches Action Rules and Notification routing, both Protected Core (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §4).
- Full evidence trail: `docs/SESSION_HANDOFF_2026-07-16_B10AB_SHIPPED_TASKACTIONS_DEFECT_FOUND.md` (original discovery) and this session's own transcript (single-letter contact-matching investigation, live `lookup-contact` calls reproducing the exact mechanism).

**Also queued right behind F5c, causally linked:** **B4b** — Deepgram drops the leading word(s) of an utterance on barge-in, reproduced 4 times this session, directly responsible for dropped recipient names silently becoming self-alerts (a related but separate failure mode from F5c's own bug). Fix F5c first; investigate B4b next, in its own session, not combined — they're two distinct root causes.

The full 20-item priority queue with governance levels for everything after these two now lives in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` — **start every future session there, don't re-derive priority.**

---

## What happened this session, in order

### Part 1 — Investigated `task_actions`/F5c root cause in depth
Picked up from the prior session's handoff (the "abc" → A/B/C misfire). Traced the exact mechanism live: called `lookup-contact` directly with "A", "B", "C" against Wael's real contacts and reproduced the exact real-world matches (Hussein, Bob, Cottage). Explained why: `searchContacts` matches any name token, the exact-first-name filter never engages for single letters, and the `mynaavi_community` sort pins real connected users to the front of the loose result set.

### Part 2 — Explored "Text Trump" as an alternative reproduction/validation angle
Investigated whether a plausible-but-nonexistent name would route through the same broken path as "abc," or through a different (safer) code path. Found the routing is genuinely non-deterministic across the systems involved (`naavi-chat`'s Layer 2 classifier vs. `naavi-voice-server`'s own Claude tool-use call) — corrected an earlier wrong claim that it would hit a "safe" path. User ran the live test; found a real, separate near-miss (Claude proposed sending to "Tow Truck - Spencer" instead of the nonexistent "Trump," based on a bad pre-injected contact match) — reviewed and **confirmed this is NOT a bug**, since the confirmation gate correctly gave the user the chance to catch and reject it before anything sent. This distinction (confirmed-then-rejected vs. zero-confirmation misfire) is the throughline for how to evaluate every finding this session.

### Part 3 — Re-ran F17 Phase 7's full manual test matrix against production
F19's infrastructure fixes had cleared F17's original blocker but the 8-test matrix had never actually been re-run. Executed all 8 with direct DB/`sent_messages`/`client_diagnostics` evidence for each (same rigor that caught the original false "Confirmed" claims):
- **5 clean passes:** self-override email (test 1), self-override SMS (test 2), third-party control (test 4, after a retest — first attempt failed due to STT dropping "Bob"), existing-alert update case (test 7), the self-override-field-contamination watch item (test 8, never observed).
- **2 partial:** location self-override (test 3) and plain self-alert control (test 5) — both correct except WhatsApp fired despite being disabled, traced to **B10d**: `report-location-event` never checks `alert_channels_enabled` at all, unlike `evaluate-rules` which does.
- **2 suspended, not failures:** negative case (test 6) required an unrealistic phrasing (naming an already-saved contact by name AND spelling their email — not how anyone talks); reactivate case (test 9) couldn't be cleanly exercised because the only available stale alert was already third-party, not self-override.
- **New bugs found and recorded along the way:** **B10c** (voice confirm-turn re-generates the datetime instead of executing the already-proposed one, and the recomputation is sometimes wrong by ~10 minutes — reproduced twice, correct once/wrong once), plus 4 reproductions of the STT leading-word-drop bug, a DRAFT_MESSAGE misroute (not yet ticketed), and a confirmation-speech gap where a correctly-resolved recipient wasn't actually named in the spoken confirmation (not yet ticketed).
- **F17 Phase 7 closed.** This clears F19's last real blocker (Track C, mobile production promotion) — but Track C itself was assessed as **not safe to start yet**, since `hooks/useOrchestrator.ts` has never been checked against B9z's, B10a's, or F5c's defect classes, and shipping mobile without that check risks shipping the same unfixed `task_actions` bug to the other surface.

### Part 4 — Security incident: real secrets found in a docs commit, resolved same session
Committing a backlog of untracked docs (`git add docs/*.md`) triggered GitHub's push protection — two old session-handoff docs contained real, working Supabase **service role keys** in plaintext (staging and production), sitting on disk for weeks, about to leave the machine for the first time via this push. Resolved fully:
1. Redacted both keys in the two files, amended the commit (safe — nothing had been pushed yet), pushed clean.
2. Rotated both keys in the Supabase dashboard (Wael did this directly, walked through it step by step).
3. Old keys confirmed revoked/deleted by Wael.
4. New keys verified working via live test queries against both projects.
5. `tests/.env` updated (production key updated in place; staging key newly added as `STAGING_SUPABASE_URL`/`STAGING_SUPABASE_SERVICE_ROLE_KEY`, since nothing local previously stored it).
6. Railway's `naavi-voice-server` production env var updated by Wael directly.
**No secret ever reached GitHub** — push protection caught it before the first push completed.

### Part 5 — Placeholder for a future Voice Staging platform
Wael asked whether to build a staging environment for `naavi-voice-server` (a known, previously-flagged gap — no staging tier currently exists for voice) while already touching Railway for the key rotation. Assessed as real, valuable work but **not a quick add-on** — needs its own Railway service, staging phone number, staging config, staging Supabase connection, and a deploy-branch strategy (the repo is single-branch today). **Explicitly deferred, placeholder only, no work started.**

### Part 6 — Full holding-list audit and governance overhaul
Wael asked to build a single prioritized work-order across all open items. Before doing that, audited the holding list itself for consistency against its own stated classification scheme and found (and fixed) real problems:
- **B9w** was stale — marked "open" in its own row for weeks after being fixed and shipped (verified against the real fix commit, `0d78050` in `naavi-voice-server`). Moved to Closed Bugs.
- **T1a** and **F5c** each had two completely unrelated items silently sharing one ID. Renamed the inactive/closed duplicates (`T5a`, `F7a`); kept the IDs with the active items.
- **F5c ("Executable tasks on alert fire")** — reopened. Its 2026-06-15 closure ("confirmed fully shipped and tested... both paths confirmed working") is directly contradicted by this session's own top-priority finding; it describes the exact code path that misfired.
- **B4b** ("Deepgram first-word truncation") — reopened for the same reason: closed twice (2026-05-19, 2026-05-23) but reproduced 4 times this session alone.
- **B3b** — was listed redundantly in two different closed sections; removed the duplicate.
- **45 Surface/Server-AAB column values** normalized against the document's own defined enum (things like `server`, `server/infra`, `mobile/server`, `Both` → the correct `backend`/`both`/`Server` etc.); extended the enum with `staff portal` and `docs`, which were already in real use but undocumented.
- **Severity-encoding and column-shape descriptions rewritten** — the original scheme claimed ID numbers encode severity (1/2/3) and that all four lists share one column shape; neither has ever matched actual practice. Corrected the text to describe reality instead of a rule that never held.
- **Added an enforced (not advisory) governance block** at the very top of the document: ID-collision check, enum-value rules, and reopen-on-contradicting-evidence discipline required of every future session that touches this doc.
- **Added a 20-item, 5-tier priority queue** covering every currently-open item, each annotated with its required governance level per `AI_DEVELOPMENT_GOVERNANCE.md` §4 (Protected Core → automatic full Phase 1-8; everything else classified as full/waiver-candidate/TBD).

Three commits, all pushed: `fa21135` (docs backlog, secrets redacted), `3e2b388` (governance + audit fixes + priority queue), `18a190b` (governance-level annotations added to the queue).

---

## What did NOT happen this session

- **F5c has no Phase 1 written.** Investigation this session was deep but informal — the formal Problem Definition doc (per `AI_DEVELOPMENT_GOVERNANCE.md` Phase 1) still needs to be written before any fix.
- **B4b has no Phase 1 either**, and hasn't been re-root-caused post-reopen — the 2026-05-23 regex fix evidently doesn't cover this shape of drop, or has regressed, but nobody has looked at the current code yet.
- **`hooks/useOrchestrator.ts` was not audited** against B9z's/B10a's/F5c's defect classes. This blocks F19 Track C and should probably happen alongside or right after F5c's own fix.
- **DRAFT_MESSAGE misroute and the confirmation-speech gaps found during F17 retesting have no ID and no Phase 1** — flagged in the holding list's Tier 4 as needing to be scoped before they can move up the priority queue.
- **Voice Staging platform** — placeholder only, zero implementation.
- **F19 Track C (mobile production promotion)** — not started, and per this session's own assessment, should not start until F5c is fixed and the `useOrchestrator.ts` audit is done.
- **B9b, B9d, B9s** — flagged in the priority queue as candidates for a waived/lightweight governance pass (non-Protected-Core or confirmed-inert), but Wael hasn't actually been asked to make that call yet.
- **Nothing was fixed in code this session** — every change was documentation (holding list, this handoff) or configuration (`tests/.env`, Railway, Supabase key rotation). No `naavi-app`, `naavi-voice-server`, or Edge Function source code was touched.

---

## State at handoff

| Item | Status |
|---|---|
| **F5c — `task_actions` defect** | **Open, top priority. No Phase 1. Real production harm already occurred (twice, across two sessions).** |
| B4b — Deepgram word-drop | Reopened, priority #2, causally linked to F5c. No Phase 1, not re-root-caused. |
| F17 Phase 7 | **Closed** — 5 pass, 2 partial (B10d), 2 suspended. |
| F19 | Only Track C left, not blocked, **not started, assessed as not-yet-safe to start** (pending F5c fix + `useOrchestrator.ts` audit). |
| B10c | New this session, open, no Phase 1. |
| B10d | New this session, open, low priority per Wael, no Phase 1. |
| Security incident (leaked service role keys) | **Fully resolved** — both keys rotated, old ones revoked, new ones verified working, no secret ever reached GitHub. |
| Holding list | **Fully audited, governed, and priority-queued.** Single source of truth, enforced going forward. |
| Voice Staging platform | Placeholder only, not started. |
| `useOrchestrator.ts` audit | Not started. Blocks F19 Track C. |
| DRAFT_MESSAGE misroute, confirmation-speech gaps | Found, not yet ticketed with an ID. |

---

## Documents produced this session (all in `docs/`, all committed and pushed)

- `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` — extensively edited (governance block, audit fixes, priority queue), 3 commits (`fa21135` partial, `3e2b388`, `18a190b`).
- This handoff.

## Groundwork already done — don't re-derive

- **`tests/.env` now has the current, rotated production key** plus new `STAGING_SUPABASE_URL`/`STAGING_SUPABASE_SERVICE_ROLE_KEY` variables — both verified working via live query this session. Use these for any diagnostic script.
- **Diagnostic scripts from this session** (`scripts/diag-*.js` — task_actions misfire evidence, lookup-contact single-letter reproduction, F17 test evidence pulls, Trump-test transcript pulls) are all uncommitted, sitting in `scripts/`. Useful reference patterns for pulling `action_rules`/`sent_messages`/`client_diagnostics` evidence directly — reuse the pattern rather than re-deriving the connection boilerplate.
- **Still uncommitted from before and during this session, untouched:** `tests/runner.ts` + 2 new B10a/b test files, `supabase/functions/whoami-google-diag/`, several screenshots, `deno.lock`, `.claude/settings.local.json`, `docs/.obsidian/workspace.json`. Not dealt with this session — ask Wael before assuming any of these should be committed or discarded.
- **The single-letter contact-matching mechanism (why "A"/"B"/"C" resolve to real people) is fully understood and evidenced** — don't re-investigate that part. What's still open is *upstream* of it: why the utterance got split into three single-letter `task_actions` entries in the first place.
- **The holding list's own governance block, at the very top of the document, is not optional** — read it before adding or editing any row in any future session.
