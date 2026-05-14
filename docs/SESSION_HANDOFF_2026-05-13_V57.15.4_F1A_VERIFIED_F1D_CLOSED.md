# Session Handoff — 2026-05-13 → V57.15.4 build 175 + F1d CLOSED + prompt v74

**Status at session close:** V57.15.4 build 175 on Wael's phone (and emulator). F1a Wave 2 fully verified end-to-end on real device. F1d Tests 1 + 3 + 4 all live-verified — feature complete and closed. Prompt v74 deployed (fixes F1a entityType inconsistency / CLAUDE.md item 16a). Maestro flows 14-17 passing (4/4 in 1m 39s). Auto-tester 108/108 green (107 → +1 new regression test). Transistorsoft follow-up email drafted, not yet sent — Wael's call.

**Top of NEXT session — priority order (Claude recommendation):**

1. ⭐ **V57.15.5 AAB — Caller PIN + Lists testIDs.** Per Wael's earlier decision, the caller PIN feature replaces Picovoice permanently (no more vendor waiting). ~1 hour build: migration + manage-voice-pin Edge Function + Settings UI + voice-server PIN-prompt flow. Bundled with Lists testIDs (~15 min — closes the Maestro regex `.*` workaround we added today). One AAB, two real user-visible improvements. **AAB required.**

2. **Geofence reliability — STILL BLOCKED on vendor replies.** If Transistorsoft has responded with a trial key by next session, that becomes priority #1 (test on Samsung phone). If still silent, send the prepared follow-up email (drafted in this session's chat log) and continue with #1 above. **Do NOT pay the $350 license without trial verification first.**

3. **Server-side fast wins (if AAB is skipped):** `naavi-spend-summary` Edge Function (~1 hour, approved 2026-04-30 but never built) + Voice live-calendar fetch (~30 min, voice still on stale snapshot vs mobile V57.11.6) + `resolve-place` radius 100→500 + address routing fix (~30 min).

4. **F1d remaining work:** F1d itself is now closed (Tests 1/3/4 verified). Item 25 in CLAUDE.md ("Voice privacy UX 4-piece feature") is broader than F1d — F1d shipped 1 of 4 pieces. Other 3 not started; deferred.

---

## What shipped this session

### 1. F1a Wave 2 V57.15.4 — truncation fix + tappable list rows (mobile AAB)

**Commit `a9603bd` — V57.15.4 build 175** (auto-submitted to Google Play).

Two user-visible changes:

- **`lib/list_connections.ts::formatConnectionQueryResult`** — multi-item answers now join with `\n` between items (was `. `). Two reasons: (a) escapes Samsung Yoga truncation zone by always spanning 3+ visible lines on multi-item answers; (b) visually clearer, matches the voice-side numbered-list feedback from 2026-05-12. TTS unchanged — Aura Hera pauses on `\n` same as on `.`.
- **`app/index.tsx` LIST_CONNECTION_QUERY card** — each attached list renders as a tappable `TouchableOpacity` row navigating to `/lists/[id]`. Closes the gap noted in this session ("List items card is not clickable, it should be so i can access the lists").

**Live verification (last 15 min of session):** asked *"What lists are on my Costco alert?"* → got perfect text answer (newline-formatted) + tappable card with both grocery and cottage rows + chevron + "Tap a list to open" hint. Tapped cottage → opened list-detail screen as expected. End-to-end works.

`parity-impact:` voice=same-as-mobile (voice server already emitted same per-list lines via `_f1aFormatConnectionQuery` since Wave 1).

### 2. Prompt v74 — LIST_CONNECTION_QUERY required-fields (server)

**Commit `b9e56ca` — prompt v74 + regression test.**

Live test on V57.15.4 surfaced item 16a from CLAUDE.md: asking *"What lists are on 688 Bayview office?"* had Claude emit `LIST_CONNECTION_QUERY` with `mode:"what_list_is_on"` but NO `entityType` field. Mobile orchestrator correctly rejected with *"entityRef and entityType required for what_list_is_on"* — Naavi told user *"I couldn't check that."*

Two prompt changes in `supabase/functions/get-naavi-prompt/index.ts`:

- Added live-bug-matching example: *"What lists are on 688 Bayview office?"* → `entityRef:"688 Bayview office", entityType:"action_rule"` (address-style entityRef → action_rule mapping)
- Added CRITICAL FIELD REQUIREMENT block listing mandatory fields per mode + entityType-inference rules per phrasing pattern:
  - "alert" / "arrival" / "leave" / address-like noun → `action_rule`
  - "meeting" / "appointment" / "calendar" / day-of-week + time → `calendar_event`
  - "email" / "from <person>" → `gmail_message`
  - "contact" / name only → `contact`
  - "document" / "warranty" / "invoice" / "receipt" → `document`
  - "reminder" / "remind me" → `reminder`
  - When in doubt → default `action_rule` (most common in V1)

