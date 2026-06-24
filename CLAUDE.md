# CLAUDE.md — MyNaavi Project Instructions

## ⭐⭐⭐⭐ STAGING-FIRST — ALL DEV WORK GOES TO STAGING, NEVER PRODUCTION (Wael 2026-06-20)

**Two Supabase projects exist. Default is ALWAYS staging. Production is read-only unless Wael explicitly says "deploy to production."**

| Environment | Supabase project ref | App package | App name |
|---|---|---|---|
| **Staging** | `xugvnfudofuskxoknhve` | `ca.naavi.app.staging` | Naavi Staging |
| **Production** | `hhgyppbxgmjrwdpdubcx` | `ca.naavi.app` | Naavi |

**Rules:**
1. Every new feature, fix, or experiment goes to staging first — Edge Functions, migrations, app builds, prompt changes.
2. Edge Function deploy command for staging: `npx supabase functions deploy <name> --no-verify-jwt --project-ref xugvnfudofuskxoknhve`
3. App build command for staging: `eas build --profile staging` (produces APK named "Naavi Staging", package `ca.naavi.app.staging`)
4. Migration push for staging: `npx supabase db push --db-url "postgresql://postgres.xugvnfudofuskxoknhve:NaaviStaging2026@aws-1-us-east-1.pooler.supabase.com:6543/postgres?prefer_simple_protocol=true" --include-all --yes`
5. Only promote to production after Wael confirms staging works and explicitly says "deploy to production."
6. Production deploy = standard commands with `--project-ref hhgyppbxgmjrwdpdubcx` and `eas build --profile production`.
7. **NEVER run `eas build --profile production` or deploy to `hhgyppbxgmjrwdpdubcx` without the exact phrase "deploy to production" from Wael.**

**Why this rule exists:** 2026-06-20 — a small cosmetic change in a stable product broke major functionality. Full environment isolation ensures production is never touched until staging proves the change is safe. Cost of a staging build is nothing; cost of a broken production build is user trust.

---

## ⭐⭐⭐ FIVE LEVERS WAEL USES TO BREAK YOUR CORNER-CUTTING (Wael 2026-05-15)

When Wael says any of these, drop your current framing and execute the lever's intent. These are corrective signals — he's caught you anchoring on a stale framing, reaching for the easy story, or producing plausible-fluent output instead of investigated output. Do NOT argue. Do NOT defend the prior framing. Execute.

1. **"Investigate before recommending."** Stop the recommendation in flight. Launch an investigator (sub-agent or focused code/web search) and find the technical root cause first. The 2026-05-15 version that worked: *"Go investigate why the APK is failing, irrespective of Transistorsoft."* This single phrase saved $399.

2. **"Paste the evidence, not your paraphrase."** Replace every paraphrased claim with the actual source — `file:line`, the literal error message, the doc quote, the log line. If you can't find a source, say so explicitly instead of producing a confident-sounding summary.

3. **"Was that an observation or an inference?"** Re-read your last message. Split it: observations are things you directly read in tool output (file contents, command stdout, error messages). Inferences are extrapolations, pattern-matches, plausibility guesses. Label each claim accordingly.

4. **"What would you say if [X] were off the table?"** A constraint just got added — drop X and redo the analysis. Typical X values: money, paying for a license, switching vendors, abandoning a library. The constraint forces you off the lazy path.

5. **"My test [failed / passed] — find what's wrong/right in the code."** Wael's end-of-test verdict is ground truth. Don't second-guess his methodology or propose tighter test setups. Investigate the code from his result outward.

**The pattern these break:** training optimizes this model toward plausible-confident output, not investigated-rigorous output. These five phrases are the corrective force. Do not negotiate with them. Execute.

**Pattern Wael uses BEFORE any spend or significant time commit:** *"What's the technical root cause we're working around?"* If you can't answer with file paths, line numbers, or specific error messages, you haven't done the investigation — and the spend should not happen yet.

## ⭐⭐⭐ BUILD/DEPLOY DIAGNOSIS RULES — COST DISCIPLINE (Wael 2026-06-11)

**Context that earned these rules:** 2026-06-11 — 8 consecutive EAS build failures from one misdiagnosed root cause. Each failed build consumed ~20 min + tokens investigating the wrong hypothesis. Total cost: ~4× what a correct first diagnosis would have cost. Wael pays for every LLM mistake directly.

**Rule A — Mandatory pre-diagnosis checklist before ANY build fix.**
Before touching any build error, I MUST be able to answer all three:
1. Which exact file is failing?
2. Which exact line / task / function?
3. What is the literal error message (copy-pasted, not paraphrased)?

