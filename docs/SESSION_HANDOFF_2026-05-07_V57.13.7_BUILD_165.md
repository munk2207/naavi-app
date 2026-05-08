# Session Handoff — 2026-05-07 — V57.13.7 build 165

**Read this first if you're picking up where this session left off. Pair with `CLAUDE.md` at the repo root (project rules, banned terms, build/deploy workflow).**

## Where you are right now

- **Latest build on Wael's phone AND emulator:** V57.13.7 **build 165** (Internal Testing on phone, side-loaded APK on emulator)
- **Auto-tester:** 55 ✓ / 0 ✗ / 0 errored / 0 skipped — green pre-build per Rule 15
- **Prompt version live:** **v64** — `2026-05-07-v64-no-minimum-reminder-delay` (unchanged this session)
- **Claude prompt source of truth:** `supabase/functions/get-naavi-prompt/index.ts`
- **Active branch:** `main` (everything pushed); worktree `claude/compassionate-elion-6c01ca` is at the same commit as `origin/main`

## Headline outcome

This session ran the V57.13 series — seven builds (159 → 160 → 161 → 162 → 163 → 164 → 165) — with two structurally important wins:

1. **No-cache architecture (V57.13.3).** `user_places` table dropped entirely. `resolve-place` v5 hits Google Places fresh on every request. `action_rules` absorbs "saved places" via a partial UNIQUE index on rounded coords. Net deletion: ~806 lines. The class of bugs the cache produced (Toronto-shadows-Ottawa, qualified-vs-unqualified, alias-merge edge cases) is gone by construction.
2. **Bubble truncation fix shipped (V57.13.7).** Six prior layout attempts failed against Samsung One UI's Yoga intrinsic-width bug. Option #3 (two-layer overlay: ruler Text drives bubble size, user content rendered absolutely on top) lands the user content correctly on actual Samsung One UI. **Verified on phone + emulator end of session.** A cosmetic leftover (ruler invisible portion shows dimly on long-wrap) was deferred to next AAB at Wael's call.

## Build timeline this session

| Build | Marker | Highlights |
|-------|--------|------------|
| 159 | V57.13.0 | (intermediate) |
| 160 | V57.13.2 | (intermediate) |
| 161 | V57.13.3 | **Drop `user_places` cache. Action_rules absorbs saved places. resolve-place v5.** |
| 162 | V57.13.4 | Show address on every location-alert surface (alerts list / WHEN / in-chat card) |
| 163 | V57.13.5 | Fix Stop button hidden during long TTS replies (V57.9.3 stuck-state safety net was force-resetting status to idle while audio still playing) |
| 164 | V57.13.6 | Bubble truncation attempt #1: always-pad with visible trailing dots — Samsung Yoga still trimmed past dots in some cases |
| **165** | **V57.13.7** | **Bubble truncation option #3: two-layer overlay. Verified on phone + emulator.** |

## Server-side changes that ride on top of any build (no AAB needed)

These were deployed during the session and apply to V57.13.x AND any future build immediately:

- `supabase/functions/resolve-place/index.ts` → **v5**. Personal-keyword lookup + fresh Google Places only. No cache. Returns `status: 'ok' | 'multiple' | 'not_found' | 'personal_unset'`. ~280 lines (down from 540).
- `supabase/migrations/20260507_drop_user_places_action_rules_dedup.sql` → DROPS `user_places`; CREATEs partial UNIQUE on `action_rules (user_id, trigger_type, ROUND(lat,5), ROUND(lng,5)) WHERE trigger_type='location' AND enabled=true`.
- `naavi-voice-server/src/index.js` → demo line rewrite: 5 cross-domain scenarios (today / bills / history / location / capture), DTMF input, name capture, personalized SMS recap from `+14313006228` (local Canadian number — replaced toll-free 888 for SMS due to Twilio TFV gating).

## Non-app work shipped this session

