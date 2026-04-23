# Session 21 — Handoff

**Date:** 2026-04-22
**Focus:** End-to-end testing + cost audit + prompt-caching implementation
**Closing state:** V54.2 build 103 on phone. Prompt caching confirmed working (cache_read verified via Supabase log). 19 bugs + 1 design principle logged in `docs/AAB_BUNDLE_NEXT_RELEASE.md`.

---

## 1. What shipped in Session 21

### Prompt caching — now verified working

Confirmed via Supabase Edge Function log:
```
[cache-debug] usage={"input_tokens":2658,"cache_creation_input_tokens":0,"cache_read_input_tokens":7427}
```
Second call within 5 min read 7,427 tokens from cache at ~10% of normal price.

**Final architecture:** 3-block system array, stable-FIRST, with two markers from `get-naavi-prompt`:
- `\n---CACHE_BOUNDARY---\n` — separates dynamic prefix (date/time) from stable rules
- `\n---END_STABLE_RULES---\n` — separates stable rules from per-query context (brief, knowledge, health)

Block order on naavi-chat + voice server: `[stable (cache_control), dynamic, tail]`. Stable-first is required because Anthropic's cache key includes all blocks preceding the cache_control breakpoint.

### Cost-cutting deploys (all server-side, no AAB)

| Function | Change |
|---|---|
| `naavi-chat` | 3-block cache split with `cache_control` on stable block |
| `extract-email-actions` | Prompt caching (Haiku already, rules hoisted to cached system block) |
| `extract-document-text` | Prompt caching (both call sites — text + PDF paths) |
| `ingest-note` | Sonnet → Haiku + prompt caching |
| `extract-actions` | Sonnet → Haiku + prompt caching (legacy function, low volume) |
| `get-naavi-prompt` | Inserts CACHE_BOUNDARY + END_STABLE markers; version bumped to `2026-04-22-v14-cache-boundary` |
| Voice server main call | 3-block cache split via `buildCachedSystem()` helper |
| Voice server morning brief | Same cache split |
| `sync-gmail` cron | Frequency 5 min → 15 min |

### CLAUDE.md updates

- **New Rule 12 (P1 principle)** added to ABSOLUTE RULES:
  > Never act on the outside world without explicit positive approval. Acceptable: "yes", "approved", "send it", "confirm", "go ahead". Not acceptable: "ok", "sure", silence, ambiguity. Unresolved inputs block the action — never fall back silently.

### Mobile onboarding doc fix

- `docs/NAAVI_CLIENT_ONBOARDING.md` — step 1 is now **Sign in with Google**. Rest of setup renumbered 2–7.
- `docs/build_client_onboarding_docx.js` — regenerator updated to match.
- `.docx` regenerated.

---

## 2. End-to-end test results

### MT (mobile text) — 11 tests run

| Test | Result | Notes |
|---|---|---|
| 3-MT School calendar | ✅ | Sept 2, 2025 from 2025-2026 PDF |
| 7-MT Arrive home | ✅ | *"from Settings (home)"* correctly surfaced |
| 2-MT Costco rule | ✅ | 2-alias save confirmed; S9 open (missing grocery list) |
| 8-MT Weather rule | ✅ | S13 open (hidden fan-out) |
| 15-MT Atorvastatin | ✅ (after seed) | S16 open (no-data guidance) |
| 9-MT "David" | ✅ | User-verdict pass |
| 10-MT Bell invoice | ❌ | S1, S2 — dumped search card instead of composing answer |
| 11-MT Leave-time | ❌ | S6 — calendar lookup missed a live same-day event |
| 14-MT One sentence two writes | ❌ | S7 (UI double render), S8 (no calendar event for birthday) |
| 4-MT Contact silence | ❌ | S11 — tense confusion (present-perfect → future alert) |
| 13-MT Calendar → text wife | ❌ | S6 + S14 (unknown contact falls back to self) |
| 12-MT Cross-channel recall | ❌ | S1, S2, S16, S17 — semantic direction ignored |
| 1-MT Warranty search | ⚠️ | S2 — false-positive card (condo meeting), text answer correct |

### MV (mobile voice) — focused 5-test subset

