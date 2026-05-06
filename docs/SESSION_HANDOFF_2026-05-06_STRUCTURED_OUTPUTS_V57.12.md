# Session Handoff — 2026-05-06 — Anthropic Structured Outputs Migration → V57.12.0 build 151

**Status at session close:** Migration shipped end-to-end. Auto-tester: **52 passed / 0 failed / 0 errored / 0 skipped** — first time the project's full suite is all-pass with no skips. V57.12.0 build 151 installed on Wael's phone. Mobile chat smoke test passed (`"alert me at Walmart"` → picker, no "Which Walmart?" question — the headline regression is fixed).

**One functional regression found post-install** (NOT caused by this session — pre-existing data/schema gap surfaced by testing): picker for chain stores with multiple saved branches shows duplicate-looking lines because `user_places` table has no `address` column. Open. Fix queued for next session.

---

## What shipped — V57.12.0 build 151

### Anthropic Structured Outputs migration (Phases 1-5)

The V57.x prompt-drift cycle (v52→v59) is over. Claude is now constrained by typed tool schemas instead of free-text JSON-in-prompt. Tests can no longer flip red because of a prompt edit on an unrelated rule.

**Phase 1 — Inventory + decisions.** Mapped every action Naavi emits (23 forms after dropping 3 dead). Locked 4 design decisions:
- A: `to` is contact-name only; orchestrator resolves to phone/email
- B: `one_shot` per-trigger defaults preserved (location → true, others → false)
- C: `is_priority` is included in CREATE_EVENT / SET_REMINDER / REMEMBER schemas (mobile forwarding still TODO)
- D: dropped LOG_CONCERN, UPDATE_PROFILE, SET_EMAIL_ALERT (dead code)

Schema reference doc: `docs/STRUCTURED_OUTPUTS_SCHEMAS_DRAFT.md` (1,151 lines). Decisions locked at the top.

**Phase 2 — naavi-chat to tool-use.** Edge Function `naavi-chat` now passes `tools: NAAVI_TOOLS` and `temperature: 0` to Anthropic. Response parses `tool_use` blocks instead of grepping JSON out of free text. Backward-compat `rawText` (`{speech, actions, pendingThreads}` shape) preserved so orchestrator + tests still consume the same data.

**Phase 3 — Rules into tool descriptions.** Chain-brand rule and verified-address rule moved out of the 853-line prompt into the `set_action_rule` tool's description. Result: Walmart fixed, Tim Hortons resisted (Haiku still asked "which one?" for that specific brand).

**Phase 3.5 — Location tool split.** Replaced the single `set_action_rule.location` variant with two strict tools:
- `set_location_rule_chain` — `chain_brand` field is enum-constrained to 25 chain brands; `place_name` is free-text for branch suffix
- `set_location_rule_address` — free-form, gated by verified-address rule

Result: Tim Hortons fixed on first deploy. Schema constraint succeeded where prose persuasion failed. Anthropic Structured Outputs hypothesis fully validated.

**Phase 4 — Deleted band-aids.** With the contract now enforceable, ~200 lines of runtime patches went away:
- Chain-store auto-fix synthesizer in `useOrchestrator.ts` (lines 1212-1262 in the pre-deletion file)
- Phantom-action regex scanner in `useOrchestrator.ts` (lines 1163-1208) that rewrote Claude's speech when `actions[]` didn't match the verbs
- Server-side phantom mirror in `naavi-chat/index.ts` (lines 65-91)

All 52 tests stayed green after deletion — proof the band-aids were dead code under the new contract.

**Phase 5A — Voice server migration.** `naavi-voice-server` (separate Railway repo) migrated to same contract. New file `src/anthropic_tools.js` (715 lines, CommonJS mirror of the TS tools file). Streaming Claude call now uses `tools` + `temperature: 0`. No phantom band-aid was found in voice server (pleasant surprise — never had one).

**Phase 5B — AAB.** V57.12.0 build 151 built via EAS, auto-submitted to Google Play Internal Testing, installed on Wael's phone. Build clone synced via `git merge`, never `cp -f`.

### Server-side state at session close

- **Live prompt version:** `2026-05-06-v62-phase3-5-location-tool-split` (via `get-naavi-prompt` Edge Function)
- **`naavi-chat`:** tool-use, temperature 0, deployed
- **`get-naavi-prompt`:** prompt pruned from 912 → 813 lines, action-shape declarations removed (now in tool definitions), behavioral rules kept
- **`_shared/anthropic_tools.ts`:** new file, 683 lines, defines all 23 tools + converters

