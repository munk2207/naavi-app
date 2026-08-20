# Phase 0 — Intent Approval — B11f — The Stop Control on Voice

**Date:** 2026-08-19
**Governance version:** v4.0
**Governance level:** Full Phase 1–8 — Voice orchestration, **Protected Core**. Phase 3 and Phase 6 external review both mandatory.
**Status:** Draft. **Awaiting Wael's approval.** No investigation and no code until then.

---

## 1. ⭐ Scope statement — read this first

**This work item targets the VOICE platform only. Mobile is not touched.**

Mobile already has this control and it works: a permanent Stop button in the action row (`app/index.tsx:3898`, wired to `onOrangeButtonPressed` → `stopSpeaking()`). Nothing about the mobile implementation changes, and no mobile file is in scope.

**Testing is on staging only** — voice line `+1 343 504 1572`. T2 built that environment so voice defects can be exercised without production callers.

## 2. User Intent

**Robert must be able to stop Naavi mid-answer on a phone call**, the way he can tap Stop in the app. Today he cannot: she talks until she is finished, and speaking over her has no effect.

Wael's own framing, which is why this is ranked immediately after S1:

> *"When Naavi is talking, sometimes it takes too much if the question has a long answer... we put this stop because Robert does not hear more, either because the answer was irrelevant for him or he does not want to listen. This was a major function corresponding to the STOP key in the mobile."*

## 3. Why this is not an ordinary bug

**On mobile the Stop button is permanent and on screen. On a phone call there is no screen — so speaking over Naavi *is* the Stop button.** It is not a convenience layered on top of a control; it is the entire mechanism. When it fails, voice has no stop control at all, and the only way out of a long or unwanted answer is to hang up on her.

Three things make it worse than the description sounds:

1. **It fails exactly when it is needed.** Nobody interrupts a short answer. The interruption happens on the long one, or the one that went the wrong way — which is precisely when being unable to stop is most costly.
2. **The remaining exit is hanging up.** A user who hangs up on Naavi reads that as the product failing them, and they are right.
3. **It compounds with known latency.** Voice already runs ~20 seconds even for trivial questions ([[project_naavi_latency_issues]]). Slow *and* uninterruptible is a different product from slow.

**This is a parity break, not a defect report** — a primary control that exists on one surface and does not work on the other. CLAUDE.md Rule 19 requires the parity audit to reflect it.

## 4. Success Criteria

Per governance's note for bug fixes, the root cause need not be known yet.

**Primary:** on a live staging call, while Naavi is mid-answer, the user speaks — and **she stops within roughly a second**, reproducibly, across several attempts.

**Secondary:** having stopped, the call remains usable — she listens to what the user says next and responds to it. Stopping must not strand the call in a broken state.

**Regression bar:** a caller who does *not* interrupt hears a complete, uninterrupted answer. Naavi must not start cutting herself off on her own audio.

## 5. In Scope

- The **conversation path** on the voice server — the WebSocket/streaming leg, after the caller is connected.
- Whatever proves to be the cause, whether it sits in transcript delivery, the barge-in trigger, or audio draining.
- One regression test, per Rule 15a, or a documented and surfaced coverage gap if the behaviour genuinely cannot be reached from the harness.
- Updating `docs/MOBILE_VS_VOICE_PARITY_AUDIT_2026-06-12.md`, since this is a parity item (Rule 19).

## 6. Out of Scope

- **Mobile. Anything.** The control works there.
- **[[B11g]] — no barge-in during the PIN and identification prompts.** Same symptom to a caller, different mechanism entirely: those are TwiML `<Play>`/`<Gather>` steps where nothing is listening during playback, by a deliberate 2026-05-13 decision that fixed silent prompts on landlines. Fixing that means re-opening a trade-off with its own regression risk. **Kept separate on purpose** — bundling them would let the larger problem stall the smaller, which is exactly what happened when B11c originally arrived carrying three unrelated defects.
- **Voice latency** ([[project_naavi_latency_issues]]). Related in how it *feels*, unrelated in cause.
- **[[B4b]]** — Deepgram dropping leading words on barge-in. Adjacent and possibly related, but blocked behind B10m and separately tracked. If Phase 1 finds they share a root cause, that is a finding to report, not a licence to widen scope.
- Any change to how Naavi decides *what* to say. This is about stopping her, not about answer length.

## 7. Constraints

- **Voice only.** No mobile files.
- **Staging only** for all testing.
- **Do not reintroduce the landline silence bug.** Whatever the fix, `<Play>` outside `<Gather>` exists for a reason (`index.js:6634`) and that reason has not expired.
- **Protected Core.** `naavi-voice-server/src/index.js` is large and under the No Extra Changes Rule — improvements noticed while reading go in the evidence package, never in silently.
- **No schema changes anticipated.** If Phase 1 finds one is needed, that is a scope change requiring approval, not a judgement call.

## 8. ⚠️ Decision needed before Phase 1

**What should stop her — any speech, or the word "stop"?**

The distinction is not cosmetic, and the two have different failure modes:

1. **Any speech interrupts** (true barge-in). This is what the current code intends (`index.js:9953` triggers on any transcript while speaking) and what a natural conversation does. Risk: a cough, background noise, or a "mm-hm" cuts her off mid-sentence.
2. **Only a keyword** — "stop", "Naavi stop". Predictable and immune to background noise, but the user must remember a magic word, and it is not how people interrupt each other.
3. **Both** — any speech interrupts, and "stop" additionally ends the answer rather than merely pausing it.

**Recommendation: 1.** It is what the code already intends, it needs no user to learn anything, and it matches the mobile button's effect. If background noise proves to cut her off in practice, that is a tuning problem with a known lever (a confidence or duration threshold on the transcript), not a reason to require a magic word up front.

**Note:** Wael has described the behaviour as *"when I say Naavi stop"*, which may mean he expects option 2. This needs his word before Phase 1 investigates, because the two answers point at different code.

## 9. Completion Criteria

1. The root cause is stated with direct evidence — file path, line, and a log line or measurement. No "probably".
2. On a live staging call, speaking over Naavi stops her within ~1s, verified across several attempts on real hardware.
3. The call remains usable afterwards.
4. A caller who does not interrupt is not cut off.
5. A regression test exists, or the coverage gap is documented and explicitly surfaced.
6. The parity audit and, if the fix moves any ownership, the Architecture Reference are updated in this work item.
7. Phase 3 and Phase 6 external reviews completed.

## 10. What Phase 0 does not authorize

No investigation, no code, no deployment. Phase 1 begins only on Wael's explicit go-ahead, and the §8 decision is needed first.

---

**Awaiting: (a) the §8 decision, and (b) approval of this Phase 0.**
