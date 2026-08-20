# Session Handoff — 2026-08-18

## ⭐ NEXT SESSION PRIORITY — Voice platform rejects registered phone numbers

**Open bug, unresolved.** Calling the Naavi voice line (+1 249 523 5394) from either of two currently-registered numbers (`+13433332567` — Wael's own primary number per today's Settings check, and `+16137697957` — Wael's number per CLAUDE.md's documented mapping) plays: *"This phone isn't registered. Say or enter your four digit PIN."* Confirmed this is Naavi's own generated message (not a Twilio-level failure) — the code ran, resolved `isDemoCall=false` correctly, and reached the unregistered-caller branch.

### What's confirmed, with direct evidence (not inference)

- **Code path**: `naavi-voice-server/src/index.js`, `getUserIdByPhone()` (line 978) does an exact-string match: `phone.eq.X OR phone_numbers.cs.{X}` against `user_settings`, no fallback, no fuzzy matching. Returns `null` on any non-match or fetch error alike (indistinguishable in the logs).
- **Railway logs** (`naavi-voice-server` service, Deploy Logs) show `[Context] No user found for phone +13433332567` and the same for `+16137697957` firing **consistently and repeatedly across Aug 16–18**, tied to both real inbound test calls AND outbound morning-brief calls (which still succeed via a separate `explicitUserId`-based mechanism that bypasses phone lookup entirely — so the account itself is fine, only the phone-lookup path fails).
- Two different `explicitUserId` values were seen historically tied to `+13433332567` in these logs: `8cd727da-2cb0-47a6-8275-1c581b968c0d` and `7739bab9-bfb1-4553-b3f0-3ed223e9dee8` (the latter is today's production auto-tester test-user ID — worth understanding why it's associated with this number in call logs, not yet investigated).
- **PIN fallback flow evidence** (once "not registered" fires, Naavi asks for a 4-digit PIN): across 3 real attempts on one call —
  - Attempts 1–2: DTMF `digits` field was `undefined` both times despite Wael reporting he physically pressed keys on his phone (real telephony DTMF, unrelated to the mobile app). Speech was captured both times as `"1.  2 3.  4."` and correctly extracted as PIN `1234` — which did not match any registered user's PIN.
  - Attempt 3: speech came through incomplete (`"1 2 , 3."`), extraction failed, call hit lockout and hung up.
- A **pre-existing, previously undiagnosed bug of the same shape** was already documented in commit `ca9c87a` (2026-08-05): *"PIN 2207 correctly matched Wael's account when verified directly against manage-voice-pin, but failed twice in a row on a real call using the exact same key/user_id/pin."* Diagnostic logging was added then; root cause was never found or fixed.

### Hypotheses explicitly ruled out this session, with evidence (do not re-try these without new evidence)

1. **Staging/production environment mismatch** — ruled out; Wael confirmed voice has only one environment, no staging/prod split.
2. **Broken/legacy Supabase service-role key on the voice server** — contradicted by Wael's testimony that voice has worked correctly for months; a broken key would break everything, not just phone lookup. (Separately confirmed production's *legacy-format* API keys are disabled since 2026-04-19 — this was found while checking a different, unrelated project ref and is not established as the voice server's actual configured key; Railway CLI here isn't authenticated, so the live `SUPABASE_SERVICE_ROLE_KEY` on Railway was never directly inspected.)
3. **Interference from the recent timezone-confirmation feature** (shipped 2026-08-05, `f057b10`) — explicitly not the issue; Wael corrected this was only offered as background context on "what changed recently," not a claim of causation.
4. **Stale/malformed phone number format in the database** — ruled out. `app/settings.tsx`'s `normalizePhone()` strips all spaces/dashes/parens before saving (confirmed by direct code read); `prettyPhone()`, which produces the `"+1 (343) 333-2567"` *display* format, is explicitly display-only. Wael also did a fresh re-save of the number in Settings and the failure persisted identically immediately after.

### Open, unresolved questions for next session

- **Never directly viewed the actual stored value** of `user_settings.phone` / `phone_numbers` for Wael's account. No safe raw credential was available this session (legacy key disabled; new-format `sb_secret_...` key only shown redacted by the Supabase CLI, by design). Best path: Supabase dashboard's Table Editor (no code/credentials needed), or find a sanctioned way to read it via an existing Edge Function.
- **Why is DTMF (`Digits`) never captured**, across every attempt, despite Wael reporting real key presses on his phone? Was mid-way through checking whether Twilio's dual `input="speech dtmf"` Gather mode can have speech detection "win" and suppress DTMF reporting when both occur close together (`speechTimeout="2"` is very tight) — this was not yet verified against Twilio's actual documented behavior when the session was cut off. **Do not assert this as confirmed** — it's an untested hypothesis Wael was actively pushing back on ("slow down and think... confirm") when the session ended.
- **Is `1234` actually Wael's real intended PIN**, or is Twilio's speech recognition consistently mishearing something else as `1234`? Settings shows "PIN set on Aug 18, 2026" (today) — Wael knows what he set it to; this was never directly asked/answered before the session closed.
- Given the *exact same bug shape* was already found and diagnostically logged on 2026-08-05 and never fixed, worth checking whether `[PIN-DIAG]` logging from that commit is still active and has more historical signal already sitting in Railway logs.