**Version bump:** v73 → v74 (`2026-05-13-v74-list-connection-query-required-fields`).

**New regression test** in `tests/catalogue/prompt-regression.ts`:
- `prompt-regression.list-connection-query-address-must-have-entitytype` — locks the live-bug phrasing
- Extended `list-connection-query-what` to assert `entityType` is present (was only checking `entityRef`)

Both pass on first run against v74.

`parity-impact:` both-shipped — shared prompt via `get-naavi-prompt`; lands on voice + mobile with one deploy. Item 16a is now CLOSED.

### 3. F1d live verification — Tests 3 + 4 PASS + 4 server fixes from live test

**Tests verified on Twilio voice call to +1 249 523 5394:**

| Test | Result | Notes |
|---|---|---|
| Test 1 (mute → yes → SMS + URL) | ✅ PASS | Re-verified |
| Test 3 (recursive mute, offer stays pending) | ✅ PASS | Recursive mute drained offer audio; "yes" within 30s delivered SMS + email |
| Test 4 (30-sec silence auto-discards) | ✅ PASS | No SMS, no email after silence; call gracefully ended |

**4 voice-server commits shipped from live-test findings:**

1. **`4eef2da`** — `PRIVACY_MUTE_WORDS_RE` regex relaxed. The original `/^\s*(?:no sound|quiet|shh+|shush)\s*\.?\s*$/i` was too strict against real Deepgram transcripts (saying "Quiet" came through with extra courtesy words / punctuation, missing the anchor). New: word-boundary substring match inside ≤4-word utterance.

2. **`2b86391`** — Phonetic confusables + aggregated-text check. Discovered live: Wael said *"no sound"* and Deepgram heard *"No. Pound."* (sentence-split + "sound" → "pound" phonetic confusable on 8kHz μ-law audio). Extended regex to handle Deepgram neighbours (`sound|pound|sounds|founds`, `quiet|quite`). Also added a check on aggregated `pendingText` at UtteranceEnd for split-utterance cases that per-FINAL check misses.

3. **`01d4f72`** — SMS confirmation TTS clearer. Live test feedback: *"Sent."* came through too quiet/short on the phone line. Changed to *"SMS sent to your phone."* for both F1d privacy-mute confirm AND DRAFT_MESSAGE confirm paths. Aura normalises amplitude better on longer utterances + tells user the delivery channel.

4. **`1f14748`** — Suppress idle prompt during pending hosted-reply. Live Test 4 revealed Naavi was firing the general idle-timer prompt ("I couldn't quite catch that") ~10 seconds into the F1d silent-wait window. Fix: skip `startIdleTimer` when `pendingHostedReply` is set. The 30-sec auto-discard timer handles cleanup cleanly without pestering the user.

**F1d is now CLOSED.** Holding-list items 15 (F1d edge-case tests) and 7 (voice stop-word interrupt regression — improved via F1d work) close out.

### 4. Maestro flows 14/15/16/17 — all passing

**Commit `30b7193` — Maestro flow fixes.**

These flows were created 2026-05-12 (commit `7f1effa`) but never actually tested against a running app — they had thinkos. Root cause was four separate issues:

- **(14) "All" tab assertion failed.** Maestro `text:` is regex-ANCHORED, not substring. The tab renders as "All (4)" when lists exist; exact-match against `"All"` missed. Fix: regex `All.*`.
- **(15) Position tap fired before lists rendered.** The lists-reconcile call + lists query is async (cold-load ~3-5s on emulator); the tap at `50%,30%` fired before any row was visible. Fix: wait for `All \(.+\)` to appear (signals counts populated) before tapping. Also bumped Items header timeout 8s → 12s.
- **(16) Singular vs plural "Attached list(s)" rendering.** Exact-match only handled singular. Fix: regex `Attached list.*` matches both.
- **(17) "Sign Out" used as page-loaded anchor.** Sign Out is at the BOTTOM of the ScrollView (only visible after scrolling). Fix: anchor on "Your Name" (first section header). Replaced two counted `- scroll` commands with `scrollUntilVisible` for the Phone Numbers section (counted scrolls overshot).

All 4 flows pass end-to-end against V57.15.3 emulator. Should also pass against V57.15.4 once the next emulator install happens (regex selectors are version-agnostic).

**Follow-up queued for V57.15.5** — add explicit `testID` props to the Lists screen tabs in `app/lists.tsx` so the flows can use `id:` selectors instead of the regex hack. Code-side fix is cleaner and future-proof. ~15 min.

### 5. Transistorsoft follow-up email — drafted, not sent

In response to Wael asking about the risk of paying $350 for Transistorsoft without testing first:

