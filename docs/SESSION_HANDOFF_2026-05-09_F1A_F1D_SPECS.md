# Session Handoff — 2026-05-09 — F1a + F1d specs locked, latency fixes shipped

**Read this first if you're picking up where this session left off. Pair with `CLAUDE.md` (project rules) and the prior handoff `docs/SESSION_HANDOFF_2026-05-09_CLASSIFICATION_BUILD_RULES.md` for context.**

## Where you are right now

- **Active items: 19.** Down from 23 at session start. 5 items closed in this session, 1 added (F1d replacing F1c).
- **F1a (Lists wired to events) — fully spec'd.** [`docs/F1A_LISTS_AND_CONNECTIONS_SPEC.md`](docs/F1A_LISTS_AND_CONNECTIONS_SPEC.md). Ready for code. ~1.5–2 sessions to ship end-to-end.
- **F1d (User-controlled mute on PC + Mobile) — fully spec'd.** [`docs/F1D_USER_CONTROLLED_MUTE_SPEC.md`](docs/F1D_USER_CONTROLLED_MUTE_SPEC.md). Replaces F1c. Ready for code. ~0.5–1 session.
- **F2a, F2b, F2c — postponed.** All three need further study before walkthrough; classification doc updated with postpone notes.
- **PC voice latency reduced from ~14 s to ~4 s** (chunk-size fix + Twilio queue drain on `stopMusic`). Memory file `project_naavi_music_queue_latency.md` reversed (drain is now the right answer; prior 2026-04 directive was based on a smaller assumed cost).

## What shipped this session

### Server-side deploys (live now)

| Commit | Repo | What |
|---|---|---|
| Railway env vars | naavi-voice-server | Added `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`. Was the silent root cause of B1c voice-half failures. |
| `ff0d19f` | naavi-voice-server | Live-overlay relative-time tagging |
| `b1e99d8` | naavi-voice-server | Live-overlay clock-time `[arrived at 10:59 AM]` |
| `568bded` | naavi-voice-server | Twilio Media Streams chunk size 8000 → 160 bytes |
| `d7c5290` | naavi-voice-server | `stopMusic` now drains Twilio outbound queue via `event:'clear'` — 70% reduction in user-perceived voice-call latency |
| `82ead81` | naavi-app | naavi-chat live-overlay relative-time tagging |
| `f1ef3f3` | naavi-app | naavi-chat clock-time `[arrived at 10:59 AM]` |

### Mobile, queued for next AAB

- `9e85807` — B3a path-1: `staysActiveInBackground: true` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permission. When the app is backgrounded mid-reply, Android currently denies audio focus → cloud Aura fails → Android native TTS impersonates Naavi as a "third voice." This fix unlocks backgrounded TTS playback at the OS level.

### Classification + spec docs

| Commit | What |
|---|---|
| `16533a8` | F1a spec locked + holding-list closures (B1c, B2b, B2c) |
| `1f355c9` | F1b closed (no architecture); F1c → F1d (user-controlled mute) |
| `cc1def1` | F1d spec: 6 remaining design gaps locked for build |

## Closures this session (5 items + F1c→F1d swap)

| ID | Reason |
|---|---|
| **B1c** Naavi misses brand-new emails for up to an hour | Fully verified after Railway env-var root cause + Football Game / Birthday Cake tests. Both surfaces confirmed. |
| **B2b** "Naavi stop" doesn't interrupt | Improved by music-queue drain. Works on second attempt 100%; first-attempt-miss is phone-side echo cancellation (unfixable). |
| **B2c** Talk-over-Naavi interrupt | Same root cause and fix as B2b (shared `stopMusic` code path). |
| **F1b** Inbound SMS / WhatsApp queryability | No viable architecture: WhatsApp Business API restrictions; SMS via OS-level READ_SMS carries Google Play rejection risk; SMS via Twilio proxy requires every contact to change behavior. Email already covers ~80% of the use case. |
| **F1c** Voice privacy UX (4-piece auto-classification bundle) | Superseded by F1d. Auto-classification creates an unfixable social false-positive cost — forcing Robert to publicly engage in privacy dialogue itself reveals he has something to hide. |

## Top of next session — IMPLEMENT F1a + F1d

Both specs are fully locked. Ready for code. Wael's directive 2026-05-09: implement and code F1a (and F1d alongside).