### Demo line — productized
- `1-888-91-NAAVI` (`+18889162284`) is the public demo number (voice).
- 5 menu-driven scenarios that demonstrate cross-domain capability rather than single-feature showcases.
- Name capture mid-call → name threaded through remaining turns + included in personalized SMS recap.
- Personalized SMS from `+14313006228` summarizes scenarios played + links to `mynaavi.com/start`.

### Landing page — `/start`
- New file: `mynaavi-website/start.html`.
- Cream/teal Gentler-Streak design matching the rest of the site. Uses `shared.js` for nav + footer.
- Form posts to `https://formspree.io/f/xvzdkjod` (changed from `xgorryye`).
- Lede: *"Thanks for taking the time to talk."* Recap card lists the 5 scenarios. Thank-you box closes with *"...call back any time at 1-888-91-NAAVI — or share the number with a friend who might want to try it."*

### Voice biometric vendor decision
- Azure Speaker Recognition was discontinued (3 commits 2026-05-03 added it, then we pivoted).
- **Path A approved:** wait on Picovoice Eagle with a deadline. Fall over to ID R&D as backup if no response.
- Captured in `project_naavi_voice_unification_open.md` memory.

## Bugs status — what's open after this session

| Bug | Status | Plan |
|-----|--------|------|
| Bubble truncation main (Samsung Yoga trim) | ✅ Fixed V57.13.7 | Verified phone + emulator |
| Bubble cosmetic leak — ruler invisible content shows dimly on long-wrap | ⏳ Deferred to next AAB | Change `color: 'transparent'` → `opacity: 0` on inline Text |
| Stop button visibility during long TTS | ✅ Fixed V57.13.5 | Skip force-idle when `status==='speaking'` AND `isAudioPlayingRef.current` |
| Saved-place duplicate "alert me at X" ignores existing rule | ✅ Fixed V57.13.3 | Pre-INSERT check returns `alreadyExists` → friendly *"You already have an alert there"* |
| Memory cache picking wrong city ("Ottawa McDonald's shadows Toronto") | ✅ Architecturally eliminated V57.13.3 | No cache exists; user always picks |

## Holding list — services / features in queue

Organized by what's blocking each. Add to/remove from this list as work moves; this is canonical alongside CLAUDE.md.

### Blocked on external approvals
1. **Picovoice Eagle** (voice biometric) — waiting on account approval
2. **AWS Polly** (mobile→Polly Joanna voice unification) — needs AWS account setup
3. **Maestro full-suite** — needs emulator Internal Testing install
4. **Geofence reliability** — pending phone reboot

### Server-side queue (no AAB needed)
5. Voice live-calendar fetch (mobile shipped V57.11.6, voice still on stale snapshot)
6. Voice action parity — DELETE_EVENT, LIST_RULES, DELETE_MEMORY, SCHEDULE_MEDICATION
7. Voice stop-word interrupt regression (`"Naavi stop"` recorded as next question)
8. Voice Deepgram first-word truncation on barge-in (`"What time is it?"` → `"Time is it?"`)
9. Voice name-search phonetic fallback (`"Hussein"` STT failure)
10. Voice migration to Anthropic Structured Outputs (~200 lines drift vs mobile)
11. Inbound SMS/WhatsApp queryability (outbound covered via `sent_messages`; inbound has no capture path)
12. Spend summary Edge Function (approved 2026-04-30, not built — `naavi-spend-summary`)
13. LIST_RULES synthesize-action backstop in orchestrator
14. Demo line *"remind me"* time-extraction loop (`project_naavi_demo_set_reminder_loop.md`)