If I cannot answer all three from direct evidence in the logs — I do NOT propose a fix yet. I go get the evidence first. "The Gradle task failed" is not an answer. "`:app:createReleaseUpdatesResources` failed at `createManifestForBuildAsync.js:47` with `Error: resource /home/expo/workingdir/build/index was not found`" is an answer.

**Rule B — 2-hypothesis cap before stopping to reframe.**
If two consecutive fix attempts on the same problem both fail, I MUST stop and explicitly state:
- What evidence I have
- What evidence is still missing
- What I would need to see to be confident in the next hypothesis

I do NOT attempt a third hypothesis until Wael acknowledges the reframe. "Let me try one more thing" after two failures is the pattern that burned 8 builds. The cap is enforced regardless of how plausible the next hypothesis seems.

**Why these rules exist:** Every failed build = ~20 min + real money. An incorrect confident hypothesis costs more than admitting uncertainty and investigating further. Saying "I don't know yet, here's what I need to find out" is always cheaper than a wrong fix.

## ⭐⭐⭐⭐ NEVER PUT UNVERIFIED CLAIMS IN ANY OUTBOUND MESSAGE TO A REAL USER (Wael 2026-05-20)

**Context that earned this rule:** 2026-05-20 — I drafted an SMS to Hussein saying *"your Google account got disconnected from Naavi"* based on ONE error message from a single API call plus a 3-day-old log note. I had **zero evidence Hussein took any disconnection action**. He hadn't. I conflated my inference into a confident factual claim about HIS behavior and was about to send it to him. Wael caught it. If he hadn't, Hussein would have read a false accusation about himself signed *"— Wael"*, and trust in Naavi / Wael would have eroded for no good reason. **The damage is reputational, not technical.**

**The rule:** Every assertion in any outbound message — SMS, email, push notification, voice call body, social post, support reply — must trace to direct, current evidence. If you can't trace it, you can't write it. Default to LESS specificity over MORE when stakes touch a real user's perception of Naavi / Wael / the team.

**How to apply:**

1. **Before drafting an outbound message, list every factual claim you intend to make.** For each claim, name the SPECIFIC evidence: which DB row, which log line, which user statement, which Twilio webhook payload. If the answer is *"I inferred it from X"*, the claim is NOT verified — rewrite or drop.

2. **Specifically watch for claims about what the USER did or chose.** *"You disconnected"*, *"You changed"*, *"You stopped"*, *"You revoked"* — these accuse the user of an action. Never write them unless you have a log row showing them performing that action. Reframe to neutral observations of state: *"Naavi's connection to your account isn't working — here's how to restore it."*

3. **Prefer the action over the diagnosis.** Tell the user the EXACT step to take (*"open Settings → reconnect Google"*), and skip the why if you can't verify the why. The user doesn't need the diagnosis; the user needs the fix.

4. **If you don't know the cause, say "we don't know yet" — don't invent one.** Naavi / Wael's reputation rests on truthful messages. A *"we don't know the cause yet but here's how to restore it"* message earns trust. A confident-but-wrong message destroys it.

5. **Treat draft messages as serious even when Wael will review them.** A draft framed as plausible-fluent will get reviewed less carefully than a draft framed as cautious. Don't outsource verification to the reviewer.

**Triggers this rule fires on:**
- Any message bound for `send-sms`, `send-user-email`, `send-push-notification`, Naavi's voice call body, public web copy, GitHub PR description, EAS support ticket — anything that leaves our walls.
- Anything signed *"— Naavi"* or *"— Wael"* or implying authorship from inside the team.
- Internal diagnostic narratives in chat are NOT subject to this rule (we can speculate together), but the moment you draft text bound for an external party, the bar shifts.

**Sister rules:** 5-levers #2 (*"Paste the evidence, not your paraphrase"*) and #3 (*"Was that an observation or an inference?"*). This rule extends them to outbound messages specifically, where the cost of getting it wrong lands on a real person reading a confident-sounding lie.

## ⭐⭐⭐ ALWAYS DISPLAY TIMES IN EST, NEVER UTC (Wael 2026-05-20)

Every timestamp Wael sees — in conversation, in diagnostic output, in commit messages, in log lines copy-pasted back to him — must be in **Eastern Time (America/Toronto)** and labeled **EST** (the spoken name Wael uses regardless of DST). Never show raw UTC. UTC is fine inside DB columns and code; it's user-facing display that must be EST.

How to apply:
- In Node / SQL diagnostic scripts: convert `created_at` / `sent_at` / `fired_at` / `last_event_at` (and every other timestamp column) to America/Toronto before printing. The script's `.toLocaleString('en-CA', { timeZone: 'America/Toronto' })` is the safe path.
- When citing log entries in conversation: restate the time in EST. Don't quote a UTC timestamp from the raw log and ask Wael to mentally convert.
- When a fact in your reply hinges on a time ("rule fired at X"), express X in EST and add the date so there's no ambiguity.
- If the source data's timezone is unclear, ask once and label clearly thereafter.

