# Session Handoff — 2026-06-16 — Compound Question Queue (WIP)

## Status: NOT WORKING — Next session must fix before anything else

The compound question queue (voice multi-action) was the entire focus of this session.
It is structurally present but **actions do not execute**. Do not move on to anything else
until this is confirmed working end-to-end.

---

## What the feature is supposed to do

When Robert says 4 things in one request:
1. Send Sarah email asking for her budget review
2. Book meeting with Bob this Tuesday at 11 AM
3. Send me my work list when I arrive at my office
4. Remind me to call Jasmine one day before her birthday

Naavi should:
- Split into 4 sub-tasks
- Call Claude once per sub-task (executive secretary pattern)
- Queue all 4 results
- Step through them one at a time: read the task, wait for "yes" / "no", execute, move to next

---

## What was shipped this session (naavi-voice-server, Railway auto-deployed)

### 1. Compound detection before Claude (pre-split)

`naavi-voice-server/src/index.js` — before the `askClaude` call, `splitCompoundRequest(text)` is called.
If 2+ tasks detected → loop `askClaude` per task → build `pendingMultiAction` queue →
announce "I have N things to handle. First: [task 1]. Say yes to confirm or no to skip."

### 2. deferredText buffer (Deepgram chunk-drop fix)

When Deepgram splits a 4-sentence compound into 2 UtteranceEnd chunks, chunk 2 was being
dropped because `isProcessing=true` when it arrived.

Fix: buffer chunk 2 to `deferredText`. After chunk 1 finishes, `releaseProcessing()` fires
`processUserMessage(deferredText)` which hits the continuation-append path in `pendingMultiAction`
gate and adds tasks 3+4 to the queue.

Variables added: `let deferredText = ''` (line ~7727)
Helper added: `function releaseProcessing()` (line ~8940)
UtteranceEnd gate updated: buffers instead of drops when `isProcessing=true`
Two `isProcessing = false` calls replaced with `releaseProcessing()`:
- Compound path exit (~line 10075)  
- Main path end (~line 11312)

### 3. Deepgram timing increased

`utterance_end_ms`: 1000 → **2500**
`endpointing`: 300 → **700**

Gives Robert more time to finish long sentences without being cut off.

---

## Test result from Wael (2026-06-16)

Transcript:
> "I have 4 things to handle. First, draft an e-mail to Sarah asking for her budget review.
> Say yes to confirm. Yes. Sorry I couldn't find an e-mail address for Sarah. Email drafted.
> Next. I'll add a meeting with Bob to your calendar this Tuesday, June 17 at 11 AM. Say yes
> to confirm. Yes. Got it. Next. Yes. Start set. Next, I'll set a reminder for you to call
> Jasmine one day before her birthday... Say yes to confirm. Yes. Got it. All done."

**Actual outcomes — ALL FAILED:**
1. Email Sarah — Naavi said "Sorry I couldn't find an email address for Sarah" — nothing sent
2. Bob meeting — Naavi read the plan but **no calendar event was created**
3. Work list (location alert) — **missing from queue entirely, never announced**
4. Jasmine reminder — Naavi read the plan but **no reminder was created**

---

## Root cause (not yet investigated)

The queue steps through and Naavi speaks each item — but the `executeAction()` calls
inside the yes-branch of the pendingMultiAction gate are not producing results.

Likely causes to investigate:
1. **Actions array is empty** — each `askClaude` sub-call may return `speech` but empty `actions[]`,
   because Claude returns a conversational reply instead of a structured action when called with
   a single sub-task sentence (no context that this is a "do it" request, or B4y Phase 2 gate drops it).
2. **B4y Phase 2 gate** (line ~3723) — drops `CREATE_EVENT`, `SET_REMINDER`, `SET_ACTION_RULE`,
   `DRAFT_MESSAGE` etc. unless the prior assistant turn contained "say yes to confirm". Since each
   `askClaude` sub-call is independent with a fresh conversation context, the gate may be blocking.
3. **Work list (#3) missing** — `splitCompoundRequest` may not be detecting it as an actionable task.
   Check what `splitCompoundRequest("Send me my work list when I arrive at my office")` returns.

**Investigation starting point:**
- Add logging: after each `askClaude(task, ...)` call in the compound loop, log `task`, `r.speech`, `r.actions`
- Check Railway logs for what actions Claude actually returned per sub-task
- Check if B4y gate is silently dropping actions in sub-task calls

---

## Key files

| What | Where |
|---|---|
| Voice server | `naavi-voice-server/src/index.js` |
| splitCompoundRequest | ~line 4170 |
| pendingMultiAction gate | ~line 9125 |
| Compound detection / askClaude loop | ~line 10030 |
| releaseProcessing() | ~line 8940 |
| B4y Phase 2 gate | ~line 3723 |

---

## What NOT to do next session

- Do NOT run auto-tester until compound queue is confirmed working end-to-end
- Do NOT move on to other features until Wael confirms all 4 actions execute correctly
- Do NOT assume Naavi's spoken response means the action executed — verify DB rows

---

## Commits this session (naavi-voice-server)

- `b466e60` — deferredText buffer + releaseProcessing() fix
- `edac64b` — Deepgram endpointing 300→700ms, utterance_end_ms 1000→2500ms
