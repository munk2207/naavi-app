# Session Handoff — 2026-05-06 — fix AAB

**Read this first if you're picking up where this session left off.**

## Where you are right now

- **Latest AAB on Wael's phone:** V57.11.8 build 150 (Internal Testing)
- **Session timeline:** V57.11.4 build 146 → V57.11.5 build 147 → V57.11.6 build 148 → V57.11.7 build 149 → V57.11.8 build 150
- **Auto-tester:** 50 ✓ / 0 ✗ / 2 skipped (chain-store tests skipped — bridged via mobile orchestrator until Anthropic Structured Outputs migration)
- **Prompt version live:** `2026-05-06-v59-attendee-scope-and-chain-reemphasis`
- **No work pushed to voice server in V57.11.7+ that changes shape** — chain-store auto-fix mirror deferred

## The big structural improvement of this session

We added a **prompt-regression test suite** (`tests/catalogue/prompt-regression.ts`) that locks in known-good Claude action emissions. Future prompt edits that break previously-fixed scenarios fail loudly in `npm run test:auto` BEFORE the AAB ships. **Ends the "fix one thing, break another" cycle.**

Run via `npm run test:auto`. The 8 tests:

| Test | Status | Catches |
|------|--------|---------|
| chain-store-walmart | SKIPPED (bridged) | "Which Walmart?" instead of picker |
| chain-store-tim-hortons | SKIPPED (bridged) | Same |
| list-rules-emits-action | ✅ active | GLOBAL_SEARCH for "what alerts do I have?" |
| calendar-no-auto-invite | ✅ active | Auto-invite when user only said "with Bob" |
| navigate-no-claude-estimate | ✅ active | Hallucinated travel duration in speech |
| home-no-clarification | ✅ active | "Which home?" question for personal keyword |
| office-no-clarification | ✅ active | Same for office |
| remember-medication | ✅ active | REMEMBER not emitted for medication facts |

The skipped two are documented; orchestrator-side `chain-store auto-fix` (V57.11.8) bridges the user-facing UX. They re-enable when Anthropic Structured Outputs migration replaces the bridge.

## Major changes shipped this session