Examples:
- Wrong: *"rule fired at 2026-05-20 12:50 UTC"*
- Right: *"rule fired at 2026-05-20 8:50 AM EST"*

This rule exists because Wael lives in EST. Forcing him to convert UTC every time he reads diagnostic output is friction with no upside.

Memory: `feedback_investigate_before_paying.md` (2026-05-15 origin incident).

---

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

### MOBILE = CONVERSATION. WEB = MANAGEMENT. (Wael 2026-05-30)

**The principle:** The mobile app is a conversation and quick-action surface. The web is the management workspace. These are two distinct roles — never collapse them into one.

**Mobile shows:** A summary of what exists (count, last item, status). Enough for Robert to act by voice. Nothing that requires scrolling through a long list to manage.

**Web handles:** Everything that grows over time and requires review, editing, reordering, deleting, or configuring. Alerts list, lists contents, notes/memories, settings — all of it.

**The reference implementation already exists:** The Help section opens a web page from inside the app today. Every management screen follows the same pattern — Robert taps a button in the app, a fully authenticated WebView opens. He never sees a URL. He never logs in separately. From his perspective it is just a bigger screen.

**How to classify any new feature:**
- Is this something Robert says or asks? → Mobile (conversation).
- Is this something Robert reviews, edits, or configures? → Web (management).
- Does this screen grow unbounded as Robert uses the product? → Web.
- Does this screen answer one specific question and close? → Mobile.

**What this means for existing screens:**
- Three-dot menu items (Alerts, Lists, Notes) → WebView launches, not native screens.
- Native management screens are retired as web equivalents are built.
- Mobile settings keeps only: name, primary phone, PIN. Everything else → web settings page.
- New features that accumulate data over time must be designed web-first from day one.

**Do NOT build a new native management screen.** If you are about to create a new ScrollView with a list of items Robert can tap, delete, or edit — stop. That belongs on the web. Build the WebView path instead.

### AI CODING DISCIPLINE (Wael 2026-05-25)

Rules that are already covered elsewhere are NOT duplicated here — see CONFIGURATION DISCIPLINE (no duplicate config), CLAUDE PROMPT — SHARED SOURCE OF TRUTH (prompts in one place), and ABSOLUTE RULES 1–5 (explain before acting, stability over cost). This section adds what those don't cover.

**19. REFACTOR OVER LAYER.** When a fix or feature can be done by improving an existing file, do that — do not wrap it in a new service, helper, or abstraction layer. New abstractions must justify their existence. If the justification is "cleaner code" without a concrete problem it solves, the abstraction is not justified.

**20. REMOVE DEAD CODE.** Unused files, obsolete Edge Functions, retired tables, and commented-out logic must be deleted — not left "just in case." Dead code is maintenance cost with no upside. When retiring something, delete it and note the deletion in the commit message.

**21. NO SILENT FAILURES.** Every catch block must log enough context to diagnose the failure: which function, which input, what the error was. A bare `catch { /* ignore */ }` is only acceptable for non-critical teardown paths (tests, best-effort cleanup). Anywhere Naavi could silently stop working for a user — log it.

**22. FILES STAY FOCUSED.** If a file is doing two unrelated jobs, split it. If a function is longer than can be understood in one read, break it up. The test for "focused": can you describe what this file does in one sentence? If not, it needs splitting.

**23. COMPLEXITY TAX.** Before adding a feature that significantly increases system complexity (new table, new Edge Function, new background job, new dependency), explicitly state: what simpler alternative was considered and why it was ruled out. This is not a blocker — it is a forcing function to confirm the complexity is earned.

**What this section does NOT change:**
- Naavi is built on Anthropic Claude specifically. No provider-agnostic naming is required — `naavi-chat`, `get-naavi-prompt`, and `ANTHROPIC_API_KEY` are correct. Abstracting the AI layer would add complexity with no current benefit.
- Prompt management is already governed by CLAUDE PROMPT — SHARED SOURCE OF TRUTH.
- "Check before creating" is already in the CONFIGURATION DISCIPLINE checks table.

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

