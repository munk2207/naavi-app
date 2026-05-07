# CLAUDE.md — MyNaavi Project Instructions

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
- `user_places` — V57.13.1, migration `20260507_user_places_integrity.sql`. Reference implementation.

**Tables that still need this audit (work for future sessions):**
- `action_rules` — has `(user_id, alias)` style constraints, hasn't been audited for the four-layer pattern
- `contacts` — same status
- `lists` — same status
- `reminders` — same status
- `user_settings` — single-row-per-user, lower risk but still worth auditing

### CACHE IS A SUGGESTION, NEVER AN ANSWER (V57.13.2)

**Wael 2026-05-07 — established as a hard rule after the Toronto-McDonald's example.** A cache HIT must never silently shadow fresh discovery. The cache is a performance optimization, not a decision. If a cache row is good, ASK the user to confirm it; if they say no, fall through to fresh search.

**Rule for any cache that backs user-facing decisions (locations, contacts, etc.):**

1. **0 cache rows for the query → go fresh.** Standard.
2. **1+ qualified cache rows for the query → return them flagged as a SUGGESTION, not as the answer.** The application asks: *"I have X you used before. Use this one, or search for another?"*
3. **User says "use this" → commit the cached row.**
4. **User says "search for another" → re-issue the lookup with `force_fresh=true` to skip the cache and present fresh results.**

**"Qualified" filter:** any data Naavi presents to the user MUST be fully qualified — every field a UI / TTS surface needs to render meaningfully must be populated. This applies **regardless of source** (cache, Google Places, Claude, Gmail, Drive, Calendar, contacts, etc.). Wael 2026-05-07: *"Naavi MUST not answer Robert with anything not fully qualified, irrespective of where it received."*

For each source:
- **Cache (user_places, contacts, etc.)** — exclude unqualified rows from any picker; **delete them on encounter** (an unqualified row that lingers blocks future qualified writes at the same logical key, e.g. the `user_places_unique_rounded_coords_idx` would reject a fresh INSERT at the same coords as an existing NULL-address row).
- **Google Places fresh results** — `isSpecificResult` rejects rows missing `formatted_address`. Single-result returns require it; multi-result pickers filter it out.
- **Other Edge Functions and external APIs** — apply the same rule when they're added: every response that flows to the user is checked for required fields BEFORE being surfaced.

**Where this lives in code today:**
- `supabase/functions/resolve-place/index.ts` v4 — `status: 'memory_suggest'` response, `force_fresh: boolean` request flag, qualified-row filter
- `hooks/useOrchestrator.ts` — handles `memory_suggest` by storing pending state with `candidatesSource: 'memory_suggest'`, prompts user, accepts `yes`/`use this`/number-pick or `search`/`another`/`no` to trigger force_fresh re-call
- `tests/catalogue/data-integrity.ts` — `integrity.memory-suggest-on-bare-brand`, `integrity.force-fresh-skips-memory`, `integrity.unqualified-rows-ignored`

**Personal-keyword shortcuts (`home` / `office` / `my-house` etc.) are exempt** — those are explicit pet-name aliases the user defined; instant-commit is the right behavior.

**Pre-commit checklist before introducing any new cache table:**
- Does a cache hit ASK the user for confirmation (not silently commit)?
- Is there a `force_fresh` (or equivalent) escape that bypasses the cache?
- Does the qualified-row filter exclude rows missing required display fields?
- Are there tests covering all three of the above?

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

### WHERE TO START

**Most recent handoff:** `docs/SESSION_HANDOFF_2026-05-06_STRUCTURED_OUTPUTS_V57.12.md` — **READ THIS FIRST**. Session 2026-05-06 (afternoon) that shipped the **Anthropic Structured Outputs migration** end-to-end (Phases 1-5) → V57.12.0 build 151 on Wael's phone. Auto-tester reached **52/0/0/0 — first clean run of the project**. Walmart + Tim Hortons regression tests now pass via enum-constrained `set_location_rule_chain` tool. ~200 lines of band-aid code deleted from the orchestrator. Voice server (Railway) migrated in parallel. One functional regression found post-install (picker addresses — pre-existing data/schema gap) queued as #1 for next session. Prior handoff (V57.11.4 → V57.11.8): `docs/SESSION_HANDOFF_2026-05-06_FIX_AAB.md`.