### Suggested first step next session

Ask Wael directly: (1) what is the actual PIN he set today, to compare against the extracted `1234`; (2) whether he's willing to check `user_settings.phone`/`phone_numbers` directly via the Supabase dashboard Table Editor for his own account, since that single piece of evidence (data problem vs. lookup-mechanism problem) would cut the remaining ambiguity in half immediately.

---

## Other work completed this session

### mynaavi-website — new blog post + video changes (all pushed to production)

- New post: `/blog/ai-orchestration-vs-generic-ai` — AI orchestration vs. generic AI, with IBM/Salesforce/Qualtrics/Precedence Research citations. Two factual errors caught and fixed before publish: a Qualtrics stat that inverted "at least 15 min" into "up to 15 min," and an overstated "now" on a 2024-sourced stat.
- Linked from `blog.html` grid + sitemap.xml + JSON-LD.
- Removed the "Listen"/audio-player feature site-wide (`blog.html` + 4 existing posts) per Wael's request — broken/empty audio controls, not desired going forward.
- Video handling on the new post and on the homepage's "doctor visit" section both moved from YouTube embeds to **self-hosted mp4** (`doctor-visit.mp4`, `na-03-chatgpt.mp4`, both committed to the repo, same pattern as the existing `hero.mp4`). Reason: YouTube Shorts auto-loop with no disable parameter, a JS-API attempted fix made it *worse* (uncontrollable playback, had to be reverted same session), and YouTube's pause/end-screen suggested-video overlay couldn't be fully suppressed. Self-hosting gives full native control, at the cost of losing YouTube's own reach/analytics for that specific embed (video still recommended to stay published on YouTube separately for discovery).
- Homepage doctor-visit section restructured: removed the old interactive phone-mockup storyboard demo box, added the new video full-width on top, kept the existing headline/tagline/"Read the full story" text below.
- Blog post's inline citations and References list rewritten so every URL shows as visible plain text (not just hidden in the `href`) — needed because Wael wants to copy the article text directly into a YouTube video description, and hidden hrefs don't survive a copy-paste.
- Researched and explained: YouTube disables clickable links in Shorts descriptions/comments (anti-spam policy, confirmed via search); regular video descriptions need one-time channel verification ("Advanced features" in Studio → Settings → Channel → Feature eligibility) before links become clickable at all — this is likely still pending on the MyNaavi channel, not confirmed fixed this session.

### Build 325 → production AAB (submitted, awaiting Google review)

- Verified from source (not the handoff, per Wael's explicit instruction) that staging build 325 = commit `608efb6`.
- Found and closed a real gap: 3 Edge Functions build 325 depends on (`extract-actions`, `poll-conversation`, `upload-conversation` — the Visits/conversation-recorder pipeline) existed on staging but **not at all** on production. Deployed all three to production; confirmed `ACTIVE` afterward. Required secrets (`ANTHROPIC_API_KEY`, `ASSEMBLYAI_API_KEY`) already existed on production.
- Ran `npm run test:auto` against production (per Wael's instruction to drop the Voice-regression and Firebase Test Lab gates for this promotion, keep only this one): **486/488 passed**, 2 pre-existing documented skips, 0 failures.
- Wrote `docs/VISITS_PHASE7_MANUAL_VERIFICATION_2026-08-17.md` — the project's own governance process had a documented gap (Phase 7 manual testing was listed as "not yet performed" in Phase 5's doc, with no evidence file ever written). Closed it with a real, live, guided test on staging build 325 — screenshots read carefully at each step, cross-verified against the actual sent Gmail email and actual Google Calendar events (not just the app's own claims). Wael's explicit business decision, recorded in that doc: this satisfies the business need; the untested edge cases (ambiguous-recipient-name resolution, pending-draft interruption) are not pursued further as a condition of that sign-off.
- Built and submitted the production AAB: version `1.0.325`, versionCode `325`, build ID `d2ec5426-2510-467c-b603-dde5df84c987`. Submitted to Google Play's **Open Testing** track (`beta` in the Play API) as a **draft** — matches the same track the currently-approved-but-unpublished V318 sits on.
- **Found and flagged a stale doc**: CLAUDE.md's own "HOW BUILDS WORK" section claims `--auto-submit` pushes to "Google Play Internal Testing" — the actual configured `eas.json` submit track is `"beta"` (= Open Testing), confirmed both by the API terminology and by matching Wael's own Play Console screenshot. **This doc line should be corrected in a future session** — not done yet, flagged only.
- As of last check, V325 was in Google's review queue ("Changes in review," automated pre-checks running). **Wael's explicit decision: wait for V325's review to clear before publishing anything — do not roll out V318 in the meantime, to avoid any risk of the two interfering.** No further action needed here until review clears.

## Reminders for next session

- Do not re-litigate the four ruled-out voice hypotheses above without new evidence.
- The `PROTECTED_ACCOUNT_IDS` hard guard on the auto-tester is confirmed working — safe to run `test:auto` again without recreating the calendar-wipe risk from `project_naavi_b10y_autotester_wipes_calendar`.
- A stray local Python test server from earlier in this session was found and killed (port 8934) — not a recurring concern, just noting it's already resolved.
