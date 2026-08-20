# Phase 0 — Intent Approval — B11f — The Stop Control on Voice

**Date:** 2026-08-19
**Governance version:** v4.0
**Governance level:** Full Phase 1–8 — Voice orchestration, **Protected Core**. Phase 3 and Phase 6 external review both mandatory.
**Status:** **AMENDED 2026-08-19 — see Amendment 1.** The approved intent changed from *stop = cancel* to *stop = pause, resume on request*. Phase 1 and Phase 1A findings survive the amendment; Phase 2 and Phase 3 must be revisited for the added scope.

---

---

# ⭐ Amendment 1 — "Stop" means PAUSE, not cancel (Wael, 2026-08-19)

**This amendment supersedes §2, §4, §5 and §9 below. Those sections are retained unchanged for the record — read this first.**

## A1.1 What changed, and why

The original intent was *stop her talking*, implemented as cancellation: the answer is discarded and the caller asks again if they want it.

**Wael's reframing, from how this works between people:**

> *"If I'm on speaker phone and someone comes to my office, I say to the other party on the conversation 'stop' — and I mean pause until I say start again."*

He is describing what everyone already does. Nobody saying "stop, someone's here" means *throw away what you were telling me*.

**And it dissolves a real defect in the original design.** On mobile an answer has two outputs, screen and voice; stopping the audio leaves the information on screen. **On voice there is only one output**, so cancelling destroys the only copy — the answer was fully computed, and the caller never receives it. Their only recovery is to ask again and pay the full latency again.

**Pause fixes that.** The answer is held rather than destroyed. Pause is the voice equivalent of what the mobile screen does passively.

## A1.2 Revised User Intent (supersedes §2)

**When Robert says a stop word, Naavi goes silent immediately and holds the rest of her answer.** He can resume it, drop it, or simply let it lapse.

Silence is the urgent part — the scenario is someone walking into the room. Everything else can wait.

## A1.3 Decisions taken with this amendment

**1. Pause is silent. She does not ask "cancel or pause?"**

Considered and rejected. The scenario is *someone just walked in and I want quiet* — answering with a question spends speech at the exact moment none was wanted.

**The question is also unnecessary, because pause strictly dominates cancel.** Pausing costs nothing: nothing is lost, nothing is sent, nothing happens. If the caller never resumes, it expires — the same end state as cancelling. And "cancel" can still be said afterwards, once the room is clear. There is no decision that needs making in the moment, so there is nothing to ask about.

**2. Resume repeats generously and says so.**

Resuming re-opens with a phrase like *"As I was saying…"*, which makes repetition natural rather than a defect. **This removes the need to know precisely where she stopped** — the problem that made the original conversation-history decision unimplementable (Phase 2 §6a). Erring backwards is free; skipping content is not.

**3. Three vocabularies, not one.**

| Intent | Words (indicative — Phase 2 finalises) |
|---|---|
| **Pause** | stop, naavi stop, pause, wait, hold on, enough, that's enough |
| **Resume** | continue, go ahead, carry on, keep going, resume, you were saying |
| **Cancel** | cancel, forget it, never mind, drop it |

## A1.4 Revised Success Criteria (supersedes §4)

1. A stop word produces **silence within roughly a second**, reproducibly, on a live staging call.
2. A resume word makes her **continue the same answer**, opening with an "as I was saying" style phrase, without skipping content.
3. A cancel word **drops it**, and she does not resume it later.
4. Saying **nothing** leaves her silent; the held answer expires without surprising the caller later.
5. **Regression bar:** a caller who never interrupts hears one complete, uninterrupted answer.
6. **Privacy bar:** from the stop word onward she says **nothing at all** until spoken to — no confirmation, no question.

## A1.5 Added to scope

- Holding the remainder of an interrupted answer as call state.
- Resume, cancel and expiry paths, and the three vocabularies.
- The "as I was saying" re-entry.
- Deciding what happens if the caller says something **unrelated** while paused — see A1.7.

## A1.6 Still out of scope — unchanged

[[B11g]] (no barge-in during PIN prompts), voice latency, [[B4b]], and every mobile file. Mobile keeps its Stop button as it is; this amendment does not propose pause/resume there.

## A1.7 New open questions for Phase 2

1. **How long does a paused answer live?** It must not surface minutes later, out of context. A timeout, or expiry at the next unrelated question, or both.
2. **What happens if the caller says something unrelated while paused?** Almost certainly: treat it as a new question and discard the held answer — but it must be decided, not left to fall out of the code.
3. **Does a paused answer survive into conversation history?** Phase 3's Mandatory Change 1 settled this for *cancellation* (record in full, marked interrupted). Pause is a different state — the answer may yet be delivered, so recording it as finished would be untrue while it is still pending.
4. **Sentence-level resume, or restart-from-the-beginning?** A1.3 decision 2 makes generous repetition acceptable, which makes both viable. Phase 2 chooses on cost, not on correctness.

## A1.8 What survives the amendment

- **Phase 1's root cause is unchanged.** `streamTTSToTwilio` cannot be cancelled (`:5763-5779`); `clear` cannot stop a running producer. **Pause requires exactly the same cancellation primitive as stop** — pause *is* cancellation plus retained state. No investigation is wasted.
- **Phase 1A is unchanged.** Two senders, only `streamTTSToTwilio` affected, mobile's generation-counter pattern is still the model.
- **Phase 2 and Phase 3 must be revisited** for the added scope. Phase 3's state-sequencing design (generation-tagged marks, one `endSpeech()` funnel, exactly-once deferred release) applies unchanged and becomes more important, since pause introduces another state that must not leak across utterances.

---

## 1. ⭐ Scope statement — read this first

**This work item targets the VOICE platform only. Mobile is not touched.**

Mobile already has this control and it works: a permanent Stop button in the action row (`app/index.tsx:3898`, wired to `onOrangeButtonPressed` → `stopSpeaking()`). Nothing about the mobile implementation changes, and no mobile file is in scope.

**Testing is on staging only** — voice line `+1 343 504 1572`. T2 built that environment so voice defects can be exercised without production callers.

## 2. User Intent

> ⚠️ **Superseded by Amendment 1 §A1.2.** Retained for the record.


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

> ⚠️ **Superseded by Amendment 1 §A1.4.** Retained for the record.


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

> ⚠️ **Amended by Amendment 1** — criteria 1-7 still apply, plus §A1.4.


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
