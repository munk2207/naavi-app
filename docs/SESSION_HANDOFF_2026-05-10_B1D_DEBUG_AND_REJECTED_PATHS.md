# Session Handoff — 2026-05-10 — B1d debug + REJECTED PATHS

**Read this in addition to `docs/SESSION_HANDOFF_2026-05-09_F1A_F1D_SPECS.md`. This handoff covers the late-session debugging that happened after the prior handoff was written.**

---

## ⚠️ CRITICAL — Wael REJECTED all of my proposed paths at session end

Late in this session I (the agent) presented three options to Wael for how to proceed with the B1d bug fix:

1. **Trigger an AAB build now** — bundle B1d fix with other queued mobile fixes (B3a path-1, B1b, B3b, B3c).
2. **Apply a server-side knowledge-adapter threshold fix** in addition to the queued AAB.
3. **Skip both** — defer the AAB.

**Wael rejected all three.** No AAB was triggered. The knowledge-adapter threshold fix was NOT applied. The decision on how to proceed from here is **explicitly open** and **deferred to the next session under Wael's direction**.

**To the next agent reading this:** do NOT assume any of those three paths is the right one. Wael did not endorse any of them. Ask him fresh how he wants to proceed.

---

## What happened in the late-session debugging

After the prior handoff was written, Wael continued testing on MV (mobile chat) and discovered a serious bug:

### The bug pattern (B1d)

- After the day's mobile-side server fixes (B2e widening + day-label format) deployed, MV started giving **wrong answers** on email queries.
- Specifically: a Birthday Party email arrived 2026-05-09 at 2:19 PM ET (~16 hours before the test). When Wael asked *"Do I have email about birthday party?"* on MV, Naavi sometimes said *"I don't have an email about a birthday party in your records"* — even though the email IS in his Gmail inbox AND in the system prompt's Recent emails section (live-overlay).
- Initial pattern observed: **first question after force-stop = correct, second question (same phrasing) = wrong.**
- Wael's deep test at 6:50 AM confirmed: recent emails (<1h old, like a fresh "Hockey Game" email) are found consistently. Older emails (16h old like BD party) are missed consistently. Multiple repeats with same phrasing.

### Root cause traced via investigator agent

Two investigators were spawned. Combined finding:

1. **Primary cause** — [`hooks/useOrchestrator.ts:1202`](hooks/useOrchestrator.ts:1202) injects a hard gag instruction into the user message when client-side pre-search (`global-search` Edge Function) returns 0 hits: *"Nothing matched. Say that plainly — do not guess."* This gag rides INSIDE the user message and overrides the system-prompt's live-overlay (Recent emails section). Claude obeys the gag.

2. **Secondary cause** — pre-search returns asymmetric results because:
   - The literal-substring adapters (gmail, email_actions) cannot match natural-language queries like *"email about birthday party"* against subject *"Birthday Party"*.
   - The only adapter that COULD return a hit is the knowledge adapter via semantic embedding similarity, which has a `MIN_SIMILARITY = 0.5` threshold at [`supabase/functions/global-search/adapters/knowledge.ts:108`](supabase/functions/global-search/adapters/knowledge.ts:108). Borderline scores (0.49–0.52) flicker between calls due to pgvector ordering and OpenAI embedding variance.
   - For "Hockey Game" queries, the drive adapter accidentally returns a hit from an unrelated "Naavi Conversation" Drive doc — preventing the gag from being injected, so Claude correctly uses the live-overlay.
   - For "Birthday Party" queries, no adapter returns hits → gag injected → Claude obeys it.

### The fix shipped to main (commit `b667115`)

The orchestrator's gag-injection text at [`useOrchestrator.ts:1202`](hooks/useOrchestrator.ts:1202) was downgraded from:

> *"Nothing matched. Say that plainly — do not guess."*

To:

> *"No cached search hits in calendar, contacts, memory, lists, email, rules, or sent messages. Defer to live data in the system prompt (Recent emails, Schedule, etc.) before saying you don't have something."*

This fix tells Claude to defer to the system-prompt sections (which already have the email via live-overlay) instead of obeying the override. Once it ships in an AAB, B1d should be resolved.

**The fix is in `main` (commit `b667115`) but has NOT shipped to Wael's installed app — AAB is pending and was NOT triggered this session.**

### What was NOT done (per Wael's rejection)

- AAB build was NOT triggered. Wael's installed app still has the buggy code.
- The deeper knowledge-adapter threshold fix at [`knowledge.ts:108`](supabase/functions/global-search/adapters/knowledge.ts:108) was NOT applied. The borderline-flicker still exists for any query that depends on knowledge-fragment semantic similarity.
- No server-side workaround was deployed.

