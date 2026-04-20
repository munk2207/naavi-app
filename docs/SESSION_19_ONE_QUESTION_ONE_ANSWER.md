# Session 19 — One Question, One Answer

## The principle (read this first, every time)

**Robert asking the same question must receive the same answer. Every time. Predictably.**

Not "usually." Not "most of the time." Every time.

When Robert says *"what time is it,"* he should not care how he phrased it, how clearly he spoke, whether he paused before speaking, whether Deepgram dropped a word, whether the server was under load. The answer should be the same and the latency should be within a predictable budget.

Today it is not. Robert gets:
- Sometimes 2 seconds, sometimes 10, sometimes nothing.
- Sometimes Naavi answers from the calendar. Sometimes she says "nothing found" while the calendar has the answer.
- Sometimes the same phrasing works, sometimes it doesn't.

**Each inconsistency is a trust fracture.** For a senior user who is being asked to depend on this product, one unexplained silence outweighs ten successful answers. Once trust cracks, the product stops being used.

## What this session is NOT

- Not about fixing three specific bugs (transcript dropout, first-word truncation, STT garbling).
- Not about shaving latency.
- Not about adding features.

Those are outputs, not the goal. The goal is consistency. If fixing transcript dropouts gets us there, we fix transcript dropouts. If we need to retry a failed transcription, we retry. If we need to relax the trivial-query regex, we relax it. If the answer is a different STT vendor, that's on the table.

## How we'll know we're done

A battery of the same functional question asked ten different ways — fast and slow, with and without pauses, in noisy and quiet conditions — must yield the same answer ten times. Latency must land in a predictable band. Silent failures must be zero.

Until that battery passes, this session is not done.

## Inputs from Session 18

Session 18 established that the data pipeline is correct — the voice server's pre-search grounding (commit `bc6ba2e`) means Naavi's voice answers are now based on real search results. What remains is everything between Robert's voice and the pre-search input being deterministic.

Known contributors to inconsistency (diagnosed but not fixed):
- Deepgram intermittent transcript dropout — call appears dead, Deepgram state OPEN, no FINAL line produced.
- Deepgram first-word truncation during barge-in — "what time is it" arrives as "Time is it?", knocks trivial queries off the fast path.
- Trivial fast-path regex requires exact leading "what" — breaks when Deepgram drops it.
- STT unreliable for structured data (emails, phone numbers, addresses).
- Knowledge noise threshold (0.5) not applied in the voice-side `searchKnowledgeSpecific` path — only in `global-search/adapters/knowledge`.

These are starting points, not a checklist. The session's success is measured by the consistency outcome, not by clearing the list.

## Carryover — other queued items (not this session)

- Attachment / OCR harvesting (future major feature).
- Button label clipping on home screen (cosmetic).
- Multi-user audit in voice server (grep for `/rest/v1/...` without user_id filter).
- Stale worktree cleanup.

## Work log

(to be filled when Session 19 starts)
