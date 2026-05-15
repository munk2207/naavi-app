# CLAUDE.md — MyNaavi Project Instructions

## ⭐⭐ CRITICAL — WORK IN THE MAIN REPO, NOT IN WORKTREES (Wael 2026-05-10)

**Even if Claude Code's session setup gives you a worktree path under `.claude/worktrees/` as your "primary working directory" — IGNORE IT. Work directly in the main repo at `C:\Users\waela\OneDrive\Desktop\Naavi` (branch: `main`).**

This rule overrides the environment's automatic worktree assignment. Wael edits files in his editor at the main repo path; work that happens in a worktree stays invisible to him until commits + pushes + pulls + (often) rebase ceremony. That ceremony is avoidable when the work could have just gone straight into main from the start.

**At session start, check the system prompt for `Primary working directory`:**
- If it's a worktree path under `.claude/worktrees/...`: STOP. Do not edit files there. Use absolute paths to the main repo for every Read / Edit / Write call. Use `git -C "C:\Users\waela\OneDrive\Desktop\Naavi"` for git operations. Commit directly on `main` (no feature branch unless the change is large enough to warrant a PR for review).
- If it's the main repo path: proceed normally.

**Why this rule exists:** 2026-05-10 session — agent worked the entire session in `.claude/worktrees/busy-wescoff-2718ef`, committed everything to a feature branch, merged via PR. When Wael tried to view a doc edit, the file at the path he expected was unchanged; the rewrite was in the worktree path he didn't know existed. Cleanup required a manual file copy + rebase + push to align local and remote main. Pure waste.

**Exception:** if Wael explicitly says "use this worktree" or "branch off main for this work" — follow that. Default is main.

---

## ⭐ FOUNDATIONAL PRINCIPLE — NO CACHE, FRESH ALWAYS, USER PICKS (Wael 2026-05-07)

**The system has no place-cache. Every "alert me at X" goes fresh to Google Places; the user picks every time.** This was the V57.13.3 simplification after a long afternoon of cache-correctness gymnastics — Wael's quote: *"if I have a saved Ottawa McDonald's and I'm in Toronto asking about McDonald's, Naavi will silently point me to Ottawa. If I said that, I'm on drugs."* The cache existed to save a Google call; it created Toronto-shadows-Ottawa, the alias merge edge cases, the "qualified vs unqualified" rule, and a permanent class of integrity bugs. It's gone.

Three rules now underwrite the data architecture:

1. **No place-cache. Fresh Google every time.** `resolve-place` queries Google Places on every request and returns either a single result or a picker. The user always picks. The performance cost (~1s, ~$0.005 per call) is trivial compared to the bug cost the cache produced.
2. **Saved places are absorbed by alerts.** If the user wants to be reminded at the same place repeatedly, they say *"alert me every time I arrive at X"* — that creates ONE recurring `action_rules` row with the resolved coordinates. The next time they say *"alert me at X"*, the orchestrator pre-checks `action_rules` and replies *"you already have an alert there."* The alerts ARE the saved-place memory.
3. **One logical key, one row.** `action_rules` has a partial UNIQUE index on `(user_id, trigger_type, ROUND(lat,5), ROUND(lng,5)) WHERE trigger_type='location' AND enabled=true`. Two enabled location alerts at the same physical place for one user are physically impossible at the DB layer. Disabled rules don't block re-creation. RLS blocks direct client writes; only the orchestrator (with the user's session token) writes.

Reference implementation: `action_rules` location dedup (V57.13.3 — `20260507_drop_user_places_action_rules_dedup.sql` + `resolve-place` v5 + `useOrchestrator.ts::commitPending`).

**Pre-commit checklist before adding ANY new table or write path:**
- What's the logical key? Is there a UNIQUE constraint on it?
- Is there exactly one entry point that owns writes? Does RLS block direct client writes from elsewhere?
- Does the application code pre-check for duplicates and surface a friendly message, or does it rely on the DB constraint to fire and the user to see a generic error?
- Are there integrity tests (`tests/catalogue/data-integrity.ts`) covering: duplicate-key insert blocked, valid-different-key insert allowed, edge cases (e.g. disabled rows, partial-index WHERE clause)?
- Does the table need a CACHE? **Default answer: NO.** Caches were the source of every place-related bug today. Only add one if the underlying source has a real performance or rate-limit problem; if you do, the cache MUST never silently override fresh data — it must surface as a SUGGESTION the user can override.

If the answer to any of these is "no" or "I don't know" — STOP and add it before shipping. This file's "DATA INTEGRITY — FOUR LAYERS" section below is the reference for tables that go beyond simple uniqueness. The auto-tester (Rule 15) will catch regressions on every build.

---

## READ THIS FIRST — EVERY SESSION

You are working on MyNaavi, an AI life orchestration companion for everyone — designed to feel especially friendly to older healthy independent adults, but never positioned as a senior product. The founder (Wael) is non-technical. He builds the product vision; you build the code.

### POSITIONING — NO "SENIOR" / "CAREGIVER" LANGUAGE

Wael 2026-05-05: stop framing MyNaavi as "for seniors" or describing users as "seniors". The app is for EVERYONE; we just take extra care that older healthy independent adults find it friendly (large tap targets, voice-first phone surface, simple language).

**Banned words in any user-facing surface, prompt, doc, code comment, or memory file:**
- "senior" / "seniors" / "senior citizen"
- "caregiver" — say "helper" or "person setting up MyNaavi for someone else"
- "elderly" / "older person" / "active aging"

**Allowed when context demands:**
- "user" — preferred default
- "older healthy independent adult" — only when discussing target demographic in internal docs, never in user-facing copy
- "person", "they", "the user themselves"

**Why:** the senior framing is condescending to active healthy users. It positions the product as care-receiving rather than empowering. The audience is anyone who wants help managing their daily life — they happen to skew older but the framing should never reduce them to that.

Apply this rule retroactively when editing existing code, prompts, docs, or memories. Apply it to new work without exception.

### ACTIVE WORKTREE / BRANCH — CHECK BEFORE ANY EDIT

**Default: work directly on `main` in the repo base.** Recent sessions (16, 17) worked cleanly on main — no active feature worktree is needed.

**Main repo base:** `C:\Users\waela\OneDrive\Desktop\Naavi` (branch: `main`)

**Stale worktrees under `.claude/worktrees/`:** `cranky-hoover` and `focused-agnesi` are leftover from earlier sessions (behind main by 20+ commits). Do NOT work there unless explicitly asked. They can be cleaned up in a dedicated maintenance session.

**Build clone:** `C:\Users\waela\naavi-mobile` (branch: `main`) — **DO NOT EDIT CODE HERE.** Exists only for `eas build`. Sync via `git fetch origin && git merge origin/main`. Never `cp -f`.

**Voice server repo:** `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server` (separate GitHub repo `munk2207/naavi-voice-server`, branch: `main`). Single-branch, no worktrees.