### Voice server

- **Commit:** `412fb2f` on `munk2207/naavi-voice-server` `main`
- **Railway auto-deploy:** assumed succeeded — **NOT verified at session close.** Place a verification call before trusting.
- **Watch-out flagged by the migrating agent:** TTS may start 50-200ms later on simple turns vs before (text-block-close event vs mid-string regex). Probably unnoticeable. If you hear an unusual silence at the start of a response, check Railway logs for whether `tool_use` blocks streamed before text.

### Auto-tester

```
✓ 52 passed   ✗ 0 failed   ⨯ 0 errored   ⧗ 0 timed out   ○ 0 skipped
```

First clean run of the project. Walmart + Tim Hortons unskipped and pass via enum-constrained `set_location_rule_chain` tool. The two prompt-regression tests that were the canary for this session are now permanent guards.

---

## Open issues found this session

### 1. Picker missing addresses (FUNCTIONAL — NEW finding, pre-existing root cause)

**Symptom:** "alert me at Walmart" → picker shows 4 entries:
> 1. Walmart
> 2. Walmart
> 3. Walmart Supercentre
> 4. Walmart Supercentre

— with no street/neighborhood info. User can't pick because they look identical.

**Root cause:** `user_places` table schema has no `address` column. Schema is `id, user_id, alias, place_name, lat, lng, radius_meters, created_at, last_used_at`. The picker code at `hooks/useOrchestrator.ts:1997` reads `c.address || c.place_name` and always falls back to `place_name` because address is undefined.

**This is NOT a session regression.** The picker code wasn't touched in this session (Phase 4 deleted other lines). The intent comment at lines 1991-1993 ("Always show the full first-segment of the address … Wael 2026-05-05") was authored yesterday but the database column to read from never existed.

**Fix recommendation (next session):**
1. Migration: `ALTER TABLE user_places ADD COLUMN address text`
2. Backfill: reverse-geocode existing rows via Google Maps API (lat/lng → formatted address)
3. Update `resolve-place/index.ts` SELECT and INSERT to include address
4. Pre-existing orchestrator code already uses `c.address` correctly — no mobile change

Estimated ~1 hour server-side. No AAB needed.

### 2. Bubble truncation (UI — pre-existing, deferred since prior session)

**Symptom:** User input bubble shows "Alert me at" instead of full "Alert me at Walmart". Visible in the test screenshot.