- Honest risk assessment provided in chat (~75% works reliably on Samsung One UI, ~15% partial, ~10% fails).
- Comparison vs Radar (SaaS): Transistorsoft is significantly less risky for our use case (bounded financial exposure, no privacy compromise, no vendor lock-in, no recurring cost).
- **Follow-up email drafted** in chat log — short, technical, mentions Radar as parallel evaluation, asks only for trial key + refund policy. Full text in chat history; Wael to add his signature line and send when ready.
- **Timing note:** Original email was sent 2026-05-12 (only ~24 hours before drafting follow-up). Most B2B vendors take 2-3 business days. If Wael wants standard etiquette, send Friday 2026-05-15 or Monday 2026-05-18; if sending today, signals high buyer intent.

---

## Today's commits (chronological)

| Commit | Repo | What |
|---|---|---|
| `a9603bd` | naavi-app | V57.15.4 build 175 — newline formatter + tappable list rows |
| `30b7193` | naavi-app | Maestro flows 14/15/16/17 — fix for V57.15.3+ Wave 2 screens |
| `4eef2da` | voice-server | F1d privacy-mute — relax PRIVACY_MUTE_WORDS_RE for real Deepgram speech |
| `2b86391` | voice-server | F1d privacy-mute v2 — Deepgram confusables + aggregated check |
| `01d4f72` | voice-server | F1d + DRAFT_MESSAGE — SMS confirmation TTS clearer |
| `1f14748` | voice-server | F1d — suppress idle prompt during pending hosted-reply window |
| `b9e56ca` | naavi-app | prompt v74 + test — LIST_CONNECTION_QUERY required-fields |

**1 AAB shipped:** V57.15.4 build 175 (commit `a9603bd`), Google Play Internal Testing, also synced to local emulator APK.

---

## Auto-tester status

**108/108 green** (was 107 at session start, +1 new regression test added).

Categories: `prompt-regression` (15 — 1 new for entityType requirement), `truth-at-user-layer` (1), `list-connections` (10), `hosted-replies` (5), `pending-dwell` (5), `data-integrity` (3), `source-intent` (5), `brief-unread` (2), `search-normalization` (4), `gmail-freshness` (1), `lists` (4), `voice-pin` (7), `multi-phone` (4), `lists-reconcile` (2), `multiuser` (20).

Run via `npm run test:auto`. Must stay green before any AAB per CLAUDE.md Rule 15.

---

## Maestro flows status

**14/14 created + 4/4 Wave-2 passing.** Remaining flows (01-13) cover prior surfaces. Smoke flow 01 verified passing today; full suite re-run is queued for next session.

Coverage gap: list-detail screen `app/lists/[id].tsx` is reachable via flow 15 but the items / delete-list affordance hasn't been Maestro'd separately. Not high priority.

---

## Open items at session close

### Awaiting external reply
- **Transistorsoft trial key + refund policy + Samsung specifics** — email sent 2026-05-12, follow-up drafted today (not sent yet)
- **Radar Samsung One UI handling + pricing for low MTU tier + trial** — email sent 2026-05-12, no follow-up drafted yet (eval Radar second per priority)

### Server-side queue (no AAB)
- `naavi-spend-summary` Edge Function — approved 2026-04-30, ~1 hour
- Voice live-calendar fetch — mobile shipped V57.11.6, voice still stale
- Voice action parity (DELETE_EVENT, LIST_RULES, DELETE_MEMORY, SCHEDULE_MEDICATION)
- Voice → Anthropic Structured Outputs migration (~200 lines drift vs mobile)
- Deepgram first-word truncation on barge-in
- Voice name-search phonetic fallback ("Hussein" STT failure)
- Inbound SMS/WhatsApp queryability
- LIST_RULES synthesize-action backstop in orchestrator
- Demo line "remind me" loop fix
- `resolve-place` radius 100→500 + address-vs-business routing

### AAB-required queue
- ⭐ **Caller PIN flow (V57.15.5)** — replaces Picovoice permanently, ~1 hour. Per `project_naavi_caller_pin_chosen_over_biometric.md`.
- ⭐ **Lists tabs testIDs (V57.15.5)** — closes Maestro regex hack, ~15 min. Bundle with PIN.
- Voice privacy UX full 4-piece (F1d shipped 1 of 4)
- Demo line maturity
- Verified-address rejection ("can't confirm '\<destination\>'")
- Haptic VIBRATE permission + duration

### Deferred by design
- `list_change` trigger (7 open design Qs)
- Health trigger (Epic integration required)
- Price trigger (scraping complexity)
- Phase 2 demo data
- Blog age reframe (2 articles still age-framed)