**Top of next session — V57.11.9 bundle (priority order):**

1. **Anthropic Structured Outputs migration** — research-agent recommendation backed by Anthropic's Nov 2025 GA docs. Replace JSON-in-prompt with schema-constrained generation. Removes the chain-store auto-fix bridge cleanly. ~1 day focused session, ~10-file blast radius. Detailed plan in the handoff doc.

2. **Bubble truncation (Bug 4) — different angle.** Six layout attempts have failed (all logged in handoff doc). Pick ONE: (a) `lineHeight: 24` → `lineHeight: 20` for ratio 1.33 (matches react-native #35039 resolution), or (b) replace `<Text>` in ConversationBubble with `react-native-markdown-display`. **Do NOT make a 7th layout tweak.**

3. **LIST_RULES synthesize-action backstop** — current backstop overrides speech but doesn't push a LIST_RULES action onto `actions[]`. Fix in same pattern as the chain-store auto-fix.

4. **Verified-address rejection — name the address** — replace generic "I can't confirm that address" with "I can't confirm '<destination>' for your meeting today."

5. **Stop button visibility during streaming** — V57.11.8 absolute positioning didn't hold. Investigate with status-transition remoteLogs first; fix evidence-based.

6. **Haptic — VIBRATE permission + duration** — confirm permission in `app.json`, bump `Vibration.vibrate(80)` → `150` or pattern `[0,100,50,100]`.

7. **Voice server chain-store mirror** — voice surface still hits Bug 11. Defer if Structured Outputs lands first (cleans up the need entirely).

**Pending blocked:** Picovoice Eagle (approval), Polly Joanna (AWS account), Maestro full-suite (emulator Internal Testing install), Geofence reliability (phone reboot pending), Phase 2 demo data.

**Last AAB on Wael's phone:** V57.12.0 build 151, installed 2026-05-06.
**Last AAB on Robert's phone:** V56.6 (build 115), installed 2026-04-28. **Do NOT promote V57.x to Robert until geofence reliability is proven on Wael's phone.**

**Prompt-regression test suite** (NEW this session): `tests/catalogue/prompt-regression.ts` — 8 tests wired into `npm run test:auto`. Locks in known-good Claude action emissions. **Future prompt edits MUST keep this suite green.** Don't add a prompt rule without a corresponding regression test — that's how the v57→v58→v59 cycle started.

**Strategic positioning** (Wael 2026-05-05): "senior" / "caregiver" / "elderly" / "active aging" are BANNED across all surfaces (code, prompts, docs, memory). The app is for EVERYONE. Use "user" by default; "older healthy independent adult" only when context demands. See top of this file.

**Server-side state at session end:**
- Prompt version live: `2026-05-06-v59-attendee-scope-and-chain-reemphasis`
- `naavi-chat`: live calendar fetch with Cache-Control: no-cache (V57.11.6)
- `resolve-place`: bare-brand multi-result + lat/lng dedupe (V57.11.6)
- `client_diagnostics`: RLS enabled (V57.11.7 hotfix); `search_knowledge_fragments` search_path locked
- `text-to-speech`: address-suffix expander (Dr→Drive); postal code letter phonetics
- `send-push-notification`: auto-prunes stale FCM tokens

**Auto-tester (latest):** 50 ✓ / 0 ✗ / 2 skipped. Run with `npm run test:auto`. Includes new `tests/catalogue/prompt-regression.ts` (8 tests). Multi-user matrix in `tests/catalogue/multiuser.ts`.

**Current Claude prompt version:** `2026-05-06-v59-attendee-scope-and-chain-reemphasis` (via `get-naavi-prompt` Edge Function).

Prior handoffs for context: `docs/SESSION_HANDOFF_CONTINUOUS_FIX_V57.8.md`, `docs/SESSION_25_HANDOFF.md`, `docs/SESSION_22_HANDOFF.md`.

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
