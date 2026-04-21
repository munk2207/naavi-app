# CLAUDE.md — MyNaavi Project Instructions

## READ THIS FIRST — EVERY SESSION

You are working on MyNaavi, an AI life orchestration companion for active seniors. The founder (Wael) is non-technical. He builds the product vision; you build the code.

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

### WHERE TO START

Read `project_naavi_active_bugs.md` in the memory folder FIRST. It has the current build state, what's working, what's broken, and what to do next.

Memory folder: `C:\Users\waela\.claude\projects\C--Users-waela-OneDrive-Desktop-Naavi\memory\`

Detailed session reports: `C:\Users\waela\OneDrive\Desktop\Naavi\docs\` (SESSION_8_DETAILED_REPORT.md, SESSION_9 info in memory)

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
8. Build: `npx eas build --platform android --profile production --non-interactive`
9. Download the AAB when EAS finishes
10. Upload AAB to Google Play Console → Internal Testing
11. User installs from Google Play on phone

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

This system is built for a senior citizen. Complete silence during processing or waiting makes him feel the call dropped. A soft ticking sound MUST play during all silent gaps (between greeting and first input, during thinking/processing). Never remove or disable the thinking music without replacing it with another audio cue. If debugging call issues, keep the tick sound — it is a core UX requirement, not a nice-to-have.

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
- Trigger types: `email`, `time`, `calendar`, `weather` (see `evaluate-rules` source for trigger_config shape).
- Action types: `sms`, `whatsapp`, `email`.

Do NOT reintroduce separate tables like `email_watch_rules`. Extend `action_rules` trigger types instead.

### ALERT FAN-OUT — self-alerts always quadruple-channel

Every alert where the destination is the user themselves MUST fire on **all four** channels: SMS + WhatsApp + Email + Push. Third-party alerts (alerts sent to someone other than the user) fire on SMS + WhatsApp only because we don't have email/push tokens for non-users.

**Why:** SMS requires cell reception. A senior on WiFi-only (traveling, international, weak signal) silently misses critical alerts. Multi-channel guarantees at least one path lands. Stability-over-cost applies — quadrupled messaging cost is acceptable; missed alerts are not.

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