---

## Other late-session work that DID ship

### B2e (already in prior handoff but expanded)

Recent-emails 1-hour window was widened to 24 hours (`newer_than:1h` → `newer_than:1d`), with a day-label format addition (*"arrived yesterday at 2:19 PM"* vs *"arrived today at..."*). Both surfaces.

Voice-server commits: `5888565`, `1cce5a0`, `9c5b962` (revert), `94709f7` (re-apply). Final state: `94709f7` is live on Railway.

naavi-chat commits: `5311ea2`, `82516dc`, `635bb60` (revert), `d20a055` (re-apply). Final state: `d20a055` Edge Function is deployed.

### Mobile app caching observation (not yet a tracked bug)

Wael discovered that the mobile app's session state persists through server-side deploys until force-stop. Specifically: even after a confirmed Edge Function deploy, the SAME mobile chat session continued returning old behavior. After force-stop + reopen, new behavior took effect.

This is connected to the broader "mobile auth/state staleness" pattern (memory `project_naavi_mobile_tts_loss.md`) but the root cause for THIS specific symptom (state cached across server deploys) was NOT pinned down. Investigator's hypothesis was the AppState listener leak in [`lib/supabase.ts:104-112`](lib/supabase.ts:104), but that hypothesis didn't fully explain the 1st-correct-2nd-wrong pattern. The B1d gag-injection finding superseded it as the primary cause.

**However, the AppState listener leak hypothesis is NOT verified or refuted.** Worth investigating further if mobile state staleness symptoms surface again.

---

## State of the holding list

Updated at end of session (2026-05-10):

- **Active items: 21** (was 20 at prior-handoff time; B1d added)
- **Bugs: 9** (was 8; B1d added)
- **Closed without entry: 10**
- **Total items: 31**

New active item added this round:

| ID | Status |
|---|---|
| **B1d** Pre-search gag overrides live-overlay | Identified 2026-05-10. Fix in main as commit `b667115`. AAB not triggered this session. Wael's install needs next AAB to pick up. |

---

## What the next agent should do

1. **Read this handoff first**, then `docs/SESSION_HANDOFF_2026-05-09_F1A_F1D_SPECS.md`, then `CLAUDE.md` rulebook.
2. **Do NOT assume** that any of the three rejected paths (AAB-now / knowledge-threshold fix / defer) is the right path forward for B1d. Wael explicitly rejected all three. Ask him fresh.
3. **Do NOT trigger an AAB** without explicit approval. Per Rule 1.
4. **The B1d code fix exists in main** at commit `b667115`. It can be redeployed via AAB whenever Wael decides. The fix has not been verified in production because no AAB has shipped it.
5. **The knowledge-adapter threshold flicker is a known issue** ([`knowledge.ts:108`](supabase/functions/global-search/adapters/knowledge.ts:108)) but should NOT be fixed without Wael's direction — he rejected applying it this session.

## Commits this session (after the prior handoff)

| Commit | Repo | What |
|---|---|---|
| `5888565` | naavi-voice-server | B2e: widen live-overlay 1h → 24h |
| `5311ea2` | naavi-app | B2e: same on naavi-chat |
| `1cce5a0` | naavi-voice-server | B2e follow-up: include "today"/"yesterday" |
| `82516dc` | naavi-app | Same on naavi-chat |
| `9c5b962` | naavi-voice-server | Revert day-label fix (briefly, then re-applied) |
| `635bb60` | naavi-app | Same revert |
| `94709f7` | naavi-voice-server | Reapply day-label fix |
| `d20a055` | naavi-app | Same reapply |
| `b667115` | naavi-app | **B1d gag-injection fix (mobile, AAB pending)** |
| `a761220` | naavi-app | Add B1d to holding list |

## Memory file updates

- `project_naavi_music_queue_latency.md` — already updated in prior handoff (drain decision reversal).
- No new memory file updates this round.

## Files to read alongside this handoff

- `docs/SESSION_HANDOFF_2026-05-09_F1A_F1D_SPECS.md` — the prior session handoff
- `CLAUDE.md` — Rules 1–17 (foundational rulebook). Rule 11 in particular: NEVER recommend pacing/stopping based on time, day, or freshness.
- `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md` — current state of all 31 items
- `docs/F1A_LISTS_AND_CONNECTIONS_SPEC.md` — Lists wired to events spec
- `docs/F1D_USER_CONTROLLED_MUTE_SPEC.md` — User-controlled mute spec