### F1a implementation plan (7 stages)

| Stage | What | Where | Risk |
|---|---|---|---|
| 1 | **Schema migration + data migration + rollback** — `list_connections` table + indexes + RLS policies; one-shot conversion of existing `tasks[]` and `list_name`; rollback SQL | `supabase/migrations/` | Highest (touches production) |
| 2 | **Edge Function** `manage-list-connections` — CRUD operations: connect, disconnect, query | `supabase/functions/manage-list-connections/` | Medium |
| 3 | **Anthropic tool definitions** for the new actions | `supabase/functions/_shared/anthropic_tools.ts` | Low |
| 4 | **Voice prompt rules** in `get-naavi-prompt`: phrasings, auto-create-on-missing, disambiguation, three-option confirmation | `supabase/functions/get-naavi-prompt/index.ts` | Medium |
| 5 | **Three-option confirmation phrase standardization** across DRAFT_MESSAGE + new list ops + default fallback | `lib/voice-confirm.ts` SPEECH constants + naavi-voice-server | Medium |
| 6 | **Mobile UI** — Lists top-level menu entry (with All / Connected / Standalone subcategories), list-detail screen, alert-detail card update with delete-connection control | `app/`, `hooks/useOrchestrator.ts` | High; AAB required |
| 7 | **Auto-tester additions** — prompt-regression tests + data-integrity tests + multi-user matrix tests | `tests/catalogue/` | Low |

Stages 1–5 + 7 are server-only. Stage 6 needs an AAB (bundle with B1b, B3a verification, B3b cosmetic, B3c haptic in next AAB cycle).

**Suggested first slice:** Stage 1 only (schema + migration files written, reviewed, rollback ready). Lowest-risk first slice. Apply to production only after Wael approves.

### F1d implementation plan (server-side: 0.5–1 session)