**Status:** Six layout attempts failed in V57.10-V57.11.x. Prior handoff says **"Do NOT make a 7th layout tweak."** Two specific paths recommended:
- (a) `fontSize: 15` + `lineHeight: 24` (ratio 1.6, in the bug zone per react-native #35039) → try `lineHeight: 20` (ratio 1.33)
- (b) Replace `<Text>` in `ConversationBubble` with `react-native-markdown-display`

Requires AAB. Deferred again — out of scope for this session.

---

## What was verified vs not verified

| Surface | Code deployed | User-end verified |
|---|---|---|
| Edge Functions (Supabase) | ✓ | ✓ via auto-tester (52/0/0/0) |
| Mobile chat (V57.12.0 on phone) | ✓ | ✓ chain-store smoke (Walmart picker shown without "which one?") |
| Voice server (Railway) | Pushed, deploy assumed | ✗ NOT verified — no Twilio call placed |
| Mobile actions other than chain-store | ✓ | ✗ NOT exercised this session |

**Trust the migration on:** chain-store flow (proven in tests + on phone).
**Don't yet trust without verification:** voice surface, non-chain actions on phone (CREATE_EVENT, REMEMBER, SET_REMINDER, etc.).

---

## Files modified this session

### Mobile / Edge Function repo (`munk2207/naavi-app`, `main`, commit `e6660c8`)

- `app.json` — versionCode 150 → 151
- `app/settings.tsx` — V57.11.8 → V57.12.0
- `hooks/useOrchestrator.ts` — Phase 4 deletions (-130 lines)
- `supabase/functions/get-naavi-prompt/index.ts` — Phase 2/3/3.5 (912 → 813 lines, prompt v60 → v61 → v62)
- `supabase/functions/naavi-chat/index.ts` — Phase 2 tool-use migration + Phase 4 phantom-mirror deletion
- `supabase/functions/_shared/anthropic_tools.ts` — NEW, 683 lines, all 23 tool schemas + converters
- `tests/catalogue/prompt-regression.ts` — unskipped 2 chain-store tests
- `docs/STRUCTURED_OUTPUTS_SCHEMAS_DRAFT.md` — NEW, 1,151 lines, schema reference + locked decisions
- `docs/SESSION_HANDOFF_2026-05-06_STRUCTURED_OUTPUTS_V57.12.md` — this file

### Voice server repo (`munk2207/naavi-voice-server`, `main`, commit `412fb2f`)

- `src/index.js` — tool-use migration, +72/-50 lines
- `src/anthropic_tools.js` — NEW, 715 lines, JS mirror of the TS tools file

---

## Next-session priorities

In order:

1. **Picker addresses fix** (~1 hour server-side, no AAB). Schema migration + backfill + SELECT/INSERT updates. Resolves the only functional regression found this session. Plain `user_places` → `user_places.address` text column, reverse-geocode via Google to backfill rows, update `resolve-place`. After deploy, Wael's existing 4 Walmart entries become differentiable.

2. **Voice server verification** (Wael places one Twilio call). Test chain-store on voice ("alert me at Tim Hortons"). Watch for the 50-200ms TTS delay — should be unnoticeable; report if not. If chain-store works on voice, Phase 5A is end-to-end proven. If it doesn't, Railway deploy might have failed silently — check Railway logs for commit `412fb2f`.

3. **Bubble truncation (Bug 4)** — one of the two paths from prior handoff. Pick (a) lineHeight 20 OR (b) markdown-display library. **Do NOT make a 7th layout tweak with the same approach.** Requires AAB.

4. **`is_priority` mobile forwarding** (Phase 1 Decision C). The schema includes the field; mobile orchestrator doesn't read it yet. ~10-line change. Decide whether to also wire UI surfacing of priority flag.

5. **Background extractor migration** — the 4 background Edge Functions (`extract-email-actions`, `extract-document-text`, `extract-actions`, `ingest-note`) still parse JSON-in-prose. Same fragility class as naavi-chat had. Migrate to tool-use the same way (Phase 2-style). No AAB. Lower priority since these don't have user-end-visible regressions today.

---

## Pacing rule reinforced this session (PINNED)

- **Stop assuming, study before concluding.** Wael called out the assumption-jump multiple times. Investigate code, don't repeat handoff doc claims as gospel.
- **One step at a time, with explicit approval before each.** The phrase "do not proceed without my clear approval" was repeated. Honor it strictly even when momentum is fresh.
- **Be precise — don't mix false claims with facts.** When summarizing state, every clause must be defensible. "End-to-end live" implies user-end verification; that's not the same as "all code deployed." Don't conflate.
- **Robert is persona-only.** No real second installer. Don't reference "Robert's phone" or "until Robert installs" — just "your phone." See `user_no_robert_tester.md` memory.

---

## What's at the session boundary (do not regress)

- Tool-use API contract is the canonical source of action shape. Don't add a new "action" by writing a JSON-in-prompt template — define a tool schema instead.
- The phantom-action regex scanner is gone for a reason. Don't reintroduce it. If a regression makes Claude's speech lie about an action, the right fix is in the tool description / prompt, not a band-aid.
- The chain-store auto-fix synthesizer is gone. Same reason. Trust the enum-constrained tool.
- Auto-tester at 52/0/0/0 is the new floor. Pre-build (ABSOLUTE RULE 15) gate stays mandatory. Any regression in this baseline is a STOP signal — diagnose before shipping anything else.

---

## Last AAB on devices

- **Wael's phone:** V57.12.0 build 151 (this session)

---

## Quick-reference commands

- Test full suite: `npm --prefix "/c/Users/waela/OneDrive/Desktop/Naavi" run test:auto`
- Test specific category: `… run test:auto -- --grep <name>`
- Deploy Edge Function: `npx supabase functions deploy <name> --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx`
- Sync build clone: from `C:\Users\waela\naavi-mobile`, `git fetch origin && git merge origin/main`
- AAB build + auto-submit: from build clone, `npx eas build --platform android --profile production --auto-submit --non-interactive`

---

## Closing note

The migration went from "tests can't stay green across unrelated edits" to "52/0/0/0 first clean run" in one session. The structural fix worked: schema-constrained generation removes the prompt-drift class entirely. The agent that diagnosed the root cause (912-line megaprompt + non-deterministic LLM + regex-on-free-text tests) gave the correct directional fix on first pass; the implementation matched it.

Two real bugs remain (picker addresses, bubble truncation). Both are pre-existing. Both have known fix paths queued for next session.