**Web marketing site:** `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website` (separate GitHub repo `munk2207/mynaavi-website`, branch: `main`). Vercel auto-deploys `origin/main` root files to https://mynaavi.com. Static HTML only — no Supabase, no auth, no API. Rules 1-6 of "CONFIGURATION DISCIPLINE" do NOT apply (no crons, no Edge Functions, no user sessions). Only relevant rule: 7 (sync via `git pull origin main`, never `cp -f`). **Known legacy duplicate:** the repo has an old `my-naavi-site/` subfolder committed alongside the newer root files. Vercel only serves the root. Do not edit the subfolder — edit files at the repo root.

Before any code edit, run `git worktree list` and `git branch -a` and confirm you're in the right place. If you're not sure, ASK.

### BRANCHES — archive/ IS HISTORY, DO NOT TOUCH

Branches prefixed `archive/` are read-only snapshots of past work kept for reference:
- `archive/v50-build-90` — last state before multi-user session (build 91)
- `archive/v48-drive-notes` — V48 Drive Notes feature
- `archive/v46-build-45` — V46 Deepgram auth fix + expo-contacts
- `archive/remember-card-fix` — REMEMBER card fixes, OAuth fixes

Never edit, merge, or rebase these. If a new historical snapshot is needed, create `archive/<short-description>` and push it.

Never accumulate many `claude/<random-name>` feature branches. If one exists and is merged/abandoned, delete it. If it has unique useful work, rename it to `archive/<description>` and push.

### CONFIGURATION DISCIPLINE — NO DUPLICATE CONFIG

The app has ONE canonical place for each type of configuration. Never create parallel or alternate config paths. If one exists already, extend it — do not make a second.

**Rules (hard-won from real confusion, enforce strictly):**

1. **One cron job per purpose.** Before adding a cron job, run `SELECT jobname, schedule FROM cron.job` and check nothing already covers that purpose. If an older job exists with a hardcoded JWT, REPLACE it — do not run both in parallel.

2. **One rule storage per domain.** The canonical table for triggers/actions is `action_rules` (generic trigger_type + action_type framework). Do not create a new "alerts" or "watches" or "rules" table. Email-only paths like `email_watch_rules` must not be reintroduced.

3. **One Edge Function per job.** Before adding a new function, run `npx supabase functions list --project-ref hhgyppbxgmjrwdpdubcx` and check nothing already does this job. If a legacy function (e.g. `voice-call`) exists alongside a new one (e.g. `trigger-morning-call`), delete the legacy one.

4. **One user_id resolution pattern, everywhere.** Every Edge Function that may be called by the voice server OR the mobile app MUST use this fallback chain in this order:
   - (a) JWT auth — `getUser()` from Authorization header (mobile app path)
   - (b) Request body `user_id` (voice server / server-side call path)
   - (c) `user_tokens` lookup where `provider='google'` (last resort only)

   NEVER use `gmail_messages` for user resolution. NEVER use `auth.admin.listUsers().sort(oldest first)`. NEVER use `.limit(1)` on multi-user tables as a shortcut.

5. **Unique constraints on config tables.** Any table storing user configuration (rules, contacts, alerts, settings) must have a UNIQUE constraint preventing duplicate rows for the same logical key. When Claude's action system produces repeated writes, the constraint blocks duplicates instead of silently accumulating them.

6. **One TTS confirmation, one path.** Tap-to-send and voice-confirm-to-send must share the same TTS helpers (`SPEECH.SENT`, `SPEECH.CANCELLED`) and emit the same audio feedback. If a new "send" pathway is added, wire it to the same speak() function — never add a silent alternative.

7. **One repository, many clones.** Mobile app lives in one GitHub repo (`munk2207/naavi-app`). Clones stay in sync via `git merge origin/main` ONLY. Never `cp -f` between clones — that bypasses git and silently diverges them (builds 83-90 diverged that way).

8. **Three repos — different hygiene.** Three separate GitHub repos exist:
   - `munk2207/naavi-app` (mobile app + Edge Functions source)
   - `munk2207/naavi-voice-server` (Twilio voice server on Railway)
   - `munk2207/mynaavi-website` (static marketing site on Vercel)
   Don't mix work between them. Mobile and voice share the Supabase backend, so rules 1-5 apply to both. The website has no backend — skip rules 1-6 for it.

### CHECKS BEFORE ANY NEW CONFIG

| Adding | Check |
|---|---|
| A cron job | `SELECT * FROM cron.job` — already covered? |
| An Edge Function | `npx supabase functions list` — already exists? |
| A rule/alert type | Does `action_rules` handle it via trigger_type? |
| A new table | Is there an existing table we can extend instead? |
| A user-resolution fallback | Use the 3-step chain in Rule 4 — don't invent a new one |
| A feature branch | Is there already a worktree for this? Use it. |

If in doubt, ASK before creating parallel config.

### DATA INTEGRITY — FOUR LAYERS (Wael 2026-05-07)

**Established as a hard rule after the user_places duplicate-Walmart incident.** Every config table MUST have all four layers of defense so corrupted data is *physically impossible* to land in the DB. Configuration Discipline #5 (unique constraints) is the minimum, not the ceiling.

**LAYER 1 — DB constraints (cannot be bypassed by any code path)**
- A UNIQUE index on the **logical key** of the table — not just a surrogate column. For coordinate-bearing rows like `user_places`, that means `UNIQUE (user_id, ROUND(lat,5), ROUND(lng,5))` — same physical place cannot exist twice. NOT just `UNIQUE (user_id, alias)`.
- NOT NULL on every column the application logic depends on.
- CHECK constraints on every range-restricted value (lat ∈ [-90,90], lng ∈ [-180,180], radius > 0, etc.).

**LAYER 2 — Single write entry point (one Edge Function, one validation pipeline)**
- All writes to a given table MUST flow through ONE Edge Function. No mobile-app direct INSERTs, no voice-server direct INSERTs.
- That function looks up existing rows by the logical key BEFORE inserting. If a match exists → UPDATE (merge). If no match → INSERT. Same-key INSERT must be impossible at the application layer too, before the DB constraint catches it.

**LAYER 3 — RLS lockdown (client cannot bypass Layer 2)**
- Drop any `FOR ALL` policy that lets authenticated users INSERT/UPDATE/DELETE the table directly.
- Replace with a `FOR SELECT` policy for users + `FOR ALL ... USING (auth.role() = 'service_role')` for the Edge Function. Now every write must go through the Edge Function (which runs as service_role).

**LAYER 4 — Schema redesign (eliminates footguns by construction)**
- If the table has any "two rows for one logical thing" pattern (e.g. one alias per row, one phone-number variant per row, etc.) → collapse to one row with array column (`aliases text[]`, `phone_numbers text[]`).
- The footgun is gone at the schema level — application code can't accidentally write 2 rows for one place even if it tries.

**LAYER 5 (tests, not skippable)**
- For each table protected by the above, add tests under `tests/catalogue/data-integrity.ts`:
  - Try to insert a same-logical-key duplicate → must FAIL
  - Try to insert with NULL on a NOT NULL column → must FAIL
  - Try to insert as anon-key (not service_role) → must be blocked by RLS
  - Verify alias-merge / array-merge correctness on save