| Stage | What | Where |
|---|---|---|
| F1d-1 | **Add new privacy-mute words** to voice-server stop-handler. Match `"no sound" / "quiet" / "shh"` parallel to existing kill-response matcher. | `naavi-voice-server/src/index.js` near line 5300 |
| F1d-2 | **Preserve `pendingText` on privacy-mute** (don't clear; the queue-drain handles audio silencing). | Same file |
| F1d-3 | **Inject SMS-the-rest follow-up** as Naavi's next utterance: *"Want me to text the rest to your phone?"* (binary phrase). Use existing yes/no/edit classifier. | Same file |
| F1d-4 | **Always email + SMS hot link delivery.** Generate token, store response content in hosted-link backend (TTL: 30 days). Send email via existing `send-email` Edge Function. Send SMS via existing `send-sms` Edge Function with notification + `https://mynaavi.com/r/<token>` link. | New Edge Function or `supabase/functions/manage-mute-delivery/` |
| F1d-5 | **New web endpoint** at `mynaavi.com/r/<token>` to render stored content (plain HTML, no auth, token-only access). | `mynaavi-website` repo |
| F1d-6 | **Voice prompt update** in `get-naavi-prompt`: teach Claude the new mute vocabulary and SMS-the-rest interaction pattern. | `supabase/functions/get-naavi-prompt/index.ts` |
| F1d-7 | **Recursive-mute handling** — drain offer audio but keep offer pending in 30-second window. | `naavi-voice-server/src/index.js` |
| F1d-8 (mobile) | **Update `onChatLongPress`** in `app/index.tsx` to call `stopSpeaking()` when `isAudioPlaying` is true; existing hands-free behavior otherwise. | AAB required |
| F1d-tests | Auto-tester additions for new mute vocabulary + audio drain timing + multi-user isolation. | `tests/catalogue/` |

### Build sequencing recommendation for next session

1. **F1d server-side first (smaller scope, fewer touch points)** — F1d-1 through F1d-7. Server-only. Ships in one push.
2. **F1a Stage 1 next (schema + migration)** — biggest risk, highest value. Apply with caution; have rollback ready.
3. **F1a Stages 2–5 + 7** — Edge Function, tools, prompt, confirmation phrase, tests. Server-only.
4. **AAB for both at once** — F1a Stage 6 (Lists screen, alert-detail update) + F1d-8 (long-press handler) + queued items B1b, B3a verify, B3b cosmetic, B3c haptic.

**Order rationale:** F1d is smaller (~½ session), F1a is bigger (~1.5 sessions). Shipping F1d first builds confidence in the queue-drain + voice-prompt patterns we'll reuse for F1a. Plus F1d's three-option phrase standardization (Stage 5 of F1a) actually applies to F1d's confirmation flow, so getting the phrase right in F1d unlocks F1a Stage 5.

## Other open items

| ID | Status |
|---|---|
| **B1b** LIST_RULES backstop on mobile | Validated broken; deferred to next AAB |
| **B2a** SCHEDULE_MEDICATION on voice | Validated broken; server-side fix, ~1 hour. Not started this session. |
| **B3a** Mobile cloud→native TTS fallback | Path-1 fix queued in commit `9e85807` for next AAB; verify after build |
| **B3b** Cosmetic ruler leak on long-wrap user bubbles | Mobile fix; queued for next AAB |
| **B3c** Haptic vibration too subtle on Samsung | Mobile fix; queued for next AAB |
| **B3d** Verified-address rejection doesn't name the address | Both surfaces; small fix |
| **B3e** Two blog articles still on age framing | Website-only; pick deletion or rewrite |
| **F2a** Onboarding Review (8 gaps) | Postponed — needs further study |
| **F2b** Demo line maturity | Postponed — needs further study |
| **F2c** Walkie-talkie turn-taking | Postponed — relying on continuous-improvement on silence detection in the meantime |
| **F3a** Picovoice Eagle voice biometric | Blocked on vendor approval |
| **T1a** Anthropic Structured Outputs migration | Server-side; ~1 day |
| **T2a** Maestro full-suite mobile UI | 7/13 failing; triage before pre-build gate |
| **T2b** Phase 2 demo data (Gmail seeding) | Server-side; ~30 min |
| **I2a / I2b / I3a** | Brainstorming-stage |

## Memory file updates

- `project_naavi_music_queue_latency.md` — reversed: drain is now the right approach. 2026-04 "do NOT drain" directive was based on assumed 1.3-1.5s cost; actual cost was 5-7s.

## Tally summary

| Category | Start of session | End of session |
|---|---|---|
| Bugs (B) | 10 | 7 |
| Features (F) | 7 | 6 |
| Tooling (T) | 3 | 3 |
| Ideas (I) | 3 | 3 |
| Closed without entry | 5 | 10 |
| **Active items** | **23** | **19** |
| **Total items** | **28** | **29** (F1d new entry) |

## Auto-tester baseline

50 ✓ / 0 ✗ / 3 errored / 2 skipped at session start (per prior handoff). Not re-run this session — no AAB build. The 3 errored are pre-existing token issues with the test user account (`mynaavi2207@gmail.com`).

## Files to read alongside this handoff

- `CLAUDE.md` — Rules 1–17 (foundational rulebook)
- `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md` (.md + .docx) — current state of all 29 items
- `docs/F1A_LISTS_AND_CONNECTIONS_SPEC.md` (.md + .docx) — Lists wired to events spec
- `docs/F1D_USER_CONTROLLED_MUTE_SPEC.md` (.md + .docx) — User-controlled mute spec
- `docs/SESSION_HANDOFF_2026-05-09_CLASSIFICATION_BUILD_RULES.md` — prior handoff
- Memory index: `C:\Users\waela\.claude\projects\C--Users-waela-OneDrive-Desktop-Naavi\memory\MEMORY.md`

## Rules to keep honoring

- **Rule 1** — no action without explicit approval
- **Rule 9** — wait for user "done" signal before next item
- **Rule 13** — numbered choices, never embedded in prose
- **Rule 14** — `# N` = option N
- **Rule 15** — `npm run test:auto` green before every AAB build
- **Rule 16** — `parity-impact:` line on every cross-surface commit
- **Rule 17** — validate every classification entry by user-facing test before coding a fix
- **`feedback_user_test_is_ground_truth`** — when user test contradicts your hypothesis, accept the test
- **`feedback_dont_overstate`** — don't assert hypotheses as facts
- **`feedback_classification_notes_plain_functional`** — Notes column is user-visible behavior, not technical detail
- **`feedback_batch_docx_regeneration`** — defer .docx rebuilds to session boundaries
