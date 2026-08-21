# B11f — Phase 1A: Architecture Completeness Review

**Work item:** [[B11f]] — pause and resume on a voice call
**Date:** 2026-08-21
**Phase 1:** APPROVED (2026-08-21)
**Phase 2 start:** authorised by Wael, then held so this mandatory review runs first — Phase 1A
precedes Phase 2 for every change affecting the Protected Core.

**Architecture Reference version used for this review: `2026.07.18.7`**, dated 2026-07-18, revision
7 of 2026-08-20. **Note: revision 7 landed a few hours before this review** (§0d, added by the S1
promotion). Per the Architecture Reference Version Verification rule, this version must be
re-confirmed before Phase 8 merge, and any newer revision evaluated for whether it changes an
assumption relied on here.

---

## 1. What is the architectural owner of the affected capability?

**The Voice Server — `munk2207/naavi-voice-server`**, per the Ownership Model (§0a).

Reference §3, *Voice server should own*: "Playing audio back, handling **barge-in/interruption**."
This work item is exactly that capability, in its documented owner.

*Relying on Architecture Reference classification, not re-checked this session* — for the ownership
statement itself. Every claim about **implementations** below is freshly verified.

---

## 2. Is the capability Shared Core, Duplicated, or Platform-specific?

**It splits, and Phase 1 got this partly wrong.** Phase 1 §6 states "Voice-only, and correctly so."
That is right for the half B11f adds and wrong for the half it changes:

| Capability | Classification | Where |
|---|---|---|
| **Stop Naavi mid-answer** | **DUPLICATED** — mobile and voice both implement it, independently | mobile + voice |
| **Pause, hold, and resume from a point** | **Platform-specific — voice only** | voice only |

**This correction is the reason Phase 1A exists as a separate gate**, and it is the same shape as
the B10r incident that produced the Verification Provenance Rule: a confident classification in a
prior phase, not re-checked, that turns out to have missed a real implementation on another surface.

---

## 3. If duplicated, were ALL documented implementations investigated?

**Yes. Three surfaces, all checked this session.**

### 3.1 Mobile — an equivalent exists

**Freshly verified this session — evidence: `hooks/useOrchestrator.ts:5068`,
`app/index.tsx:2774-2783`.**

`export function stopSpeaking(): void` invalidates the in-flight speech generation
(`_speechGen++`), captures and stops the current sound, and releases pending playback cleanup. It
is surfaced as the Stop control in the action row (`app/index.tsx:2774`), described in the file's
own accessibility text as *"Stop in thinking / speaking → cancels in-flight or silences voice."*

**It is a terminate, not a pause.** There is no held answer, no resume point, and no resume
vocabulary — the utterance is discarded. Mobile's design is closer to production voice's barge-in
than to B11f.

### 3.2 Voice — two designs, one per branch

**Freshly verified this session — evidence: `naavi-voice-server/src/index.js:9946` on `main`,
`:10071` on `staging`.** Both read in full in Phase 1 §1.1–1.2. `main` clears playback on **any**
transcript; `staging` clears only on a recognised pause word and holds the remainder.

### 3.3 Shared Core — no implementation exists

**Freshly verified this session — evidence: a recursive grep across `supabase/functions/` for
`resumePoint|holdAnswer|bytesSpoken|pause.*speech|stopSpeaking|barge` returned no files.**

The only Edge Functions touching speech at all are `text-to-speech` (stateless synthesis — grepped
for `resumePoint|holdAnswer|bytesSpoken|isSpeaking|pause`, **0 matches**; its own header describes
it as converting text to base64 audio) and `get-naavi-prompt` (prompt text). **Neither holds
playback state, so neither can pause or resume anything.** Playback control is necessarily
client-side, on whichever surface is producing sound.

---

## 4. Which implementations were investigated, and which were not?

| Surface | Investigated | Requires a matching change? |
|---|---|---|
| Voice (`staging`) | Yes — the subject of this work | Yes — the extraction and tests |
| Voice (`main`) | Yes | **No.** Out of scope: production promotion is a separate post-Phase-8 decision (Phase 0, Out of Scope) |
| Mobile | Yes | **No** — justified in §5 |
| Shared Core | Yes | **No** — no implementation exists to change |

**Nothing is excluded without justification. Silence is not used in either direction.**

---

## 5. Does mobile require a matching change? No — with reasons, not assertion

1. **Phase 0 constrains this explicitly:** "Voice only. No mobile, no UI." Extending to mobile would
   be a new capability, not hardening.
2. **This work item changes no behaviour at all.** It extracts two pure functions and tests them.
   There is no behavioural change for mobile to match.
3. **The designs are deliberately different, and defensibly so.** Mobile has a screen and a visible
   Stop control the user can see and press; voice has neither, which is the whole reason B11f
   exists. A user who stops mobile mid-answer can re-read the text on screen — the answer is still
   there. A phone caller cannot, which is why voice needs a resume point and mobile does not.

**Whether mobile should eventually gain resume is a product question, and it is not raised here** —
it would need its own Phase 0. Recorded so a future reader can see it was considered and set aside,
rather than never noticed.

---

## 6. Does the documented problem scope match the Architecture Reference?

**Not entirely — one Reference gap, already flagged in Phase 1 §6 and confirmed here.**

Reference §3 lists "Playing audio back, handling **barge-in/interruption**" as a single capability.
On `staging` that is no longer one thing: ordinary speech no longer interrupts, and only a closed
vocabulary does. **The Reference does not record that**, and it does not record that the two voice
branches now behave differently.

**Assessment: this does NOT block Phase 2.** The Reference is accurate for production, which is the
only environment it has ever claimed to describe, and this work item changes no behaviour on either
branch. **It becomes wrong the moment B11f is promoted**, so updating §3 is a Phase 8 obligation and
is recorded as such. Per §Phase 1A's own warning — "an out-of-date Architecture Reference is worse
than none, because it creates false confidence that a check happened when it didn't" — it is named
here rather than left to be noticed later.

---

## 7. Is any documented implementation excluded from the investigation?

**No.** All three surfaces named by the Reference were checked, each by fresh grep or read this
session, and each is either in scope or explicitly declared out of scope with justification in §4
and §5.

---

## 8. Summary for the reviewer

- **Owner:** Voice Server, per Reference §0a and §3. Unchanged.
- **Classification corrected:** "stop mid-answer" is **duplicated** (mobile `stopSpeaking` +
  voice); "pause and resume" is **voice-only**. Phase 1 §6 said voice-only for both.
- **Mobile equivalent found and freshly verified**, and explicitly out of scope, with reasons.
- **Shared Core has no implementation** — verified by grep, not assumed.
- **One Reference gap** (§3's single "barge-in/interruption" entry) recorded as a Phase 8
  obligation, not a Phase 2 blocker.
- **Reference version `2026.07.18.7`** recorded, to be re-confirmed before Phase 8.

**Required output:** approve, approve with changes, or reject. Phase 2 does not begin — including
drafting it — until Wael's own explicit go-ahead for the 1A→2 transition.