- These tests run on every `npm run test:auto`. Rule 15 stays in effect.

**Pre-write checklist for any future agent touching a config table:**
1. What's the logical key? (Often NOT the surrogate `id`.)
2. Is there a UNIQUE constraint on that logical key? If no, add one in a migration.
3. Is there a single Edge Function that owns all writes to this table? If multiple writers exist, consolidate.
4. Does RLS block direct INSERT/UPDATE/DELETE from clients? If not, lock it down.
5. Are there any "one row per X" patterns where X could naturally have multiple values? Collapse to an array column.
6. Are there integrity tests in `tests/catalogue/data-integrity.ts` for this table? If not, add them.

**Tables that already pass this checklist:**
- `action_rules` (location dedup) — V57.13.3, migration `20260507_drop_user_places_action_rules_dedup.sql` + `resolve-place` v5 + `useOrchestrator.ts::commitPending` pre-INSERT check. Reference implementation.

**Tables that still need this audit (work for future sessions):**
- `action_rules` (non-location triggers — email, time, calendar, weather, contact_silence) — only the `location` trigger has the unique-coords partial index; other triggers may need their own dedup keys
- `contacts` — same status
- `lists` — same status
- `reminders` — same status
- `user_settings` — single-row-per-user, lower risk but still worth auditing

**The user_places table was DROPPED in V57.13.3.** It existed as a place-cache for resolve-place but produced more bugs than performance. The "saved places" feature is now absorbed by `action_rules` — if a user wants to be reminded at a place repeatedly, they create one recurring rule. See "FOUNDATIONAL PRINCIPLE — NO CACHE, FRESH ALWAYS, USER PICKS" at the top of this file.

### ABSOLUTE RULES — NEVER BREAK THESE

1. **NO ACTION WITHOUT EXPLICIT APPROVAL.** Do not edit files, run commands, commit, push, build, or take any action until the user says "yes" or "go ahead." Even if the user provides a detailed plan, that is context — NOT permission to execute.

2. **ONE STEP AT A TIME.** Give one command, one change, one instruction. Wait for confirmation before the next.

3. **KEEP IT SHORT.** No technical walkthroughs. No multi-paragraph explanations. One-line description of what something does. The user is non-technical and trusts you to know the details.

4. **DETAILED STEP-BY-STEP.** When asking the user to do anything, give full, clear, numbered instructions — one step at a time. Always include the full URL of any website. Never use technical terms (webhook, endpoint, domain, etc.) without explaining in plain language. Never assume the user knows anything technical.

5. **STABILITY OVER COST.** When recommending tools, platforms, or architecture — recommend the most reliable and stable option, not the cheapest.

6. **DON'T ASSUME.** When the user reports a problem, investigate the actual code. Don't assume they missed a step.

7. **CHECK CODE, NOT MEMORY.** When asked "is X built?" — search the code first, never answer from memory alone. Memory files may be outdated.

8. **NO TRIAL AND ERROR.** Trace the full chain before changing code. Fix server before client.

9. **WAIT FOR "DONE."** Don't give the next instruction until the user confirms the current one is complete.

10. **MULTI-USER SAFETY.** Naavi has multiple users (wael.aggan@gmail.com = Wael, heaggan@gmail.com = Huss). Never write code that does `.limit(1)` or "oldest user wins" on tables shared across users (`user_tokens`, `user_settings`, `calendar_events`, `reminders`, `knowledge_fragments`, `lists`). Always resolve the specific user by JWT (mobile app), caller phone number (voice server), or explicit `user_id` in request body (Edge Functions called from voice server).

11. **NEVER RECOMMEND WHEN TO STOP OR WORK.** Do not suggest pausing, resting, stopping for the night, coming back tomorrow, or any pacing based on time of day, day of week, fatigue, or how much work has already been done. The user decides when to work and when to stop — it is their responsibility. Do not act as a human co-worker with wellness concerns. You are an AI machine; behave like one. Recommendations must be based ONLY on technical scope (context drift, unresolved decisions, blockers) — never on the clock or "freshness."

12. **NEVER ACT ON THE OUTSIDE WORLD WITHOUT EXPLICIT POSITIVE APPROVAL.** Any action that sends to or creates a record for a third party — SMS, WhatsApp, email, calendar events with attendees, voice messages, deletions — MUST receive a clear affirmative from the user before executing. Acceptable approvals: *"yes"*, *"approved"*, *"send it"*, *"confirm"*, *"go ahead"*. NOT acceptable: *"ok"*, *"sure"*, *"sounds good"*, silence, or any ambiguous reply — Naavi re-asks. Additionally, if any input referenced in the action is **unresolved** (*"my wife"* without a known contact, a date without a year, a place not verified) the action is BLOCKED until the input is clarified by the user — never fall back silently, never guess, never default to the user's own phone/email. Internal actions (rule/alert creation, memory writes, lookups, drafts, solo calendar events on the user's own schedule) do NOT require approval and should flow naturally.

13. **OFFER CHOICES AS NUMBERED LISTS, NEVER IN A SENTENCE.** Whenever you ask the user to pick between options, format them as a numbered list (1, 2, 3…) on separate lines. Never embed options in prose ("do you want X or Y?"). Applies to every choice, no matter how small. This is the precondition for Rule 14 — the user can only reply `# N` if the options were numbered.

14. **"# N" MEANS THE USER PICKED OPTION N.** When you offer numbered choices and the user replies with `# 2`, `# 5`, etc., the digit after the `#` is the option they chose. The user prefixes the hash because the chat interface auto-renumbers a bare number reply (typing just `2` can render as `1`). Always honor this convention literally — `# 2` = option 2, never something else, never ask what it means.

15. **MANDATORY — `npm run test:auto` MUST BE FULLY GREEN BEFORE EVERY AAB BUILD.** Established by Wael 2026-05-01 after V57.9.8 reached the first 44/44 green state. No exceptions. The rule applies to every `npx eas build` invocation, regardless of how small the change. Run the full suite, read the summary line, confirm `✗ 0 failed   ⨯ 0 errored`. If anything fails or errors: STOP, diagnose, fix, re-run, re-confirm green — only THEN proceed to build. The green suite is our stable baseline / safety net; pushing a build on top of a red suite breaks the baseline. Skipping the suite "because the change is small" or "because we just ran it" is a hard violation — re-run every time. Partial-grep runs (`npm run test:auto -- --grep <x>`) are OK during iteration but the FULL run must happen before the build command.