### AAB-required queue
15. Multi-phone identity (`additional_phones[]` schema + Settings UI)
16. Demo line maturity (richer scenario data + conversion path back to real account + telemetry)
17. **Cosmetic ruler leak fix** (next AAB after V57.13.7) — `color:'transparent'` → `opacity:0`
18. Haptic VIBRATE permission + duration
19. Mobile-side todo-list-per-alert (each alert has an attached list; lazy-create on first add; cascade-delete on alert removal). **NOT implemented yet — design only.**
20. Verified-address rejection — name the address (`"I can't confirm '<destination>' for your meeting today"`)
21. Voice privacy UX (4-piece feature, not started)
22. Blog age reframe (2 articles still on age framing per `project_naavi_blog_age_reframe.md`)

### Deferred by design (open questions before code)
23. `list_change` trigger (7 design questions — `project_naavi_list_change_trigger_deferred.md`)
24. Health trigger (Epic integration required)
25. Price trigger (scraping complexity)
26. Phase 2 demo data

## Top of next session — priority order

1. **Voice roadmap doc** — draft `docs/VOICE_COMPLETION_ROADMAP_2026-05-07.docx` updating the 2026-05-04 version. **Wael's directive at session close: this is top priority for the next sessions.** 8-session structure (originally 6):
   - S1 Voice Quality Foundation (+ picker robustness + self-cleansing memory bullets)
   - S2 Voice Action Parity
   - **S3 Demo Line Maturity (NEW)**
   - S4 Voice Identity — Multi-Phone (was S3)
   - S5 Voice Identity — Biometric (was S4)
   - S6 Voice Unification — Polly Joanna (was S5)
   - **S7 Voice Structured Outputs Migration (NEW)**
   - S8 Voice Polish + Final Verification — bundle address read-back / postal phonetics / suffix expansion / ordinals (was S6, scattered bullets promoted)
2. **Cosmetic ruler-leak fix** — small code change, bundle into the next AAB.
3. **Mobile-side todo-list-per-alert** — schema (`list_id` on `action_rules`), prompt rule changes, lazy-create on first add, cascade-delete on alert removal, evaluate-rules read at fire time. ~half a session of work.
4. **Anything from the holding list above** that fits the session's main task.

## Where the code is right now

- **Active worktree:** `.claude/worktrees/compassionate-elion-6c01ca` — branch `claude/compassionate-elion-6c01ca` (at same commit as `origin/main` after end-of-session push).
- **Main repo:** `C:\Users\waela\OneDrive\Desktop\Naavi` — `main` branch.
- **Build clone:** `C:\Users\waela\naavi-mobile` — `main`, in sync; do not edit code here.
- **Voice server:** `naavi-voice-server` repo — `main` branch, demo line + name capture pushed; Railway auto-deployed.
- **Latest commit on main:**
  - `3fd909c` — `V57.13.7 build 165 — bubble truncation: two-layer overlay (option #3)`

## Rules to keep honoring (see CLAUDE.md for full list)

- **Mandatory `npm run test:auto` GREEN before any AAB build.** Held this session — 55/0/0/0 pre-build.
- **No "senior" / "caregiver" framing.** Held.
- **No action without explicit approval; one step at a time; numbered choices.** Held.
- **`# N` means option N.** Held.
- **NO PLACE-CACHE — fresh Google every time, user always picks** (V57.13.3 foundational principle, top of CLAUDE.md).

## Files to read alongside this handoff

- `CLAUDE.md` (project root) — banned terms, build workflow, multi-user safety, alert fan-out rule, configuration discipline, **NO-CACHE foundational principle**, holding list.
- Memory index: `C:\Users\waela\.claude\projects\C--Users-waela-OneDrive-Desktop-Naavi\memory\MEMORY.md` — pull `feedback_slow_down_sync.md`, `project_naavi_active_bugs.md`, `feedback_mandatory_auto_tester_before_build.md` first.
- Prior handoff: `docs/SESSION_HANDOFF_2026-05-07_V57.12.6_BUILD_158.md` (the V57.12.6 baseline; this session built V57.13 on top).
- 2026-05-04 voice roadmap (now superseded but kept for history): `docs/VOICE_COMPLETION_ROADMAP_2026-05-04.docx`.