### V57.11.5 build 147
- Bubble layout reworked (didn't hold; chronic Yoga bug)
- Press-and-hold-anywhere full chat area (flexGrow:1 + flex:1)
- Multi-location picker polish (full address, smart pluralization, dedup-by-lat-lng)
- Prompt v57 — chain stores emit, no Claude travel-time estimate
- Bug 3 regex extended (strip Claude's "About N minutes" + replace "Leave by")
- Phantom-action backstop for "let me check the map"
- TTS diagnostic remoteLogs

### V57.11.6 build 148
- DraftCard Send button regression FIXED (handsfreeRef guard removed; pendingActionRef now set in tap-to-talk)
- TTS chronic AudioFocusNotAcquiredException FIXED (setIsEnabledAsync + interruptionModeAndroid: DUCK_OTHERS + retry)
- Calendar staleness FIXED (Cache-Control: no-cache + Pragma: no-cache on Google Calendar API call)
- LIST_RULES backstop added (catches "you have N alerts" without LIST_RULES action)
- Verified-address rule REVISED (Wael 2026-05-05): user confirmation alone NOT sufficient. Naavi must independently verify via Places SPECIFIC_TYPES check. Orchestrator-side gate before FETCH_TRAVEL_TIME.
- Picker dedupe by lat/lng rounded
- Haptic Medium → Heavy
- Mic-button-tap diagnostic remoteLog
- Prompt v58 — verified-address rule documented

### V57.11.7 build 149
- Bubble: numeric maxWidth on Text (failed)
- LIST_RULES handler: query action_rules + read back as numbered list (still partial — see V57.11.9 below)
- Haptic switched to RN Vibration API + Heavy parallel
- Prompt v59 — chain-store re-emphasized + attendee scope (only invite when user explicitly asks)
- RLS hotfix on `client_diagnostics` table (Supabase Security Advisor flagged)
- Function `search_knowledge_fragments` — search_path locked to `public, pg_temp`

### V57.11.8 build 150 (CURRENT)
- Bubble: textBreakStrategy="simple" on Text element (research-evidence fix; FAILED on phone — sixth attempt; bug class deeper than expected)
- Stop button: position: absolute, bottom: 130 (FAILED — disappears during long-reply streaming)
- Chain-store auto-fix bridge (CONFIRMED WORKING): when user types/speaks chain brand AND Claude asks "Which X?" AND no SET_ACTION_RULE, orchestrator synthesizes the action and forces the picker
- Prompt-regression test suite (NEW, 8 tests, structural win)

## Strategic positioning change (Wael 2026-05-05)

**Banned all "senior" / "caregiver" framing across the entire codebase.** Updated CLAUDE.md, MEMORY.md, all docs. Use "user" or "older healthy independent adult" only when context demands. The app is for EVERYONE; we just take care that older healthy independent adults find it friendly. Apply retroactively when editing existing code, prompts, docs, or memories.

## Maestro setup — partially complete

- Naavi-Test emulator running (Android 14, x86_64) ✓
- ADB sees emulator-5554 ✓
- Maestro CLI installed (Wael's PC) ✓
- JAVA_HOME persisted via `setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"` ✓
- Smoke test 01 PASSED ✓ (5 assertions green: Launch, MyNaavi, TODAY'S BRIEF, WEATHER, Ask MyNaavi, Screenshot)
- Full suite blocked: emulator's Play Store can't see Internal Testing app even though account is on testers list. Internal Testing URL only works once-per-device-per-version. After uninstall, "download it on Google Play" link returns "Item not found." Needs investigation OR sideload via bundletool.
- 3 NEW Maestro scenarios written but untested: `11-draftcard-send-regression.yaml`, `12-multi-location-picker.yaml`, `13-bubble-no-truncation.yaml`. Initial timeout-syntax bug fixed via `scripts/fix-maestro-timeout-syntax.js` (assertVisible+timeout → extendedWaitUntil pattern).

## V57.11.9 bundle (queued for next session)

In priority order:

1. **Anthropic Structured Outputs migration** — the durable fix the agent's research recommended. ~1 day focused session. Replaces JSON-in-prompt with schema-constrained generation. Eliminates the prompt-drift class entirely. Removes the chain-store bridge (V57.11.8) cleanly. Removes the LIST_RULES synthesize-action need (V57.11.9 #3 below). Detailed plan: define discriminated-union schema for all 23 action types, switch the Anthropic SDK call from `messages.create({...})` to `tool_choice: "any"` + strict tool, remove "you must return JSON" from prompt, update `parseResponse` and orchestrator action-handlers to read from `tool_use` content blocks. ~10 file changes, full regression run before deploy.

2. **Bubble truncation (Bug 4) — different angle** — six layout attempts failed (V57.10.3 padding, V57.11.2 padding 12, V57.11.3 drop row, V57.11.5 outer row+column, V57.11.7 maxWidth on Text, V57.11.8 textBreakStrategy="simple"). Two evidence-based remaining options:
   - Adjust Typography ratio (`fontSize: 15` + `lineHeight: 24` = 1.6 ratio is in the bug zone per react-native #35039 — try `lineHeight: 20` for ratio 1.33). Risk: subtle look change across whole app.
   - Replace `<Text>` in ConversationBubble with `react-native-markdown-display`. Bypasses Yoga measurement. Adds a dependency.

3. **LIST_RULES synthesize-action backstop** — current backstop overrides speech but doesn't emit a LIST_RULES action. So Naavi says "Let me pull up your alerts" and nothing happens. Fix: in the phantom-backstop loop, when LIST_RULES pattern matches AND no LIST_RULES action exists, push a synthesized LIST_RULES action onto the actions array (similar to chain-store auto-fix pattern).

4. **Verified-address rejection — name the address** — current rejection is generic "I can't confirm that address." Make it specific: "I can't confirm '12345 Imaginary Lane' for your meeting today. Please check the address in your calendar." Single-line code change in the FETCH_TRAVEL_TIME verification gate.

5. **Stop button visibility during streaming** — V57.11.8 set position: absolute, bottom: 130, but Wael saw it disappear as new content streams in. Investigation needed: (a) is the parent positioned-context correct, (b) is status flickering between speaking/idle as TTS chunks play, (c) does the auto-scroll trigger a remount. Add status-transition remoteLogs during long replies, then fix based on evidence.

6. **Haptic — VIBRATE permission + duration tweak** — Wael's Samsung "vibration feedback" toggle is ON, system intensity at max, but Vibration.vibrate(80) produces NO buzz. Verify VIBRATE permission in `app.json` Android array. Increase to `Vibration.vibrate(150)` or pattern `[0, 100, 50, 100]`. Test with each variant.

7. **Voice server chain-store mirror** — voice (Twilio) surface lacks the orchestrator-side chain-store auto-fix that mobile got in V57.11.8. Voice users still hit Bug 11 ("Which Walmart?" loop). Implement same logic in `naavi-voice-server/src/index.js` after Claude response, before TTS. Or wait for Structured Outputs migration to replace need entirely.

## Other queued items (unchanged from prior handoff)

- **Picovoice Eagle voice biometric** — blocked on Picovoice approval
- **Polly Joanna voice unification** — blocked on AWS account
- **Multi-phone fast path** — bundled with voice biometric session
- **Maestro full suite** — blocked on emulator Internal Testing install path
- **Phase 2 demo data** (Gmail emails for mynaavidemo)
- **Geofence reliability** (priority 1, partial; battery exemptions configured, phone reboot pending)

## What works well right now (don't regress these)

- TTS plays Aura Hera reliably (audio focus fix held)
- DraftCard SMS Send sends real SMS (database confirmed + Twilio called)
- DraftCard Email Send delivers real emails (Bob received them)
- Calendar staleness fixed (live Google fetch with no-cache)
- Memory write + recall (REMEMBER + search-knowledge)
- Multi-location picker for chain stores via orchestrator bridge (Canadian Tire, Walmart, Tim Hortons, Costco)
- Calendar event creation (CREATE_EVENT, no auto-invite when user didn't ask)
- Travel time card with real Google Maps data
- Verified-address rule blocking fake locations
- Phone (Twilio) surface — voice still functional, prompt v59 deployed
- Auto-tester (50 green + 2 skipped)
- Prompt-regression suite catches behavior regressions automatically

## Files / state to be aware of

- `tests/catalogue/prompt-regression.ts` — the new regression suite, 8 tests
- `tests/lib/assertions.ts` — added `extractSpeech` and `expectSpeechNotMatch` helpers
- `hooks/useOrchestrator.ts` — chain-store auto-fix at ~line 1209 (after phantomCommitChecks); Bug 3 regex; verified-address gate before FETCH_TRAVEL_TIME
- `components/ConversationBubble.tsx` — textBreakStrategy="simple" on Text (didn't fix the bug)
- `app/index.tsx` — Stop button absolute positioning (didn't fully fix); Vibration.vibrate(80) + Haptics.impactAsync(Heavy) parallel
- `supabase/functions/get-naavi-prompt/index.ts` — v59 deployed
- `supabase/functions/naavi-chat/index.ts` — Cache-Control: no-cache on calendar fetch
- `supabase/functions/resolve-place/index.ts` — bare-brand multi-result + lat/lng dedup
- `supabase/migrations/20260506_client_diagnostics_rls.sql` — RLS hotfix applied
- `e2e/11-draftcard-send-regression.yaml`, `12-multi-location-picker.yaml`, `13-bubble-no-truncation.yaml` — new Maestro scenarios untested
- `scripts/build-onboarding-guide-docx.js`, `build-interactive-onboarding-options-docx.js`, `build-voice-completion-roadmap-docx.js`, `build-mobile-vs-phone-audit-docx.js` — new docx generators with senior/caregiver language stripped

## Pacing rule from this session (PINNED)

Wael 2026-05-05–06: **slow down. one ship per session, not three.** After every server deploy or AAB submit, STOP. Don't queue more work. Let Wael test + sync + direct the next step. Memory file: `feedback_slow_down_sync.md`.

## What NOT to do

- Don't make a 7th attempt at the bubble bug with another layout tweak. Six failed. Pick one of the V57.11.9 #2 paths and commit to it.
- Don't bundle more than ~3 fixes per AAB. Each fix has blast radius; bundling complicates attribution.
- Don't skip the prompt-regression suite before deploying a new prompt. It's the safety net.
- Don't auto-clear pendingActionRef in the speak-phase (V57.11.6 fix — leave it as the new send() turn handles it).
- Don't reintroduce "senior" / "caregiver" framing anywhere.
- Don't add prompt rules without a corresponding regression test. That's how the cycle started.

## Final state of testing on V57.11.8 build 150

- ✅ TTS Aura Hera audible
- ✅ Multi-location picker fires for chain stores (Canadian Tire test end-to-end PASS)
- ✅ Calendar staleness fix
- ✅ Verified-address rule blocking
- ✅ Memory write + recall
- ✅ DraftCard Send (SMS + Email)
- ✅ Calendar event create no auto-invite
- ✅ Press-and-hold full-area
- ❌ Bubble word-truncation (sixth fix failed)
- ❌ Stop button vanishes during streaming
- ❌ LIST_RULES doesn't actually emit action (backstop only rewrites speech)
- ❌ Verified-address rejection too generic
- ❌ Haptic — no buzz felt despite OS vibration ON
- ❌ Whisper STT cropping voice input ("alerts" → "alert"; "What is my next meeting?" → "What is my next") — orthogonal to the bubble bug; addressing requires a different approach (better STT or post-processing)