16. **CROSS-SURFACE COMMIT DISCIPLINE — `parity-impact:` line on every user-facing surface change.** Established by Wael 2026-05-08. Every commit that changes user-facing behavior in `naavi-voice-server/`, `hooks/useOrchestrator.ts`, `app/`, `supabase/functions/naavi-chat/`, or `supabase/functions/get-naavi-prompt/` MUST include a `parity-impact:` line in the commit message body. Values: `voice=none` / `mobile=none` / `same-as-mobile` / `same-as-voice` / `both-shipped` / `TBD-needs-classification-entry`. Forces explicit cross-surface decision at the moment of change so voice and mobile can't silently drift. Example: `parity-impact: voice=TBD-needs-classification-entry — mobile-side fix; voice equivalent open as B?? for follow-up`. **Retires automatically once W2 (Anthropic Structured Outputs) + W3 (Voice Automated Regression Suite) from `docs/VOICE_COMPLETION_ROADMAP_2026-05-08.docx` land** — those automate drift detection at deploy time. Until then, this is the discipline.

17. **VALIDATE EVERY CLASSIFICATION ENTRY BY USER-FACING TEST BEFORE CODING A FIX.** Established by Wael 2026-05-08 after B1a (Voice live-calendar fetch) was tested and found not to reproduce — the classification entry's architectural read was correct about the code path but wrong about user-visible behavior. Before applying any fix from `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08`, run the user-facing test that would expose the bug. If the test doesn't reproduce the bug, **close the item** (move to "Closed without entry" with the reason and date) rather than fixing a phantom. The classification doc captures code-path reads, audit findings, and memory — all useful diagnostics but none guarantee the bug is currently user-visible. Same rule used to close Items 4 / 12 / 14 / B1a. Validation is the gate; do not propose tighter / weirder reproduction setups to make the bug appear after a clean test already showed it does not.

### WHERE TO START

**Most recent handoff:** `docs/SESSION_HANDOFF_2026-05-15_V57.15.6_BUILD_179_TRANSISTORSOFT_TRIAL.md` — **READ THIS FIRST**. Session 2026-05-15 shipped **V57.15.6 build 179** (commit `751fbd7`, merged via `d63b6b3`) — UI polish bundle of 5 fixes from V57.15.5 live retest: (1) section header → bold + `Colors.textPrimary` (was `textHint`, dimmer than body), (2) all 7 X icons app-wide → `Colors.error` red (was `textMuted` grey), (3) PIN modal KAV restructure (KAV outermost child of Modal + backdrop anchored `flex-start` + paddingTop 60), (4) Settings ScrollView wrapped in KAV (fixes Primary edit screen-shift, applies to all inputs), (5) multi-phone auto-persist — "Save phones" button removed; new `persistPhoneNumbers` helper called on +/X/edit-✓. All 5 verified live on Wael's phone end-to-end. Auto-tester 108/108 green. **Major non-shipped work:** Transistorsoft `react-native-background-geolocation` v5.1.1 trial integration on `claude/transistorsoft-trial` branch (preserved on origin) — drive-test FAILED on both APK (DEBUG) and AAB (RELEASE without license) at 841 Balsam Dr, neither phone fired. Postmortem identified notification icon path (`'mipmap/ic_launcher'` → likely doesn't resolve in Expo prebuild) + DEBUG-mode FG-service suppression as most likely root cause. Library DROPPED for now. Prior handoff: `docs/SESSION_HANDOFF_2026-05-14_V57.15.5_BUILDS_176_177.md`.

**Top of next session — PRIORITY ORDER (Wael 2026-05-15):**

