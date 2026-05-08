# PC Latency Investigation

**Started:** 2026-04-26
**Goal:** bring the typical PC voice-call turn from ~15-20s down to **4-6s for trivial questions, 8-10s for retrieval/action**.

---

## Stage map (from `naavi-voice-server/src/index.js` instrumentation)

Every PC turn passes through these markers, in order:

| Marker | Where | What it measures |
|---|---|---|
| `[TimingPre]` `speechDetectedAt` | Deepgram | First speech sound detected |
| `[TimingPre]` `firstFINAL` | Deepgram | First final transcript chunk |
| `[TimingPre]` `lastFINAL` | Deepgram | Last final transcript chunk |
| `[TimingPre]` `UtteranceEnd→T0` | Deepgram | Endpoint detected → server starts |
| **`T0`** | Server | `processUserMessage` entered (baseline = +0ms) |
| **`T1`** | askClaude | Function entry |
| **`T2`** | askClaude | Calendar + knowledge + weather + global-search fetched in parallel |
| **`T3`** | askClaude | Extra lookups done (person/entity/NATO spelling) |
| **`T4`** | askClaude | Base prompt ready (`get-naavi-prompt` Edge Function or local fallback) |
| **`T5`** | askClaude | Claude API call sent |
| **`T5a`** | askClaude | Claude first byte (TTFB) |
| **`T5b`** | askClaude | Speech field extracted mid-stream → TTS fires in parallel |
| **`T6`** | askClaude | Claude stream complete |
| **`T7`** | processUserMessage | askClaude returned |
| **`T8`** | processUserMessage | TTS stream start (or pre-generated audio dispatched) |
| **`T10`** | processUserMessage | Audio dispatched to Twilio (TOTAL) |
| `[TimingPost]` `Mark` | Twilio | response_end mark received |

---

## Critical path analysis (from code structure, before measuring)

### Trivial question (e.g. "what's my name", "what time is it")

```
[Pre-T0]  Deepgram silence wait     ~500-1500ms   (configurable, current setting unknown)
T0 → T1   askClaude entry           ~5ms          
T1 → T2   Skipped (trivial bypass)  ~5ms          ✓ optimization in place
T2 → T3   No extra lookups          ~5ms          
T3 → T4   Base prompt cached?       ~50-800ms     first-turn pays cost; cached on follow-ups
T4 → T5   Build system prompt       ~10ms         
T5 → T5a  Claude TTFB (Haiku)       ~600-1500ms   Haiku is fast
T5a → T5b Speech field parseable    ~200-500ms    (depends on prompt complexity)
T5b → T8  Parallel: TTS starts      0ms          ✓ streaming TTS in place
T6 = T8   Claude finishes           ~1000-2500ms  
T8 → T10  TTS finishes streaming    ~500-1500ms   
TOTAL pre-T0: ~500-1500ms
TOTAL T0-T10: ~2500-5500ms
EXPECTED TOTAL: 3-7 seconds
```

### Non-trivial question (e.g. "find the warranty for my washing machine")

```
[Pre-T0]  Deepgram silence wait     ~500-1500ms
T0 → T1   askClaude entry           ~5ms
T1 → T2   PARALLEL fetches          ~500-2000ms   ← potential bottleneck #1
            - fetchCalendarEvents (Supabase ~100-300ms)
            - fetchAllKnowledge OR searchKnowledgeSpecific (~200-800ms)
            - fetchWeather if weather query (~200-500ms)
            - fetchGlobalSearch if retrieval intent (~500-2000ms)  ← biggest variability
T2 → T3   Extra lookups             ~100-500ms    (contact, entity, NATO)
T3 → T4   Base prompt cached?       ~50-800ms     
T4 → T5   System prompt assembled   ~10ms         
T5 → T5a  Claude TTFB (SONNET)      ~1500-3500ms  ← BOTTLENECK #2: Sonnet is slow
T5a → T5b Speech parseable          ~500-1500ms   
T5b → T8  TTS fires in parallel     0ms          ✓
T6        Claude finishes           ~3000-7000ms  ← BOTTLENECK #2 cont.
T7 → T8   Synchronous action loop   ~0-3000ms     ← BOTTLENECK #3 for some action types:
            - LIST_READ              ~200-500ms
            - GLOBAL_SEARCH          ~500-2000ms (and we already pre-fetched it!)
            - FETCH_TRAVEL_TIME      ~700-2000ms (Google API + retry)
            - SET_ACTION_RULE/loc    ~500-1500ms (resolve-place + commit)
T8 → T10  TTS finishes              ~500-1500ms
TOTAL pre-T0: ~500-1500ms
TOTAL T0-T10: ~6000-15000ms
EXPECTED TOTAL: 7-17 seconds
```