| Test | Result | Notes |
|---|---|---|
| 3-MV School calendar | ⚠️ | 4/5 criteria pass; STT dropped "is" + "school"; NLU recovered |
| 7-MV Arrive home | ⚠️ | 5/5 mechanical, but "already inside" UX gap (AAB #2 sub-item) |
| 2-MV Costco multi-turn | ⚠️ | 4/6 pass; S18 — final TTS silent after "yes → Alert set" |
| 8-MV Weather rule | ✅ | Full clean pass |
| 15-MV Atorvastatin | ⚠️ | 4/6; STT mangled "Atorvastatin" → "Aturvastin"; NLU recovered |

### PC (phone call) — 2 tests attempted

| Test | Result | Notes |
|---|---|---|
| 3-PC School calendar | ⚠️ | 4/5 pass; S19 — verbose read of raw Drive hits + PDF filenames (~16s audio) |
| 7-PC Arrive home | ❌ then ✅ on retry | First attempt: Deepgram WS hang (known intermittent, `project_naavi_voice_call_hang.md`). Retry: correct concise response *"I will alert you when you arrive home"* |
| 8-PC Weather rule | ⭕ not run | — |
| 5-PC Morning brief | ⭕ not run | — |

Test discipline note: mid-session Wael corrected me on implicit verdicts. Going forward, **every test must have explicit pass-fail criteria written first** and scored per criterion.

---

## 3. Bugs logged — server-side (S1-S19)

All in `docs/AAB_BUNDLE_NEXT_RELEASE.md` under "Server-fix list". Short summary:

- **S1** — Naavi dumps Global Search card instead of composing an answer
- **S2** — Global Search over-matches on word substrings; text-vs-card contradiction
- **S3** — Vendor misclassification ("Invoice from mynaavi" when actually Anthropic)
- **S4** — "+N more" voice count mismatches UI
- **S5** — All-day calendar event read as 1 day earlier
- **S6** — Calendar lookup misses live same-day events
- **S7** — REMEMBER confirmation card renders twice (UI only; data integrity fine)
- **S8** — REMEMBER-birthday doesn't auto-create companion calendar event
- **S9** — Rule referencing missing list — no warning at creation time
- **S10** — user_places canonical alias too generic (brand-only, not location-specific)
- **S11** — Tense confusion: past/present queries create future alerts instead of answering now
- **S12** — Location arrival alerts need voice-call delivery channel (5th channel)
- **S13** — Inconsistent verb mirroring + hidden channel fan-out = expectation mismatch
- **S14** — 🔴 CRITICAL: unknown contact silently falls back to user's own phone
- **S15** — Enforce P1 (explicit-approval) in Naavi's live prompt
- **S16** — "I don't have X" replies don't teach the user how to provide X
- **S17** — Semantic direction of query is ignored (outbound queries return inbound content)
- **S18** — TTS silent on final pending-state confirmation ("yes → Alert set")
- **S19** — Voice-call answers MORE verbose than text/in-app voice across action-triggering turns

---

## 4. AAB bundle — 10 items queued for next release

Full detail in `docs/AAB_BUNDLE_NEXT_RELEASE.md`. Shortlist:

1. Device timezone auto-detect at signin
2. Phase 2 location trigger scaffolding (confirmed missing: "already inside" handling for arrive rules)
3. `isBroadQuery` regex narrowing — **major cost lever, $13-27/mo/user**
4. Cap knowledge context at 20 fragments (was 100)
5. Mobile chat response truncation fix
6. Version bump (→ V55 build 104)
7. Alerts management UI + Naavi LIST/DELETE actions
8. Push Notifications default ON
9. Remove Anthropic API Key field from Settings (not user-facing purpose)
10. Info screen — TBD changes

---

## 5. Cost bleed audit — findings

Ran adversarial audit of 7 suspects. Results:

| # | Suspect | Verdict |
|---|---|---|
| 1 | `backfill-email-actions` | ✅ Safe — manual-only invoke, no cron, dormant |
| 2 | `extract-actions` (legacy) | ⚠️ Was Sonnet; **fixed this session** (Haiku + caching) |
| 3 | `isBroadQuery` amplification | 🔴 **REAL LEAK, ~$13-27/mo, AAB-only fix** |
| 4 | Retry loops | ✅ Clean |
| 5 | Voice stream abort on hangup | ⚠️ No `controller.abort` found — low-probability bleed |
| 6 | Duplicate action emission | ✅ Cost impact near zero (ingest-note dedupes) |
| 7 | Email pipeline fan-out per email | ✅ OK with caching live |

**Biggest remaining leak = isBroadQuery (AAB item #3).** Regex matches common queries like *"what is my calendar"*, *"what is my schedule"* → fetches 100 knowledge fragments → 30k extra input tokens per call. Needs AAB.

---

## 6. Honest cost assessment — where estimates vs reality diverged

Documented for accountability:

- **"One-day change, under an hour"** → actually 6 iterations, ~90 min. Two deploy silent-failures + two prompt-structure issues + block-ordering issue with Anthropic's cache key. Lesson: study the prompt structure and Anthropic's cache semantics up front.
- **"80-90% cost reduction"** → real number closer to **60-65% on total input cost per cache-hit call**. 90% is true only for the cached portion (~7,427 of ~10,000 input tokens). Output tokens don't cache at all.
- **"$150+/month savings → $30-60/month nasvi-last"** → more realistic is **$60-100/month**. Savings only materialize on calls within 5-min windows. Morning brief = 1/day, no reuse. Email pipeline bursts DO benefit.
- **"Item 5 — cron cadence"** (original): I thought `evaluate-rules` called Claude. It doesn't. Pivoted mid-execution to `sync-gmail 5→15 min`, which is real but modest.
- **"Item 2 — Sonnet→Haiku"**: only `ingest-note` + `extract-actions` got the swap. Low-volume calls. Nudge, not lever.

**Track the real signal**: nasvi-last monthly bill over next 2-4 weeks. <$80/month = win. ~$120+ = marginal.

---

## 7. Deploy reliability issue — warn future sessions

Edge Function deploys via `npx supabase functions deploy` **silently fail when Docker isn't running** and the deploy is run in background (via `run_in_background: true`). Two of four functions silently skipped my first deploy pass; only discovered when I ran `functions list` and saw the version dates hadn't bumped.

**Recommendation for future sessions:**
- Deploy sequentially in foreground when the deploy matters
- After deploy, verify with `functions list` that the `updated_at` timestamp moved
- The CLI warning `WARNING: Docker is not running` appears in stdout but doesn't fail the command — easy to miss

---

## 8. Testing artifact cleanup

Cleaned via SQL in Session 21 close:
- `action_rules` — deleted test rules except home (962 Terranova)
- `knowledge_fragments` — deleted Sarah's birthday (fake), kept Atorvastatin
- `sent_messages` — deleted today's self-sends ("i love you")
- `user_places` — deleted both Costco rows (alias broken per S10)

User's Google Calendar "Meeting with Hussein" event kept per user request.

---

## 9. What to open with Session 22

Options in priority order:

1. **Ship the AAB bundle.** 10 items queued. Build V55 / build 104. High ROI — fixes the `isBroadQuery` cost leak, alerts management UI, "already inside" location UX, etc.
2. **Dedicated voice-server session.** Target the bugs in `project_naavi_voice_name_search.md` + `project_naavi_stop_word_regression.md` + `project_naavi_deepgram_first_word_truncation.md` + S19 (voice verbosity) + `project_naavi_voice_call_hang.md` (intermittent Deepgram WS hang).
3. **Server-side bug fixes (S1-S19).** Many are small prompt or Edge Function tweaks. Can be done incrementally in short focused sessions.
4. **Cost monitoring.** Daily nasvi-last dashboard check for 1-2 weeks to confirm caching delivers. Tell next session if the $/day has dropped.
5. **Finish remaining PC tests** (8-PC, 5-PC) when voice-server work opens up.

---

## 10. Build + deployment state (as of close)

- **On phone:** V54.2 build 103 (unchanged).
- **Main repo HEAD:** `main`, all cost-cutting changes committed to main.
- **Voice server:** `12a86f0` → `da7a450` → `01c8be3` pushed to `munk2207/naavi-voice-server`; Railway auto-deployed.
- **Edge Functions redeployed (latest versions):**
  - `naavi-chat` v66 (caching + debug logging)
  - `get-naavi-prompt` v21 (markers)
  - `extract-email-actions` v11 (caching)
  - `extract-document-text` v10 (caching)
  - `ingest-note` v37 (Haiku + caching)
  - `extract-actions` (new version today, Haiku + caching)
- **Migration applied via SQL editor:** `20260422_gmail_sync_cron_reduce_frequency.sql` (15-min cadence for sync-gmail).
- **Anthropic API keys:** both re-enabled for testing; should be re-disabled after the AAB ships unless continuous operation is desired.

---

## 11. Memory files that matter for Session 22

- `project_naavi_location_trigger_plan.md` — Phase 2+ still open; "already inside" check is top priority sub-item
- `project_naavi_voice_call_hang.md` — intermittent Deepgram WS hang (confirmed re-fire in 7-PC)
- `project_naavi_voice_name_search.md` — STT mangling on proper nouns (confirmed in 15-MV)
- `project_naavi_deepgram_first_word_truncation.md` — STT dropping first/middle words (confirmed in 3-MV + 7-PC)
- `project_naavi_next_mobile_build.md` — prior AAB queue (items 1-6 of the new bundle came from here)
- `feedback_test_passes_user_end.md` — reinforced this session (user corrected mid-session)
- `feedback_expose_options_in_constrained_states.md` — S16 fires this pattern

CLAUDE.md **Rule 12** (new): explicit positive approval required for all third-party outbound actions.

---

## 12. Docs produced in Session 21

- `docs/E2E_TEST_MATRIX_SESSION_21.md` — 15 × 3 cells tracker with Apr 22 results
- `docs/AAB_BUNDLE_NEXT_RELEASE.md` — 10 AAB items + 19 server-fix items + P1 principle
- `docs/SESSION_21_HANDOFF.md` — this file
- `docs/NAAVI_CLIENT_ONBOARDING.md` + `.docx` — sign-in fix
- Migration: `supabase/migrations/20260422_gmail_sync_cron_reduce_frequency.sql`

---

## 13. Kickoff sentence for Session 22 — "Continue Testing - Cost - AAB"

> *"Session 22: Continue Testing - Cost - AAB. Read SESSION_21_HANDOFF.md and AAB_BUNDLE_NEXT_RELEASE.md. Three threads from Session 21 to continue: (1) finish the remaining E2E tests (8-PC, 5-PC, retest cells blocked by today's bugs as they get fixed); (2) confirm the nasvi-last daily bill has dropped since caching went live; (3) ship the AAB bundle (V55 build 104), starting with the isBroadQuery regex narrowing (biggest cost lever) and the "already inside" location UX."*
