# ADDRESS TIMING ISSUE — Session Handover

**Date opened:** 2026-04-18
**Opened in:** Session 14
**Owner:** next dedicated voice-latency session
**Status:** NOT fixed. Voice server reverted to pre-session baseline (still slow). No live production change remains from this work.

---

## The problem in one line

Voice calls and mobile chat both take far too long to respond to trivial questions. Target user is a senior; anything over ~3s feels broken to them.

## Observed latencies (measured today)

| Surface | Query | Observed earlier today | After restart |
|---|---|---|---|
| Twilio voice call | "What is my name?" | ~20s | **30–40s first, ~30s follow-ups** |
| Mobile app chat (voice input → text response) | "What is my name?" | ~15s | (not re-measured) |

Multi-user routing is proven **working** (Wael identified correctly by caller phone → user_id → voice said "Wael" correctly). The problem is speed only, not correctness.

**Important**: voice baseline got *worse* during today's session after multiple deploy/revert cycles. Before another round of changes, re-measure on a clean morning to confirm whether 30–40s is the new normal or a temporary post-deploy state.

## What was attempted today (and WHY IT FAILED)

### Fix A — Anthropic prompt caching on the voice server system prompt

Commits: `f6ce02c` (initial), `efcbb4f` (first revert), `1bc83e4` (re-apply), `47172ce` (final revert).

**The change**: split the system prompt into a static prefix (base prompt from `get-naavi-prompt` Edge Function) marked with `cache_control: { type: 'ephemeral' }`, plus a dynamic suffix (calendar + knowledge) without caching. Added usage logging to observe `cache_read` vs `cache_write` tokens.

**What happened**: TWO separate deploys of this change both caused the voice server to hang for 50+ seconds with no response. The user hung up. Reverting + restarting Railway restored service each time.

**Why this is confusing**: the failure mode in the logs was **Deepgram never emitting any `Results` events** (Deepgram WS connected but no transcripts). The hang was BEFORE the code path that `askClaude()` sits in. Fix A only touches `askClaude()`. So structurally the change cannot explain the hang.

**Open hypothesis**: rapid Railway deploy/revert cycles destabilize the container — fresh containers may have transient audio-forwarding problems for Twilio → Railway → Deepgram direction. This is a Railway infrastructure theory, not a code theory. It fits the evidence that every restart eventually restored service without any code change.

**Do not re-attempt Fix A until** a single deploy can be run in isolation (no other deploys that day) with full instrumentation in place to see the real root cause.

## Fixes planned but NOT attempted

1. **Cache `fetchSharedPrompt` per call** — fetch the shared prompt once at call start, reuse every turn. Today it's re-fetched per turn. Savings: 500ms–2s per follow-up turn. Low risk.

2. **Skip Supabase context fetches on trivial questions** — "what is my name", "what time is it", greetings don't need calendar or knowledge context. Add a classifier. Savings: 500ms–1s per turn. Low risk.

3. **Stream Claude response + incremental TTS** — biggest win, biggest risk. Parse streaming JSON, extract `speech` field progressively, send sentence-by-sentence to Deepgram TTS, stream audio to Twilio as it arrives. Savings: 30–50% of perceived latency. ~200 lines of code. Do this last.

## Lessons from today (follow them next session)

1. **Add instrumentation FIRST, change code SECOND.** Before any more fixes, add detailed `[Timing]` logs around every step in `askClaude()` and the voice call pipeline:

   - STT final transcript received → askClaude entered
   - askClaude entered → Supabase queries returned
   - Supabase returned → fetchSharedPrompt returned
   - fetchSharedPrompt returned → Claude API fetch started
   - Claude API fetch started → first byte received
   - First byte → last byte
   - Last byte → TTS fetch started
   - TTS fetch started → audio bytes returned
   - Audio bytes returned → sendAudioToTwilio called
   - Deploy this instrumentation change ALONE, measure real numbers from live calls, then fix the actual bottleneck.

2. **Never deploy and revert in quick succession without a full container restart in between.** Today's pattern (deploy → revert → deploy → revert) seemed to destabilize the Railway container for tens of minutes. Always `Redeploy` the active version and wait 3+ minutes before testing the next change.

3. **The intermittent voice call hang is a separate pre-existing bug.** See `project_naavi_voice_call_hang.md`. Don't confuse it with latency issues. First sign: Deepgram connects but emits no `Results` events. Workaround: hang up + redial + possibly Railway restart.

4. **Mobile chat latency is likely the same root cause.** `naavi-chat` Edge Function + `get-naavi-prompt` path is shared (mostly) with the voice server. Fixing voice will very likely fix mobile at the same time — but measure both separately to be sure.

## Current production state (as of this handover)

- Voice server: latest commit `47172ce` (revert #2). No prompt caching, no streaming. Same code as yesterday except for documentation.
- Mobile app: no change today; still on Play Store build 92.
- Morning call flow: untouched.
- Multi-user routing: confirmed working for Wael (not retested for Huss today).

## Quick wins NOT requiring a new session

None that are safe to deploy today. Anything that touches the voice server should wait for the dedicated instrumentation-first session described above.

## Related memory files to read before starting

- `project_naavi_latency_issues.md` — symptoms and early hypothesis
- `project_naavi_voice_call_hang.md` — the intermittent hang that confused today's debugging
- `project_naavi_next_mobile_build.md` — mobile-side latency entry (same root cause)
- `CLAUDE.md` → VOICE CALL section — "no silence allowed" rule