---

## Top 5 bottleneck candidates (ranked by likely impact)

### 1. Sonnet 4 vs Haiku 4.5 for non-trivial queries
- **Where:** `naavi-voice-server/src/index.js:1526`
- **Current:** every non-trivial query uses `claude-sonnet-4-20250514`
- **Cost:** Sonnet TTFB ~1500-3500ms, Haiku ~600-1200ms — **savings ~1500-2500ms per non-trivial turn**
- **Risk:** Haiku may pick wrong action JSON or generate weaker speech for complex multi-action queries
- **Fix:** test Haiku for the 80% of queries that are simple lookups (calendar, knowledge, single-action). Keep Sonnet only for compound utterances and long-context reasoning. Add a `complexQueryRe` heuristic to gate model choice.

### 2. Pre-fetch global-search even when Claude won't use it
- **Where:** `naavi-voice-server/src/index.js:1226` (inside Promise.all)
- **Current:** every retrieval-intent query fires `fetchGlobalSearch` to pre-load context for Claude
- **Cost:** 500-2000ms per call, mostly wasted when Claude emits its own GLOBAL_SEARCH action that runs again later
- **Fix:** measure how often pre-search results actually appear in Claude's reply. If <30%, drop pre-search and let Claude's GLOBAL_SEARCH action handle it (synchronously, but only when needed).

### 3. Synchronous post-Claude action loop
- **Where:** `naavi-voice-server/src/index.js:4806+` (FETCH_TRAVEL_TIME, GLOBAL_SEARCH, SET_ACTION_RULE/location handlers)
- **Current:** these block the response — TTS can't start until the action completes
- **Cost:** 500-3000ms for affected actions
- **Fix options:**
  - (a) Speak Claude's pre-action speech immediately, then speak the action result as a follow-up phrase ("Hold on... Your dentist is...")
  - (b) Move heavier actions (FETCH_TRAVEL_TIME) to a 2-turn flow where the user hears confirmation first
  - Note: these conflict with the user's "no silence" rule — needs design care

### 4. Knowledge fragment dump in system prompt (tail block)
- **Where:** `naavi-voice-server/src/index.js:1314-1316` (knowledgeContext appended after CACHE_BOUNDARY)
- **Current:** broad knowledge query loads ALL fragments (often 50+ rows) into the prompt tail
- **Cost:** every turn re-bills these tokens AND Claude has to read them. Tail can be 2-4k tokens.
- **Fix:** retrieve top-N most relevant fragments via embedding search (already exists in `searchKnowledgeSpecific`) — use broad-load only when the user genuinely asks "tell me what you know about me".

### 5. Deepgram endpointing wait (pre-T0)
- **Where:** Deepgram WebSocket config
- **Current:** Deepgram waits for utterance-end signal (silence threshold) before sending FINAL transcript
- **Cost:** 500-1500ms of pure silence after the user stops speaking
- **Fix options:**
  - Tune `endpointing` parameter (currently might be 1000ms, could go to 500ms)
  - Use `interim_results` to start work earlier (server reads partial transcript and pre-loads context speculatively)
  - Risk: cutting endpointing too short causes false-end on natural pauses mid-sentence

---

## What I need from you next

**One Railway log section** of a recent slow PC call so I can validate these estimates against actual numbers. Steps:

1. Make a call to **+1 249 523 5394**
2. Ask any non-trivial question (e.g. *"What's on my calendar today?"* or *"Find the warranty for my washing machine"*)
3. Hang up
4. Open Railway → naavi-voice-server-production → Deploy Logs
5. Search for `[Timing] T0` and find the most recent one
6. Copy from that line down to `[Timing] T10` (~15-20 lines)
7. Paste here

With actual numbers, I can:
- Confirm which bottleneck is the real culprit (vs which I overestimated)
- Estimate savings per fix more precisely
- Apply the highest-leverage fix first, then re-measure

---

## Optimization plan (will update after seeing real numbers)

### Phase 1 — Zero-risk wins
- [ ] Verify Anthropic prompt cache is actually hitting (look for cache_read_input_tokens in Claude response)
- [ ] If cache is missing on follow-up turns, fix the structure
- [ ] Ensure no Claude SDK retries are eating silent seconds

### Phase 2 — Medium-risk wins (need a quick A/B)
- [ ] Promote more queries to Haiku
- [ ] Drop pre-search when Claude's GLOBAL_SEARCH action handles it instead
- [ ] Tune Deepgram endpointing

### Phase 3 — Higher-risk redesigns
- [ ] 2-phase response for slow actions (speech first, action result follow-up)
- [ ] Speculative pre-fetch on interim transcripts
- [ ] Load knowledge fragments only when needed

---

*Will populate the actual measurements once Wael provides a log.*
