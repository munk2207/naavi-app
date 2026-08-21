# B11f — Phase 0: Intent Approval

**Work item:** [[B11f]] — Naavi cannot be interrupted mid-answer on a voice call
**Date:** 2026-08-21
**Governance:** Full Phase 1–8 (Voice orchestration — Protected Core)
**Status:** awaiting Wael's approval. **No implementation may begin until this is approved.**

---

## Why this Phase 0 exists at all

B11f is not new. It was implemented, reverted, re-implemented, and currently **works on voice
staging** — Wael confirmed pause and resume on a live call on 2026-08-20.

It is nonetheless **held back from production**, for two reasons recorded the same day:

1. **The re-attempt had no governance phases.** The first attempt reached Phase 4 and was reverted
   for breaking normal conversation. The fix that followed — two root causes, found the same day —
   went in without any phase document.
2. **The mechanism has no tests.** Investigation for this Phase 0 found the gap is wider than the
   holding-list entry states:

   | Function | What it decides | Tests |
   |---|---|---|
   | `bytesSpokenSoFar` | how much of the answer the caller already heard | **0** |
   | `resumePointOf` | **where the answer resumes from** | **0** |
   | `holdAnswer` | what is retained when paused | **0** |
   | `endSpeech` | when speaking is considered finished | **0** |

   The 17 existing tests in `test/pauseCommand.test.js` cover only the **word vocabulary** — which
   words mean pause, resume, cancel. That was root cause 1. **Root cause 2, the fast path that
   produced the silent failure, is untested, as is everything that decides what the caller hears
   on resume.**

**Why they are untestable rather than merely untested:** all four are closures defined inside the
WebSocket connection handler in `naavi-voice-server/src/index.js`. Nothing can import them. Writing
a test against a *copy* of the logic would be worse than having none — it would pass while the real
code broke, which is the exact failure `tests/catalogue/s1-voice-pin-scoping.ts` documents in its
own header.

**This phase does not propose re-attempting B11f.** It proposes making the working implementation
promotable.

---

## User Intent

Bring B11f to a state where it can be promoted to voice production with the same confidence as any
other governed change: its mechanism covered by automated tests, and its governance record complete.

---

## Success Criteria

1. The four functions above are reachable by the test suite, and covered by tests that assert
   **caller-visible behaviour** — where the answer resumes, not merely that a function returns a
   number.
2. Pause and resume behave on staging exactly as they do today. **This is a no-behaviour-change
   work item.** Any observable difference is a defect, not an improvement.
3. The governance record exists: Phases 0–8, including an external review at Phase 6.
4. `npm test` in the voice server stays green, and the `no-undef` pre-push gate stays green.

---

## In Scope

- Extracting `bytesSpokenSoFar` and `resumePointOf` from the connection handler into a module under
  `src/voice/`, as **pure functions taking their state as arguments** — the pattern already
  established by `pauseCommand.js`, `parseReminderTime.js` and `resolveEffectiveTimezone.js`.
- Whatever narrower extraction proves possible for `holdAnswer` and `endSpeech`, which mutate
  closure state and may not be cleanly separable. **Phase 1 decides; this phase does not assume they
  can be.**
- Tests for those functions.
- The Phase 1–8 documents.

## Out of Scope

- **Any change to what pause and resume do.** Not the vocabulary, not the 5-minute hold TTL, not
  the "back up one sentence" resume rule, not the "as I was saying" wording.
- Promotion to production. That is a separate decision after Phase 8, and per governance line 146
  it needs Wael's own explicit word.
- The `sendAudioToTwilio` path's 43 call sites, deliberately untouched by B11f's original design.
- Mobile. B11f is voice-only.

## Constraints

- **Voice only. No mobile, no UI, no schema changes, no architecture changes.**
- **Behaviour-preserving.** The arithmetic moves; it does not change.
- Staging only. Production promotion is out of scope, as above.
- The extraction touches the exact code path that broke normal conversation in July. That history
  is the reason for the constraint, not an argument against the work.

## Completion Criteria

1. `bytesSpokenSoFar` and `resumePointOf` live in `src/voice/`, imported by `index.js`.
2. Tests exist covering, at minimum: nothing heard yet resumes from the top; a pause inside the
   first sentence resumes from the top; a pause inside the third sentence resumes at the **second**
   sentence (the deliberate one-sentence rewind); text containing no sentence boundary; and
   `bytesSpokenSoFar` clamping at both zero and the buffer length.
3. Voice suite green, including the existing 17 vocabulary tests unchanged.
4. Wael confirms on a live staging call that pause and resume behave as they did before.
5. Phase 8 complete, with the Architecture Reference updated if §2's voice rows change.

---

## One question that needs Wael's answer, and may change scope

**Something already responds to "stop" on production, where B11f does not exist.** On 2026-08-20
Wael tested the production line and reported *"the stop worked, start did not recognize it"* —
expected for "start", since the resume vocabulary is B11f's. But "stop" did something.

An earlier note records that after the July revert, saying "stop" made Naavi **restart the answer
from the beginning**. Two questions were asked at the time and never answered: whether it restarted
word-for-word from the top, and whether she paused first.

**Why it matters here:** if a pre-existing stop path still exists alongside B11f's, staging now has
**two mechanisms responding to the same word**. That is worth knowing before adding test coverage
that would lock in whichever one currently wins.

**Wael's answer decides whether Phase 1 investigates this or explicitly rules it out of scope.** It
is not a blocker to approving this Phase 0 — only to closing Phase 1.

---

## Required output

Approve, approve with changes, or reject. Per governance §Phase-Gate Approval Rule, no
implementation begins — including drafting Phase 1 — until Wael's own explicit go-ahead.