1. **⭐ Promote V57.15.6 build 179 AAB to Internal Testing.** Sitting as DRAFT in Play Console (https://play.google.com/console → MyNaavi → Internal testing → "Send to internal testing"). ~30 sec + 5-15 min Play Store propagation. Phone 2 (mynaavi2207) + future testers will receive it. AAB is safe — no Transistorsoft, no license issue.

2. **Geofence reliability — Transistorsoft attempt FAILED, decide what next.** Three paths:
   - **(a) Retry Transistorsoft** with the 4 postmortem fixes (notification icon path → `'@drawable/notification_icon'` or generated mipmap; audit AndroidManifest for FOREGROUND_SERVICE/FOREGROUND_SERVICE_LOCATION/ACCESS_BACKGROUND_LOCATION/WAKE_LOCK/RECEIVE_BOOT_COMPLETED post-prebuild; RELEASE-first testing; then maybe pay $399 v5 license). Trial branch `claude/transistorsoft-trial` (commit `7c5605a`) has the full integration code if anyone wants to apply these.
   - **(b) Try Radar** — original parallel evaluation candidate; SaaS pricing likely high (still no reply from sales). Different vendor, different mechanism.
   - **(c) Accept geofencing-on-Samsung is unsolved** — focus on iOS or other Android OEMs where Expo's native API works. Block Robert's V57.x promotion permanently OR ship without geofencing.

   **No recommendation — Wael's strategic call.**

3. **Server-side fast wins (always available, no AAB needed):** `naavi-spend-summary` Edge Function (~1 hour, approved 2026-04-30 but never built) + Voice live-calendar fetch (~30 min, voice still on stale snapshot vs mobile V57.11.6) + `resolve-place` radius 100→500 + address routing fix (~30 min). Three real user-visible improvements, zero AAB.

4. **Optional polish:** add `isValidE164` strict 10-digit-after-+1 enforcement (~15 min, deferred from V57.15.6 as low-priority — caught during Test 4 false-alarm; rare typo case where user types `+1` followed by 9 digits and the prettyPhone fallback misformats as `+123 4567891`).

5. ~~V57.15.6 build 179 (5 polish fixes)~~ — **SHIPPED 2026-05-15.** All 5 fixes verified live on Wael's phone. Branch merged to main; feature branch deleted.

6. ~~Transistorsoft trial integration~~ — **DROPPED 2026-05-15.** Drive-test failed on both APK + AAB. Postmortem in 2026-05-15 handoff doc + holding list item 4.

The previous Voice Completion Roadmap (S1–S8 from 2026-05-04 / 2026-05-07) remains the broader plan after the items above land. Roadmap source: `docs/VOICE_COMPLETION_ROADMAP_2026-05-04.docx` (superseded but kept for history).

**Last AAB on Wael's phone:** V57.15.6 build 179 APK (commit `751fbd7`), sideloaded + verified live 2026-05-15. AAB also built (sitting as DRAFT in Play Console). Second phone (mynaavi2207) — state from prior session (V57.16.0-trial Transistorsoft AAB if promoted, otherwise V57.15.5 AAB).
**Last AAB on Robert's phone:** V56.6 (build 115), installed 2026-04-28. **Do NOT promote V57.x to Robert until geofence reliability is solved (Transistorsoft trial failed; revisit per priority #2).**

**Auto-tester (latest):** 108 ✓ / 0 ✗ / 0 errored / 0 skipped. Run with `npm run test:auto`. Includes `prompt-regression` (15), `truth-at-user-layer` (1, retry-on-flake), `list-connections` (10), `hosted-replies` (5), `pending-dwell` (5), `data-integrity` (3), `source-intent` (5), `brief-unread` (2), `search-normalization` (4), `gmail-freshness` (1), `lists` (4), `voice-pin` (7), `multi-phone` (4), `lists-reconcile` (2), `multiuser` (20). Re-confirmed green at V57.15.6 build 179 commit. Retry-on-flake covers `chat`, `smoke`, `prompt-regression`, `truth-at-user-layer` (all Haiku-driven categories).

**Current Claude prompt version:** `2026-05-13-v74-list-connection-query-required-fields` (via `get-naavi-prompt` Edge Function). 2026-05-13 shipped v73 → v74 (CRITICAL FIELD REQUIREMENT block + address-style entityRef → action_rule example; fixes F1a item 16a entityType inconsistency).

**Prompt-regression test suite:** `tests/catalogue/prompt-regression.ts` locks in known-good Claude action emissions. **Future prompt edits MUST keep this suite green.** Don't add a prompt rule without a corresponding regression test — that's how the v57→v58→v59 cycle started.

**Strategic positioning** (Wael 2026-05-05): "senior" / "caregiver" / "elderly" / "active aging" are BANNED across all surfaces (code, prompts, docs, memory). The app is for EVERYONE. Use "user" by default; "older healthy independent adult" only when context demands. See top of this file.

### HOLDING LIST — services/features in queue

Canonical list of pending work, organized by what's blocking each. Mirror in `docs/SESSION_HANDOFF_2026-05-07_V57.13.7_BUILD_165.md`. Add to / remove from this list as work moves.

**Blocked on external approvals:**
1. ~~Picovoice Eagle voice biometric~~ — **CLOSED 2026-05-13.** Picovoice approval queue sat 2 weeks. Wael chose 4-digit PIN over voice biometric for off-phone caller verification — industry-standard pattern, no vendor dependency, ~1 hour to build. Picovoice fully dropped (audit confirmed no other feature depended on them). Memory: `project_naavi_caller_pin_chosen_over_biometric.md`. PIN-flow build is now queued server-side below.
2. AWS Polly (voice unification mobile→Polly Joanna) — needs AWS account setup
3. Maestro full-suite — needs emulator Internal Testing install
4. **Geofence reliability — TRANSISTORSOFT TRIAL FAILED 2026-05-15.** Drove with two phones (APK DEBUG + AAB unlicensed RELEASE) to identical geofence target (841 Balsam Dr, coords verified IDENTICAL in DB). Neither fired. Phone 1 (APK) had no Android FG-service notification; Phone 2 (AAB) did. Postmortem (Explore agent, evidence-based) attributes most likely root cause to: (a) notification icon path `'mipmap/ic_launcher'` may not resolve in Expo prebuild → Android refuses to start FG service without valid notification → SDK silently dies in DEBUG; (b) Transistorsoft v5 in unlicensed DEBUG may suppress FG service entirely. Trial branch `claude/transistorsoft-trial` (commit `7c5605a`) preserved on origin for future retry. Decision parked: (a) retry Transistorsoft with the 4 postmortem fixes, (b) try Radar (still no sales reply), or (c) accept Samsung-geofencing-unsolved. **Wael's strategic call next session.** Full postmortem: `docs/SESSION_HANDOFF_2026-05-15_V57.15.6_BUILD_179_TRANSISTORSOFT_TRIAL.md`.

**Server-side queue (no AAB needed):**
4a. **Caller PIN for off-phone verification (Wael 2026-05-13).** New `user_settings.voice_pin_hash` (bcrypt/argon2) + voice-server prompt flow when caller phone doesn't resolve to a known user. Mobile Settings UI for set/change (small AAB-side piece). 3-attempt lockout. Replaces voice-biometric plan. Full design in `project_naavi_caller_pin_chosen_over_biometric.md`. ~1 hour build.
5. Voice live-calendar fetch (mobile shipped V57.11.6, voice still on stale snapshot)
6. Voice action parity — DELETE_EVENT, LIST_RULES, DELETE_MEMORY, SCHEDULE_MEDICATION
7. Voice stop-word interrupt regression
8. Voice Deepgram first-word truncation on barge-in
9. Voice name-search phonetic fallback ("Hussein" STT failure)
10. Voice migration to Anthropic Structured Outputs (~200 lines drift vs mobile)
11. Inbound SMS/WhatsApp queryability (outbound covered; inbound has no capture path)
12. Spend summary Edge Function (approved 2026-04-30, not built — `naavi-spend-summary`)
13. LIST_RULES synthesize-action backstop in orchestrator
14. Demo line "remind me" time-extraction loop fix
15. ~~**F1d live tests 3 + 4**~~ — **CLOSED 2026-05-13.** Both PASS live on Twilio call. Test 3 (recursive mute, offer stays pending) + Test 4 (30-sec silence, no false-positive delivery). 4 voice-server fixes derived from the live test (regex relaxed for Deepgram confusables, aggregated-text check at UtteranceEnd, SMS confirmation TTS clearer, idle-prompt suppressed during quiet window). Commits `4eef2da` `2b86391` `01d4f72` `1f14748`.
16. **`resolve-place` default radius 100 → 500** + **address-vs-business routing fix** (use Google geocode API for queries that start with a number; textsearch for business names). Today's 1026/1200 test exposed both: new rules created via voice still default to 100m, and 1200 Terranova mis-resolved to the same coords as 1038 because textsearch fell back to a Terranova centroid.

16a. ~~**F1a voice — `entityType` inconsistency on `list_connect`**~~ — **CLOSED 2026-05-13** via prompt v74 (commit `b9e56ca`). New CRITICAL FIELD REQUIREMENT block in RULE 8b + entityType-inference rules per phrasing pattern + new prompt-regression test `list-connection-query-address-must-have-entitytype` locking in the live-bug phrasing ("What lists are on 688 Bayview office?"). Live verified on Wael's phone V57.15.4 after deploy.

**AAB-required queue:**
17. ~~**Manual geofencing switch (V57.14.4)**~~ — **CLOSED 2026-05-12.** Disproven by V57.14.4 heartbeat diagnostic — FG service receives zero location updates from Android after backgrounding AND cannot be restarted from background per Android 12+. Plan replaced with **third-party SDK evaluation (Transistorsoft vs Radar) — see "Blocked on external approvals" item 4 above + 2026-05-12 handoff**.
18. ~~**F1a Session 2 — Wave 1 (server)**~~ — **DONE 2026-05-12.** Voice surface end-to-end shipped (commits `d49be81`, `8f5b083`, `84b1894`, `6bdc2f6`, `c52e948`, `5212676`, `6d78a0e`, `9cb2fb1`, `4c4a507`). Verified live on Twilio call.
18a. ~~**F1a Wave 2 (V57.15.0)**~~ — **SHIPPED 2026-05-12 (V57.15.0) + follow-ups 2026-05-13 (V57.15.4).** All 4 phases shipped in V57.15.0 build 171 (commit `a705196`). V57.15.4 build 175 (commit `a9603bd`) added newline formatter + tappable list rows.
18b. ~~**V57.15.5 build 176 + 177 (Caller PIN + Lists testIDs + multi-phone refinements + verified-address naming)**~~ — **SHIPPED 2026-05-14.** Builds 176 (`fae265c`) + 177 (`5ce56ad`). Caller PIN mobile-complete end-to-end. Auto-tester 108/108 green. Live test on Wael's phone: T1/T2/T5/T7 PASS clean; T3/T4 PASS via blind-type workaround (PIN modal keyboard fix moved to build 178). Memory: `project_naavi_caller_pin_chosen_over_biometric.md`. Handoff: `docs/SESSION_HANDOFF_2026-05-14_V57.15.5_BUILDS_176_177.md`.
18c. ~~**V57.15.6 build 179 (5 polish fixes — section header + X icons + PIN modal + Primary edit + multi-phone auto-persist)**~~ — **SHIPPED 2026-05-15.** All 5 fixes verified live on Wael's phone end-to-end. Branch `claude/v57.15.6-polish-fixes` (commit `751fbd7`) merged to main via `d63b6b3`; feature branch deleted. Auto-tester 108/108 green. AAB sits in Play Console as DRAFT awaiting Wael's manual promotion to Internal Testing (priority #1 next session). Handoff: `docs/SESSION_HANDOFF_2026-05-15_V57.15.6_BUILD_179_TRANSISTORSOFT_TRIAL.md`.
18d. **`isValidE164` strict 10-digit-after-+1 enforcement** — low-priority polish caught during V57.15.6 Test 4 false-alarm. Currently `+1234567891` (only 9 digits after +1) passes validation and pretty-prints as `+123 4567891` (greedy regex matches +123 as country code). Fix: tighten validator to require exactly 10 digits when number starts with +1. ~15 min code; can bundle with next AAB. Rare typo case in production.
19. ~~Multi-phone identity (`phone_numbers[]` schema + Settings UI)~~ — **CLOSED 2026-05-15.** Auto-persist redesign shipped in V57.15.6 build 179. Save phones button removed entirely.
20. Demo line maturity (richer scenarios + conversion path + telemetry)
21. ~~**Cosmetic ruler leak fix**~~ — **CLOSED 2026-05-13.** Shipped via V57.15.3 space-ruler approach (`NAAVI_INVISIBLE_RULER = ' '.repeat(50)`) commit `8751a38`.
22. ~~Haptic VIBRATE permission + duration~~ — **CLOSED 2026-05-14** as phantom; already shipped in V57.11.7 (long-press mic vibration at 150ms, app.json:31 has VIBRATE permission). Audit was wrong on the 2026-05-13 holding list.
23. ~~Mobile-side todo-list-per-alert~~ — **SUPERSEDED BY F1a** (item 18). F1a's list_connections IS the todo-list-per-alert pattern, generalised across all entity types.
24. ~~Verified-address rejection — name the address~~ — **CLOSED 2026-05-14** via build 177. 2 sites in `hooks/useOrchestrator.ts` now name the place: `:830` and `:924`. Calendar variant at `:1419` was already named.
25. Voice privacy UX (4-piece feature, not started)
26. Blog age reframe (2 articles still on age framing)
27. ~~In-app Battery Optimization prompt~~ — **CLOSED 2026-05-11.** Shipped V57.14.2 build 168 (commit ccf53f8). Memory: `project_naavi_battery_opt_inapp_prompt.md`.

**Deferred by design (open questions before code):**
28. `list_change` trigger (7 design questions — see `project_naavi_list_change_trigger_deferred.md`)
29. Health trigger (Epic integration required)
30. Price trigger (scraping complexity)
31. Phase 2 demo data

Prior handoffs for context: `docs/SESSION_HANDOFF_2026-05-06_STRUCTURED_OUTPUTS_V57.12.md`, `docs/SESSION_HANDOFF_2026-05-06_FIX_AAB.md`, `docs/SESSION_HANDOFF_CONTINUOUS_FIX_V57.8.md`.

**Then read memory files listed in the MEMORY.md index** — the short list that future sessions need (alert fan-out rule, verified-address rule, context fields pattern, location-trigger plan, feedback/test discipline).

**Older background:** `docs/SESSION_8_DETAILED_REPORT.md` for the early Twilio voice architecture; most of 9-19 are also in `docs/` for context.

Memory folder: `C:\Users\waela\.claude\projects\C--Users-waela-OneDrive-Desktop-Naavi\memory\`

### THE PROJECT — TWO PARTS

**Part 1: Mobile App (Android)**
- Expo React Native app
- Edit in: `C:\Users\waela\OneDrive\Desktop\Naavi` (main repo) — current active worktree varies, check with `git worktree list`
- Build from: `C:\Users\waela\naavi-mobile` (separate clone outside OneDrive — EAS fails inside OneDrive)
- Always use `--profile production` for AAB (Google Play — see "MUST USE GOOGLE PLAY" section)
- Always bump versionCode in `app.json` AND version text in `app/settings.tsx`
- Build sync is via `git merge`, NOT `cp -f` — see "HOW BUILDS WORK" for the correct workflow

**Part 2: Twilio Voice Call Server**
- Node.js server on Railway
- Code: `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server`
- GitHub: github.com/munk2207/naavi-voice-server (private, separate repo from mobile)
- Railway: naavi-voice-server-production.up.railway.app (auto-deploys from main branch)
- Twilio number: +1 249 523 5394
- Stack: Phone → Twilio → Deepgram STT → Claude → Deepgram TTS → Phone
- Railway env vars required: ANTHROPIC_API_KEY, DEEPGRAM_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
- Multi-user: caller phone → `user_settings.phone` lookup → user_id. Always pass `user_id` through to Edge Functions.

### BACKEND

- Supabase project: `hhgyppbxgmjrwdpdubcx`
- Deploy Edge Functions with: `--no-verify-jwt`
- Edge Functions handle: chat, calendar, gmail, contacts, WhatsApp, drive, travel time, TTS, knowledge, push notifications

### WEBSITE

- mynaavi.com — plain HTML + Vercel auto-deploy
- Files: `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website\my-naavi-site\`
- Favicon working on all pages (via shared.js)

### KEY ACCOUNTS

| Service | Console URL |
|---------|------------|
| Anthropic API | console.anthropic.com |
| Deepgram | console.deepgram.com |
| Twilio | console.twilio.com |
| Google Cloud | console.cloud.google.com (project: naavi-490516) |
| Supabase | supabase.com/dashboard/project/hhgyppbxgmjrwdpdubcx |
| Railway | railway.app |
| GitHub | github.com/munk2207 |
| Google Play | play.google.com/console |
| EAS (Expo) | expo.dev/accounts/waggan |

### MOBILE OAUTH — TWO LOCATIONS (MUST STAY IN SYNC)

- Web flow: `lib/calendar.ts` line 55-64
- Mobile flow: `lib/supabase.ts` line 45
- If you change one, change both. Build 88-89 failed because mobile was missing scopes.

### IMPORTANT SECURITY NOTE

The old Anthropic API key leaked in session 8 was deleted in session 9. A new key was created and set as Railway env var. No action needed.

### HOW BUILDS WORK (correct workflow as of build 91)

**NEVER use `cp -f` to sync files between repos.** This caused builds 83-90 to silently diverge from GitHub main because sync-by-copy skipped git entirely. Use git merge instead.

1. Edit code in the active worktree (check with `git worktree list`) or main repo
2. Commit changes in the main repo / worktree
3. Bump versionCode in `app.json` AND version text in `app/settings.tsx` — must match the next available Google Play versionCode (higher than anything uploaded)
4. Push to GitHub main: `git push origin main`
5. In `C:\Users\waela\naavi-mobile`: `git fetch origin && git merge origin/main`
6. Resolve any merge conflicts (usually version-bump files — keep the newer version)
7. `npm install` (picks up any package.json changes)
8. Build + auto-submit: `npx eas build --platform android --profile production --auto-submit --non-interactive`
   - `--auto-submit` builds the AAB AND pushes it to Google Play Internal Testing in one command (uses `submit.production.android` config in `eas.json`).
   - No manual download / upload step. Skips Chrome/Edge Safe Browsing warnings entirely.
9. Wait for the auto-submit step to finish (EAS prints a Play Console link).
10. User installs from Google Play on phone (Internal Testing track).

### MUST USE GOOGLE PLAY (not direct APK)

Google Sign-In requires the app to be signed with the certificate registered in Google Cloud OAuth. Direct-install APKs (EAS preview profile, sideload) are signed with a different key → Google refuses sign-in. Only AABs distributed through Google Play (Internal Testing or higher) get re-signed with the registered certificate.

Never suggest direct APK installs or preview builds for testing sign-in.

### HOW THE VOICE SERVER DEPLOYS

1. Edit code in `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server\src\index.js`
2. `git add -A && git commit -m "description" && git push origin main`
3. Railway auto-deploys from GitHub
4. Check Deploy Logs in Railway dashboard for errors

### WHAT THE USER CARES ABOUT

- Does it work on the phone?
- Can Robert use it hands-free?
- Is the contact saved?
- Did the message send?
- Does the voice call work?

He does NOT care about: code architecture explanations, npm internals, React lifecycle details, or why something is designed a certain way. He cares about results.

### VOICE CALL — NO SILENCE ALLOWED

Complete silence during processing or waiting makes the user feel the call dropped. A soft ticking sound MUST play during all silent gaps (between greeting and first input, during thinking/processing). Never remove or disable the thinking music without replacing it with another audio cue. If debugging call issues, keep the tick sound — it is a core UX requirement, not a nice-to-have.

### CLAUDE PROMPT — SHARED SOURCE OF TRUTH

The Naavi Claude system prompt lives in ONE place: the `get-naavi-prompt` Edge Function (`supabase/functions/get-naavi-prompt/index.ts`). Both the voice server and (eventually) the mobile app fetch the prompt from this function at session start.

**When adding/editing a RULE:**
1. Edit `supabase/functions/get-naavi-prompt/index.ts`
2. Deploy: `npx supabase functions deploy get-naavi-prompt --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx`
3. Voice server picks it up on next call automatically
4. Bump `PROMPT_VERSION` constant inside the function for change tracking

**Current wiring:**
- ✅ Voice server: fetches shared prompt, falls back to local `buildVoiceSystemPrompt` on error
- ✅ Mobile app: fetches shared prompt, falls back to local `buildSystemPrompt` on error
- Both surfaces append channel-specific context after the shared base (brief items, health, knowledge for mobile; calendar + knowledge for voice).

**Critical — when debugging prompt behavior:**
- Check Supabase deploy log for `get-naavi-prompt` — if the function is broken, BOTH surfaces fall back silently to their local copies, and behavior diverges from the Edge Function.
- Local fallbacks in `lib/naavi-client.ts::buildSystemPrompt` and `naavi-voice-server/src/index.js::buildVoiceSystemPrompt` MUST stay roughly in sync with the Edge Function — when rolling out big prompt changes, update both fallbacks too.

### RULE STORE — SINGLE SOURCE OF TRUTH

All trigger/action rules live in `action_rules` table. The legacy `email_watch_rules` table and `check-email-alerts` Edge Function have been retired.

- Writes: `naavi-chat` and `useOrchestrator` (mobile) insert into `action_rules` with `trigger_type='email'` for email alerts.
- Reads: `evaluate-rules` Edge Function (cron every minute) iterates `action_rules` and fires matching actions via `send-sms` / `send-email`.
- Trigger types shipped: `email`, `time`, `calendar`, `weather`, `contact_silence`, `location` (see `evaluate-rules` source + `project_naavi_alert_scope.md` memory for each trigger_config shape).
- Action types: `sms`, `whatsapp`, `email`.
- Trigger types deferred: `list_change` (7 design questions open — see `project_naavi_list_change_trigger_deferred.md`), `health` (Epic integration required), `price` (scraping complexity).

Do NOT reintroduce separate tables like `email_watch_rules`. Extend `action_rules` trigger types instead.

### LOCATION TRIGGER — VERIFIED-ADDRESS ONLY

Naavi never creates a location alert from a guessed address. An address must be EITHER already in memory from a prior conversation OR confirmed by the user in-conversation after readback. After 3 failed clarification attempts, Naavi says *"please check the exact location and call me back."*

- Resolution flow: `resolve-place` Edge Function → personal keyword lookup (`home`/`office` → `user_settings.home_address`/`.work_address`) → `user_places` cache → Google Places API (biased by reference coords). Only caches on `save_to_cache=true` (explicit user confirmation).
- On confirmation, save under BOTH aliases: the spoken name AND the Places-canonical name.
- Mobile orchestrator intercepts `SET_ACTION_RULE` for `trigger_type='location'` and runs the flow before writing the rule.
- OS-level geofencing via `hooks/useGeofencing.ts` + `Location.startGeofencingAsync` + `TaskManager.defineTask`.

Full design: `project_naavi_location_verified_address.md` + `project_naavi_location_trigger_plan.md` memory files.

### ALERT FAN-OUT — self-alerts always quadruple-channel

Every alert where the destination is the user themselves MUST fire on **all four** channels: SMS + WhatsApp + Email + Push. Third-party alerts (alerts sent to someone other than the user) fire on SMS + WhatsApp only because we don't have email/push tokens for non-users.

**Why:** SMS requires cell reception. A user on WiFi-only (traveling, international, weak signal) silently misses critical alerts. Multi-channel guarantees at least one path lands. Stability-over-cost applies — quadrupled messaging cost is acceptable; missed alerts are not.

**Where implemented:** `fireAction()` in `supabase/functions/evaluate-rules/index.ts` handles fan-out for `action_rules` triggers. `check-reminders` Edge Function does its own fan-out for the `reminders` table (currently SMS + WhatsApp + Push; email still to add).

**Self-alert detection:** `action_config.to_phone` matches user's `user_settings.phone` → self-alert. Otherwise → third-party.

**Graceful degradation:** missing phone/email/push token → skip that channel, fire the rest. Never block.

Do NOT add per-rule channel toggles. Channel choice is not a user preference — it's a reliability guarantee. Full design in `project_naavi_alert_fanout.md` memory.

### DRIVE STRUCTURE (Session 19 restructure)

Every file Naavi creates in the user's Google Drive lives under `MyNaavi/`:

```
MyNaavi/
├── Documents/    — email attachments, harvested into by-type subfolders
│   ├── invoice/, warranty/, receipt/, contract/, medical/,
│   ├── statement/, tax/, ticket/, notice/, calendar/, other/
├── Briefs/       — morning brief saves (missed morning calls)
├── Notes/        — SAVE_TO_DRIVE voice action + Drive Notes
├── Transcripts/  — voice-call recording summaries
└── Lists/        — voice-managed list Docs (mobile-side routing ships with next AAB)
```

`save-to-drive` accepts `category: 'transcript' | 'brief' | 'note' | 'list'` and lazily creates the subfolder on first use. Calling without `category` falls back to the legacy MyNaavi-root behaviour (backwards compatible).

**Every file written under `MyNaavi/*/` (except Lists) gets a row in `documents` with `source = category`** so Global Search's `drive` adapter covers them. Lists are excluded from `documents` because the `lists` table + `lists` adapter already cover them.

### DOCUMENT TYPES (email_actions + documents, 11 values)

`invoice | warranty | receipt | contract | medical | statement | tax | ticket | notice | calendar | other`

- `invoice` — bill awaiting payment.
- `receipt` — proof of payment completed.
- `warranty` — coverage with an expiry date.
- `contract` — signed agreement.
- `medical` — lab result, prescription, referral.
- `statement` — monthly account summary (bank, credit card, utility).
- `tax` — T4, CRA correspondence, tax-year document.
- `ticket` — travel or event ticket, boarding pass.
- `notice` — government or institutional notice (gov.ca, condo AGM).
- `calendar` — recurring schedule listing many dated events (school year, sports season).
- `other` — documentary but none of the above.

When `extract-email-actions` or `extract-document-text` run, Claude Haiku classifies and stores this on the row. `harvest-attachment` uses it to pick the destination folder. `extract-document-text` also moves the Drive file to the correct `Documents/<type>/` subfolder when content-based classification differs from the harvest-time guess (classify-once rule: only reclassifies if current type is `other` or NULL).

### GLOBAL SEARCH — 10 adapters (all covered)

Every content repo Robert has is searchable via `global-search` Edge Function:

- `knowledge` — REMEMBER items, pgvector embeddings (identifier-shape queries skip this)
- `rules` — `action_rules`
- `sent_messages` — SMS / WhatsApp / email Naavi sent
- `contacts` — Google People API (live, not the local `contacts` table)
- `lists` — `lists` table + Drive doc item search
- `calendar` — Google Calendar API (live, reads ALL user calendars including subscribed external ones)
- `gmail` — tier-1 only, `ambient` signal_strength excluded
- `email_actions` — structured actions Claude extracted (bills, appointments, renewals, etc.)
- `drive` — hybrid: `documents` table (harvested, rich metadata) + Google Drive live `fullText`
- `reminders` — one-off time-based reminders (added Session 19; was the last gap)

Query normalization happens at the handler level via `query_expansion.ts::expandQuery`: lowercase, plural/singular stemming (`payments` → `payment`), synonym map (bill→pay, meeting→appointment, doctor→appointment, invoice→pay, etc.), and email-username expansion (`david@gmail.com` also searches `david`). ILIKE adapters receive a `queryVariants: string[]` and match ANY variant. Calendar and knowledge adapters use their own morphology (Google `q=`, embeddings).

### ATTACHMENT + OCR PIPELINE (harvest → extract → classify → route)

New in Session 19, all server-side, no AAB:

1. **`sync-gmail`** syncs tier-1 emails (7-day window, 100 msgs, 3000-char body cap, 3-tier `signal_strength`).
2. **Fire-and-forget to `extract-email-actions`** — Haiku classifies action_type AND document_type/reference/expiry.
3. **Fire-and-forget to `harvest-attachment`** — downloads PDF/JPG/PNG/DOCX/XLSX (10 KB – 25 MB range; signature-image filter skips `imageNNN.*` pattern + images < 100 KB), uploads to `MyNaavi/Documents/<type>/`, writes `documents` row with idempotency guard on `(user_id, gmail_message_id, file_name)`.
4. **Fire-and-forget to `extract-document-text`** — for PDFs: Claude Haiku reads text layer directly. For scanned PDFs or JPG/PNG images: Google Vision `DOCUMENT_TEXT_DETECTION` → Haiku classifies. Saves `extracted_summary`, `extracted_*` fields, and `extracted_text` + `ocr_sidecar_drive_file_id` when Vision ran. Sidecar `.ocr.txt` file uploaded to same Drive folder as the source.
5. **Classify-once folder routing** — if content-type classification differs from harvest-time guess and current type is `other`/NULL, the Drive file moves to the correct `Documents/<type>/` subfolder.

`GOOGLE_VISION_API_KEY` is a Supabase secret. `_shared/institutional_domains.ts` is a curated list of trusted Canadian domains used by `sync-gmail` for tier-1 classification.

### MULTI-USER ARCHITECTURE (do not break)

Voice server resolves user by caller phone:
- `+16137697957` → wael.aggan@gmail.com (user_id `788fe85c-b6be-4506-87e8-a8736ec8e1d1`) = "Wael"
- `+13435750023` → heaggan@gmail.com (user_id `381b0833-fe74-410a-8574-d0d750a03b3b`) = "Huss"

Name lookup: `user_settings.name` (synced from mobile app's Settings → Your Name field)
Phone lookup: `user_settings.phone`

Edge Functions that accept `user_id` from request body (multi-user safe):
- `create-calendar-event`, `ingest-note`, `search-knowledge`, `manage-list`, `lookup-contact`, `naavi-chat`

Never add a new Edge Function that picks "first user" from a shared table. Always:
1. Try JWT auth (mobile app)
2. Accept `user_id` from request body (voice server)
3. Fall back to `user_tokens` lookup (single-user apps only)

### SUPABASE CLIENT AUTH CONFIG (REQUIRED)

The mobile Supabase client MUST be created with explicit auth options on React Native:
- `storage: AsyncStorage` — persists the session across app restarts
- `autoRefreshToken: true` — keeps JWT fresh
- `persistSession: true` — survives backgrounding
- `AppState` listener calling `supabase.auth.startAutoRefresh()` on foreground, `stopAutoRefresh()` on background

Without this config, the session lives in memory only; the refresh timer can die when the app backgrounds; after ~1 hour the JWT expires silently; `supabase.functions.invoke()` fails — including `text-to-speech`. Users see this as "voice stops working mid-session, only logout/login restores it." Shipped in V54.2 build 103.

See `lib/supabase.ts` for the canonical pattern.