### Closed this session
- ✅ F1d Test 3 (recursive mute) — verified live
- ✅ F1d Test 4 (30-sec silence) — verified live
- ✅ F1a entityType inconsistency (item 16a) — prompt v74 deployed, regression test green, live verified
- ✅ Voice stop-word reliability (subset) — improved via F1d regex relaxation + aggregated-text check
- ✅ "Sent." too quiet — TTS rewrite to "SMS sent to your phone."
- ✅ Idle prompt firing during F1d quiet window — suppressed when pendingHostedReply set
- ✅ Maestro flows 14/15/16/17 — all green
- ✅ V57.15.4 truncation regression — newline formatter shipped

---

## Recommended top of next session — **V57.15.5 AAB (Caller PIN + Lists testIDs)**

**One AAB. ~1.5 hours total. Closes two queued items + adds real user-visible value.**

### Phase A — Caller PIN feature (~1 hour)
Per `project_naavi_caller_pin_chosen_over_biometric.md` (memory). Replaces Picovoice permanently — no more vendor approval queue waiting.

1. **DB migration** — add `user_settings.caller_pin_hash` (text, nullable) + `caller_pin_set_at` (timestamptz, nullable).
2. **Edge Function** — `manage-voice-pin` already exists (commit `9893c5f`); confirm SET + VERIFY endpoints + 7 auto-tester cases passing. (They already are per Session 2026-05-13 test:auto run.)
3. **Mobile Settings UI** — new "Voice PIN" section in `app/settings.tsx`. Field for 4-digit PIN entry, masked input, "Save PIN" button, "Clear PIN" button, status indicator ("PIN set" vs "No PIN set"). Per memory file ~50 lines.
4. **Voice-server PIN-prompt flow** — when caller-phone lookup fails AND PIN is set on any user account, prompt: *"Hi, I don't recognize this number. Please say your 4-digit PIN to continue."* Match against `caller_pin_hash` across users. On match → proceed as that user. On 2 fails → fall through to demo. Per memory file ~80 lines in `naavi-voice-server/src/index.js`.
5. **Prompt addition (v75)** — teach Claude the PIN-prompt vocabulary and 2-strike rule. Already partial in v72 (commit `5ef3a66`); refine for the SET path.

### Phase B — Lists tabs testIDs (~15 min)
1. Add `testID={'lists-tab-' + key}` to each tab `TouchableOpacity` in `app/lists.tsx:156`.
2. Update `e2e/14-lists-screen-tabs.yaml` to use `id: "lists-tab-all"` / `lists-tab-attached` / `lists-tab-standalone` instead of the `.*` regex.
3. Re-run flow 14 + 15 + 16 + 17 to confirm green.

### Phase C — Migration + AAB V57.15.5 (~15 min)
- `app.json` versionCode 175 → 176
- `app/settings.tsx` version V57.15.4 → V57.15.5
- Run `test:auto` (Rule 15 — must be green)
- Push, sync naavi-mobile clone, `npx eas build --platform android --profile production --auto-submit`

**Recommend doing A+B+C as one continuous push. AAB ships both features.** Splitting into separate AABs is wasted cycles since the PIN feature is the bulk of the work and testIDs add no user-visible surface.

### Alternative if AAB is undesirable next session
Server-side fast wins: `naavi-spend-summary` + Voice live-calendar fetch + `resolve-place` radius fix. Three real user-visible improvements, zero AAB, ~2 hours total. Caller PIN can wait one more session.

---

## CLAUDE.md priorities — to update at top of next session

Current "Top of next session" in CLAUDE.md still references F1a Wave 2 as #1. Should update to reflect:

1. **V57.15.5 AAB (Caller PIN + Lists testIDs)** — top priority, ~1.5 hours
2. **Geofence reliability — BLOCKED on vendor replies** — Transistorsoft follow-up drafted; send before next session if no reply by then
3. **Server-side fast wins (alt)** — `naavi-spend-summary` + Voice live-calendar fetch + `resolve-place` radius fix
4. F1a entityType (item 16a) — **CLOSED** today
5. F1d edge-case live tests — **CLOSED** today

Strike items 16a, 15 from the AAB-required holding list section. Add ✅ to F1d Tests in priority status.

---

## Last AAB locations

**On Wael's phone:** V57.15.4 build 175 (commit `a9603bd`), installed today via Internal Testing URL.
**On emulator:** V57.15.4 build 175 APK, installed today.
**Second phone:** still V57.14.3 build 169 from 2026-05-11 — update at user's convenience.
**Robert's phone:** still V56.6 build 115 from 2026-04-28. **Do NOT promote V57.x to Robert until geofence reliability is solved (still blocked on vendor reply).**

---

## CLAUDE.md attached as context

This handoff is canonical for 2026-05-13 session close. See also `CLAUDE.md` (root of repo) for the persistent project rules and full holding list. The two together form the complete onboarding for the next session.

End of handoff.