12. **EVERY STATE-CHANGING COMMITMENT REQUIRES PRE-CONFIRMATION + SPECIFIC POST-ACTION READBACK** (Wael 2026-05-24 — supersedes the prior internal-action carve-out, which let alerts/memory/calendar/reminders flow without confirmation and produced a fabricated email rule on Wael's account this session: *"Find McDonald alert"* → unauthorized email alert with subject_keyword "you", id `fbd024f8…`).

   **Pre-confirmation (mandatory):** Before Naavi commits to ANY state-changing action, Naavi MUST first state the intended commitment in past-tense-intent form and explicitly ask for confirmation:

   *"I'll [specific commitment, naming every resolved input]. Say yes to confirm, no to cancel, or tell me what to change."*

   AND wait for the user's response on a SEPARATE turn. Acceptable approvals: *"yes"*, *"yeah"*, *"yep"*, *"confirm"*, *"approved"*, *"go ahead"*, *"do it"*, *"please"*, *"ok"*. NOT acceptable: silence, *"sounds good"*, *"sure"*, or any ambiguous reply — Naavi re-asks the same confirmation question.

   **Post-action readback (mandatory):** After execution, Naavi MUST report completion with a SPECIFIC readback that REPEATS the exact commitment that was just implemented — so the user can verify Naavi acted on the correct interpretation and detect mis-resolutions immediately:

   *"Done. [Specific commitment that was just implemented, naming every resolved input that landed in the DB row]."*

   Examples:
   - *"Done. Alert set: emails from Bob (bob@example.com) will text you at +1 613 769 7957."*
   - *"Done. Saved that your wife is named Sarah."*
   - *"Done. Created calendar event 'Dentist' for Friday May 30 at 4 PM."*

   NOT acceptable: bare *"Done."* / *"Saved."* / *"Got it."* / *"Alert set."* — these create misunderstanding when the user can't verify what was actually committed. The post-action readback is the SECOND defense layer (after pre-confirmation): a user who said yes to the wrong interpretation gets a fresh chance to catch it from the readback.

   **Scope — actions requiring confirmation (state-changing):** SET_ACTION_RULE, SET_EMAIL_ALERT, SET_REMINDER, CREATE_EVENT, SCHEDULE_MEDICATION, UPDATE_MORNING_CALL, REMEMBER, ADD_CONTACT, SAVE_TO_DRIVE, DRAFT_MESSAGE, LIST_CREATE, LIST_ADD, LIST_REMOVE, LIST_CONNECT, LIST_DISCONNECT, LIST_DELETE, DELETE_RULE, DELETE_EVENT, DELETE_MEMORY, LOG_CONCERN, UPDATE_PROFILE — every action that creates or modifies a DB row OR sends to a third party.

   **Exempt — read-only:** GLOBAL_SEARCH, LIST_RULES, LIST_CONNECTION_QUERY, lookup-contact, calendar reads, knowledge searches. These do not change state and need no confirmation.

   **Unresolved-input gate stays in force:** if any input referenced in the action is unresolved (*"my wife"* without a known contact, a date without a year, a place not verified, a list/alert name with no match), the action is BLOCKED until the input is clarified by the user — never fall back silently, never guess, never default to the user's own phone/email.

   **Phase 1 enforcement (shipped 2026-05-24 — B4y):** server-side HAS_CREATE_INTENT regex gate in `naavi-chat::detectEmailAlert` + post-Claude validator for SET_EMAIL_ALERT / SET_ACTION_RULE(trigger=email) — drops the action when user message lacks an explicit create-intent phrase. Mobile + voice. Covers the demonstrated bug class but does NOT yet enforce the full confirm-then-act + readback policy across all state-changing actions.

   **Phase 2 enforcement (queued — B4z):** universal server-side confirm-then-act gate covering every action in the state-changing list above + `get-naavi-prompt` rule for specific readback + ~40-120 test-suite rewrites to match the 2-turn pattern. ~3-5 hours focused session. Rule 15 acknowledgment: AAB build blocked from start of Phase 2 work until auto-tester returns to 100% green.

13. **OFFER CHOICES AS NUMBERED LISTS, NEVER IN A SENTENCE.** Whenever you ask the user to pick between options, format them as a numbered list (1, 2, 3…) on separate lines. Never embed options in prose ("do you want X or Y?"). Applies to every choice, no matter how small. This is the precondition for Rule 14 — the user can only reply `# N` if the options were numbered.

14. **"# N" MEANS THE USER PICKED OPTION N.** When you offer numbered choices and the user replies with `# 2`, `# 5`, etc., the digit after the `#` is the option they chose. The user prefixes the hash because the chat interface auto-renumbers a bare number reply (typing just `2` can render as `1`). Always honor this convention literally — `# 2` = option 2, never something else, never ask what it means.

### ⭐⭐⭐ TWO-PHASE BUILD PROCESS (Wael 2026-06-21)

**Phase 1 — Iterative testing (staging APKs):** Build as many staging APKs as needed. NO gates required. No auto-tester, no voice regression, no Maestro, no Firebase. Just build and test on device. Keep iterating until Wael confirms the staging APK is approved.

**Phase 2 — Promote to production AAB:** Only when Wael explicitly says "approved — push to production." At that point, run the applicable gates (currently 1 and 2 — see suspensions below), then build the production AAB.

The gates below apply to Phase 2 ONLY — never to staging APK builds.

---

### FOUR TEST GATES — MANDATORY BEFORE EVERY PRODUCTION AAB (Wael 2026-06-19, updated 2026-06-21)

Every production AAB must pass all applicable gates in this exact order. Each covers a distinct layer the others cannot reach.

| Gate | Platform | What it tests | How to run |
|------|----------|---------------|------------|
| 1 | **Auto-tester** | Business logic, Edge Function behavior, prompt emissions, data integrity | `npm run test:auto` — must be 100% green |
| 2 | **Voice regression** | Voice server call flows, STT/TTS pipeline, Twilio webhook behavior | Run voice regression suite — all tests must pass |
| 3 | **Maestro** | Mobile UI flows on emulator (tap targets, screen transitions, accessibility labels) | `.\scripts\run-maestro.ps1` — all flows must pass |
| 4 | **Firebase Test Lab** | Hardware/OS compatibility on real physical devices (Pixel 6 Android 13, Samsung Galaxy S22 Android 14) | `node scripts/submit-firebase-test.js <apk-url>` — all devices must show ✅ in console |

**Why this order:** Gates 1 and 2 are server-side and require no build — run them first so a logic or voice error never costs a build. Gate 3 (Maestro) needs a preview APK on the emulator. Gate 4 (Firebase) uses the same APK but runs on cloud devices — most expensive, so last.

**Full pre-build gate sequence: (1) auto-tester green → (2) voice regression green → (3) Maestro green → (4) Firebase Test Lab PASSED → (5) production AAB.**

**Test account for all four gates:** `mynaavidemo@gmail.com` — no other account.

**Full pre-build gate sequence (production AAB only): (1) auto-tester green → (2) voice regression green → (3) Maestro green → (4) Firebase Test Lab PASSED → (5) production AAB.**

---

15. **⭐ `npm run test:auto` 100% GREEN IS A HARD PREREQUISITE TO EVERY PRODUCTION AAB** (Wael 2026-05-01; updated scope 2026-06-21). Applies to production AABs only — NOT to staging APKs built during iterative testing. See TWO-PHASE BUILD PROCESS above.

**The converse is equally binding for production:** *if for any reason the auto-tester is suspended, production AAB builds are also suspended.* Staging APK builds are unaffected. If you see a CLAUDE.md or memory entry claiming the auto-tester is "suspended", you do NOT proceed to a production AAB — you stop, surface the suspension, and wait for Wael to re-enable.

**15b. ⭐ FIREBASE TEST LAB IS A MANDATORY GATE BEFORE EVERY PRODUCTION AAB** (Wael 2026-05-29, hold lifted 2026-06-09). After `npm run test:auto` is 100% green and before `eas build --profile production`, the APK must be submitted to Firebase Test Lab. No exceptions.

**Hold lifted 2026-06-09** — end-to-end process established and verified: robo script fixed, pass/fail detection corrected, Blaze plan active (no daily quota). Full run confirmed ✅ PASSED on Pixel 6 (Android 13) + Samsung Galaxy S22 (Android 14).

**The process is fully automated — do NOT manually upload to Firebase Console:**
1. Get an APK — either:
   - Build a new preview APK: `eas build --profile preview` (from `C:\Users\waela\naavi-mobile`), OR
   - Use an existing local APK file (e.g. downloaded from EAS)
2. Submit to Firebase Test Lab: `node scripts/submit-firebase-test.js <url-or-local-path>`
   - Accepts EAS artifact URL, EAS build page URL, or a local file path
   - Uploads APK to GCS bucket `mynaavi-testlab-uploads` → submits test matrix
   - Devices: Pixel 6 (Android 13) + Samsung Galaxy S22 (Android 14)
   - Polls every 30 seconds; sends SMS to +1 613 769 7957 when done
3. **After receiving the SMS, ALWAYS verify the result directly in the Firebase Test Lab console: https://console.firebase.google.com/project/naavi-490516/testlab** — open the latest matrix and confirm ALL devices show ✅ (green checkmark). Do NOT trust the SMS alone. The SMS can say "PASSED" while the Test Lab page shows "2 devices failed." The Test Lab console result is ground truth.
4. Only proceed to production AAB if the Test Lab console shows ALL devices passed with no failures.
5. If any device shows ❌ FAILED — investigate and fix before building production

**Before running step 3:** update the GCS filename in `scripts/submit-firebase-test.js` to match the actual build version (currently hardcoded as `naavi-v205.apk`).

**⭐ ROBO SCRIPT RULE — WAITS ONLY, NO VIEW_CLICKED (2026-06-24):** `firebase/robo-script-onboarding.json` must contain ONLY `WAIT` actions. Never add `VIEW_CLICKED` or any element-tap action. Reason: scripted taps break every time the app changes (V290 removed the sign-in button; Samsung One UI uses different accessibility labels than Pixel). The script's only job is to pause long enough for auto sign-in to complete — Robo explores freely after that. If you see a `VIEW_CLICKED` in this file, remove it.

**The full pre-build gate sequence is documented in the "FOUR TEST GATES" section above.** Firebase is gate 4 of 4 — do not skip any gate before it.

15a. **⭐ EVERY NEW FUNCTIONALITY OR MODIFICATION MUST HAVE AN AUTO-TESTER TEST BEFORE MOVING ON** (Wael 2026-05-24). Sister rule to Rule 15. When Claude ships any new feature, fix, or modification to user-visible behavior or server-side code, Claude MUST add a corresponding regression test to `tests/catalogue/*.ts` and register it in `tests/runner.ts` so it runs as part of `npm run test:auto`. The test must lock in the new behavior (positive control) and/or guard against the prior buggy behavior (negative control), and must pass green before the work is considered done.

**Claude must NOT move on to a different functionality / fix / feature until the corresponding test exists, is registered, and passes.** No exceptions. The test catalogue grows with every shipped change.

**Exception path** — if the new behavior is genuinely impossible to test from the auto-tester (e.g., mobile-only client-side code the test harness can't reach, native module behavior, OS-level integrations), Claude MUST: (a) document the coverage gap in the test file's header with a clear "Coverage gaps acknowledged" section, (b) surface the gap to Wael explicitly in the session, and (c) get explicit approval to ship without the test before moving on to the next item. "Hard to test" is not the same as "impossible to test" — if Claude can mock + assert in any meaningful way, that's the bar.

**Why this rule exists:** Rule 15 (test:auto green before build) is a static bar; without Rule 15a it becomes a dead policy as the codebase grows past the test coverage. Together they form the live safety net — Rule 15 is the gate, Rule 15a is the obligation that keeps the gate meaningful. The 2026-05-24 session shipped B4f, B4x, B4y Phase 1, B3z, and storage fixes with the discipline applied; the resulting `tests/catalogue/session-2026-05-24.ts` (4 tests covering the demonstrated bug classes) is the canonical example of the shape.

16. **CROSS-SURFACE COMMIT DISCIPLINE — `parity-impact:` line on every user-facing surface change.** Established by Wael 2026-05-08. Every commit that changes user-facing behavior in `naavi-voice-server/`, `hooks/useOrchestrator.ts`, `app/`, `supabase/functions/naavi-chat/`, or `supabase/functions/get-naavi-prompt/` MUST include a `parity-impact:` line in the commit message body. Values: `voice=none` / `mobile=none` / `same-as-mobile` / `same-as-voice` / `both-shipped` / `TBD-needs-classification-entry`. Forces explicit cross-surface decision at the moment of change so voice and mobile can't silently drift. Example: `parity-impact: voice=TBD-needs-classification-entry — mobile-side fix; voice equivalent open as B?? for follow-up`. **Retires automatically once W2 (Anthropic Structured Outputs) + W3 (Voice Automated Regression Suite) from `docs/VOICE_COMPLETION_ROADMAP_2026-05-08.docx` land** — those automate drift detection at deploy time. Until then, this is the discipline.

17. **VALIDATE EVERY CLASSIFICATION ENTRY BY USER-FACING TEST BEFORE CODING A FIX.** Established by Wael 2026-05-08 after B1a (Voice live-calendar fetch) was tested and found not to reproduce — the classification entry's architectural read was correct about the code path but wrong about user-visible behavior. Before applying any fix from `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11`, run the user-facing test that would expose the bug. If the test doesn't reproduce the bug, **close the item** (move to "Closed without entry" with the reason and date) rather than fixing a phantom. The classification doc captures code-path reads, audit findings, and memory — all useful diagnostics but none guarantee the bug is currently user-visible. Same rule used to close Items 4 / 12 / 14 / B1a. Validation is the gate; do not propose tighter / weirder reproduction setups to make the bug appear after a clean test already showed it does not.

18. **⭐ NAAVI HAS NO AUTHORITY TO REFORMAT FACTS TO FIT HER OWN DB OR TECHNICAL CONSTRAINTS.** Established by Wael 2026-05-17 after the Victoria Day brief bug — Google sent an all-day event on May 18; Naavi's storage schema only held timestamps so the sync invented "midnight UTC May 18" → in Toronto that's 8 PM May 17 → the brief showed "Today — Victoria Day at 8 PM" while the user's own Google Calendar correctly showed it on May 18 all day. Naavi must present source data AS-IS. If the source says "all day, May 18", Naavi says "all day, May 18" — never converts it into a timed event to fit a column. If a multi-day event arrives, Naavi shows it as a date range — never splits it or picks a single day. If Naavi cannot represent a fact faithfully in her current data model, she does NOT display the fact at all (better to omit than to misrepresent). The bug class isn't "wrong timezone math" — it's "Naavi changed the truth to fit her storage shape," and every variant of that pattern is forbidden. Applies to: calendar events, contacts, addresses, messages, list items, every other external data source Naavi reads from.

19. **⭐ KEEP THE PARITY AUDIT LIVE — UPDATE IT WHEN ANY NEW CAPABILITY IS ADDED TO EITHER SURFACE.** The canonical parity doc is `docs/MOBILE_VS_VOICE_PARITY_AUDIT_2026-06-12.md`. Every time a new action, handler, or user-facing capability is added to mobile (`hooks/useOrchestrator.ts`, `app/index.tsx`) OR voice (`naavi-voice-server/src/index.js`), that doc MUST be updated in the same commit or session. Add the new row, set ✅/⚠️/❌ for each surface, and update the gap summary at the bottom. This is not optional — a stale parity doc is worse than no doc because it gives false confidence. If a gap is intentional (voice-only or mobile-only by design), note it in the "intentionally different" section. If it is a real gap, add it to the gap priority table.

### WHERE TO START

**Read first:** latest handoff in `docs/` (highest date in filename), then `MEMORY.md` index.

**Prompt-regression:** `tests/catalogue/prompt-regression.ts` locks in known-good Claude action emissions. Future prompt edits MUST keep this suite green. Never add a prompt rule without a corresponding regression test.

**Geofence is production-ready.** `android.permission.ACTIVITY_RECOGNITION` (Motion API) is required and confirmed working — Google's Health apps declaration was submitted and accepted 2026-05-26. Drive-tested daily by Wael with no issues. Promote to testers freely.

Memory folder: `C:\Users\waela\.claude\projects\C--Users-waela-OneDrive-Desktop-Naavi\memory\`

### HOLDING LIST — services/features in queue

**Single source of truth: `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`**
All open, closed, and deferred items live there. Do not maintain a duplicate list here — edit the doc directly.

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

### MUST USE GOOGLE PLAY (not direct APK) — for distribution to OTHER users

Google Sign-In requires the app to be signed with a certificate whose SHA-1 is registered in Google Cloud OAuth. Direct-install APKs (EAS preview profile, sideload) are signed with the EAS preview-build cert — which is a DIFFERENT key from the Google Play app-signing cert. For users WITHOUT that SHA-1 in OAuth, Sign-In fails on a sideloaded APK.

**Distribution rule:** Only ship to OTHER users (e.g. Robert, beta testers) via Google Play AAB. Their installs use Play's app-signing cert, which IS registered in OAuth — so Sign-In works.

**EXCEPTION — Wael's own testing on emulator AND real Samsung phone:** Wael has the EAS preview-build SHA-1 ALSO registered in Google Cloud OAuth. So preview APKs (`eas build --profile preview`) work for FULL Sign-In + OAuth + Google APIs on his devices — both emulator and his real Samsung phone. Empirically confirmed 2026-05-14 evening (sideloaded preview APK on Samsung after uninstalling Play Store version → Sign-In + Gmail + Calendar + Drive + Maps all green). See `feedback_apk_emulator_signin_works.md` for the full play-by-play.

**For Wael's iterative testing of native-module changes (Transistorsoft, custom geofencing libs, anything that needs a real device drive-test), use preview APK — no AAB cycle needed.** Steps for real-phone install:

1. `eas build --profile preview` produces an APK URL
2. Wael UNINSTALLS the existing Play Store version FIRST (cert-mismatch blocks "update over Play install"; the installer source label is sticky)
3. Wael downloads + installs the new APK (Drive / email / direct download)
4. Sign-In works because his local SHA-1 is OAuth-registered

**Never suggest direct APK installs for OTHER users** — only Wael has the registered SHA-1.

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

### VOICE ROLE SPLIT — TWO VOICES BY DESIGN (Wael 2026-05-17, updated 2026-05-19)

Naavi uses TWO distinct voices, each with a clear role. This is NOT inconsistency — it's deliberate role separation, analogous to a company spokesperson vs the actual product.

- **Andromeda — `aura-2-andromeda-en` — BRAND voice.** Used on every public-facing / outward presentation surface: home page hero narration, help / Discover section audio (`/discover/*`), blog article narration, marketing presentations, tutorial / explainer content. Andromeda is "Confident, Conversational" — the pacier Aura-2 voice. She represents Naavi to the world.

- **Hera — `aura-hera-en` — IN-APP personal voice.** Used everywhere a real user actually interacts with Naavi: mobile chat TTS, phone calls from registered users, PIN verification, voice biometric, every future voice feature. Hera is conversational, low-latency, battle-tested across the full spectrum of dynamic content (names, addresses, phone numbers, dates, multi-language). She IS Naavi for the user.

**Why two voices:** Wael 2026-05-17 — Aura-1 Hera is great for short conversational replies but rushed on longer narration; an Aura-2 storytelling voice is right for longer narration where pacing matters. Forcing one voice would compromise one role. Two voices, two clear roles, no overlap = no confusion.

**Cora retired 2026-05-19** — the original brand voice (Aura-2 Cora) was rated "too slow, too boring, could not continue listening" by Wael's friend-group A/B test on the homepage hero. Andromeda won the verdict and is now the brand voice across all website narration. The Cora→Andromeda swap covered all 16 site MP3s (home + 9 help-section + 6 blog). Cora stays in the Edge Function allowlist for backwards compatibility but is no longer used. Reference memory: `project_naavi_brand_voice_andromeda.md`.

**Rule for any new TTS code:** if it's content the END USER hears INSIDE the app or on a phone call from their own number, use Hera. If it's content explaining what Naavi does to someone evaluating / learning the product, use Andromeda.

**The demo line is an explicit exception case.** The 1-888-91-NAAVI public demo line runs on Polly Joanna (Twilio's built-in TTS) for instant playback — Deepgram fetch latency made any Aura voice unusable there (~8.6s for a 50-word menu prompt). Polly stays for the demo line indefinitely or until pre-baked static MP3s are wired in. See `project_naavi_demo_iheard_voice_deviation.md`.

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

### ALERT FAN-OUT — self-alerts default to all five channels; user can opt out per channel

Every alert where the destination is the user themselves DEFAULTS to firing on **all five** channels: SMS + WhatsApp + Email + Push + Voice Call (voice call only for location-arrival alerts — see below). Users can opt out of any individual channel via Settings (F2g, shipped 2026-05-21). The choice is **per-user, not per-rule** — per-rule channel toggles remain forbidden.

Third-party alerts (sent to someone other than the user) fire on SMS + WhatsApp only — same as before. The user's per-channel preferences do NOT affect what gets sent to third parties; preferences govern alerts the user themselves receives.

**Why the default is still all-on:** SMS requires cell reception. A user on WiFi-only (traveling, international, weak signal) silently misses critical alerts. Multi-channel default guarantees at least one path lands for users who never visit Settings. Stability-over-cost applies for the default — quadrupled messaging cost is acceptable when the user hasn't expressed a preference. Users who explicitly disable a channel are knowingly accepting that they may miss alerts on that channel; this is a user choice, not a system failure.

**At-least-one floor:** the `user_settings_alert_channels_at_least_one` CHECK constraint on `user_settings.alert_channels_enabled` (TEXT[]) prevents a user from disabling ALL channels. Mobile UI should also prevent disabling the last enabled channel for clear UX.

**Where implemented:** `fireAction()` in `supabase/functions/evaluate-rules/index.ts` reads `user_settings.alert_channels_enabled` and gates each channel send. `check-reminders` Edge Function does its own fan-out for the `reminders` table (currently SMS + WhatsApp + Push; email still to add; not yet wired to the per-user preference — to do in F2g Phase 1 follow-up).

**Self-alert detection:** `action_config.to_phone` matches user's `user_settings.phone` → self-alert (apply preferences). Otherwise → third-party (preferences NOT applied, full fan-out to third party).

**Voice call (channel #5):** outbound voice call via Twilio, only fires for `trigger_type='location' AND direction='arrive'` self-alerts. Cost ~$0.02/call; the rationale is "phone ringing reaches a driver parking at Costco; visual channels don't." Stays gated by the same per-user `voice_call` preference.

**Graceful degradation:** missing phone/email/push token → skip that channel, fire the rest. Never block. Same as before.

**Do NOT add per-rule channel toggles.** Channel choice is a per-USER preference. Per-rule customization adds combinatorial complexity for no real-world use case (verified 2026-05-21).

Full design + memory: `project_naavi_alert_fanout.md` (needs update to reflect 2026-05-21 per-user opt-out design).

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
