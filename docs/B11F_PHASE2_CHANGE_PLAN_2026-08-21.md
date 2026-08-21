# B11f — Phase 2: Change Plan

**Work item:** [[B11f]] — pause and resume on a voice call
**Date:** 2026-08-21
**Phase 1A:** APPROVED (2026-08-21). Architecture Reference version in force: **`2026.07.18.7`**
**Risk classification: MEDIUM** — see §4. Medium triggers a mandatory Phase 3 technical review
before any code is written.

**No code yet.**

---

## 1. Files that will change

| File | Classification | Change |
|---|---|---|
| `naavi-voice-server/src/voice/resumePoint.js` | **Shared Logic** (new) | New module. Two pure functions moved out of the connection handler, unchanged in behaviour. |
| `naavi-voice-server/src/index.js` | **Shared Logic** (Protected Core) | Delete two closure definitions; add one `require`; update **two** call sites. |
| `naavi-voice-server/test/resumePoint.test.js` | **Test** (new) | Coverage for both functions. |

Nothing else. No UI, no configuration, no dependency, no database.

---

## 2. Explanation for every modification

### 2.1 `resumePointOf` — a pure move, no signature change

**Already pure.** It reads only `held.text` and `held.bytesSent`, both passed in. Extraction is
literally cut-and-paste; the body is not touched.

```js
// moves verbatim from index.js:10551 to src/voice/resumePoint.js
function resumePointOf(held) { … }
```

### 2.2 `bytesSpokenSoFar` — same arithmetic, closure state becomes arguments

Currently reads four closure variables: `usingPreGenAudio`, `lastTtsBytes`, `audioDispatchedAt`,
`preGenTotalBytes`. They become a single state argument, plus an injectable clock so the elapsed-time
branch is testable without waiting in real time:

```js
function bytesSpokenSoFar(state, now = Date.now()) {
  if (!state.usingPreGenAudio) return state.lastTtsBytes;
  if (!state.audioDispatchedAt) return 0;
  const elapsedMs = now - state.audioDispatchedAt;
  return Math.max(0, Math.min(state.preGenTotalBytes, Math.floor(elapsedMs * 8)));
}
```

**The arithmetic is identical** — `Math.max(0, Math.min(cap, floor(elapsed * 8)))`, the same
comparisons in the same order. Only where the four values arrive from changes.

The `now` parameter is the one addition, and it is the difference between a test that asserts real
behaviour and one that sleeps. It defaults to `Date.now()`, so the production call site is
`bytesSpokenSoFar(state)` and behaves exactly as today.

### 2.3 `index.js` — two call sites

- `:10301` `const spoken = bytesSpokenSoFar();` → passes the state object.
- `:10274` `const from = resumePointOf(held);` → unchanged apart from the import.

### 2.4 `holdAnswer` and `endSpeech` — NOT extracted

Phase 0 left this conditional on what Phase 1 found. Phase 1 §5 alternative 5 recommends leaving
them, and this plan confirms it: both **mutate** per-call closure state rather than computing a
value, so extracting them means inventing a mutable state object shared with the handler — new
abstraction, which Rule 19 requires justifying, and more risk than the tests would buy. Their
behaviour becomes observable through the two functions that *are* extracted, since those compute
the values `holdAnswer` stores.

---

## 3. Change Impact Matrix

Every row stated explicitly. An omitted row is not "not affected."

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **NO** | Different repo. Mobile's equivalent (`hooks/useOrchestrator.ts:5068`) is a terminate with no resume, and is out of scope per Phase 0 and Phase 1A §5. Not touched. |
| **Voice** | **YES** | The entire change. `src/index.js` (Protected Core) plus one new module and one new test file, on branch `staging` only. |
| **Shared Core** | **NO** | No Edge Function is touched. Phase 1A §3.3 verified by grep that Shared Core contains no playback-control logic at all. |
| **Database** | **NO** | No migration, no schema change, no query, no new column. |
| **Cron** | **NO** | No scheduled job is added, removed, or modified. |
| **API contracts** | **NO** | No HTTP endpoint, request shape, or response shape changes. The extracted functions are internal to one process and cross no network boundary. |
| **Tests** | **YES** | One new file, `test/resumePoint.test.js`. The existing 17 vocabulary tests in `test/pauseCommand.test.js` are **not modified**. |

**Duplicated capability — will both implementations change?**
**Only one — voice.** Justification: mobile's `stopSpeaking()` implements the *stop* half only, has
no resume, and lives in a different repo behind a visible on-screen control. This change alters **no
behaviour on any surface**, so there is nothing for mobile to match. Full reasoning in Phase 1A §5.

---

## 4. Mandatory Architecture Impact Checklist

Each answered explicitly, citing the Architecture Reference `2026.07.18.7`.

| Question | Answer |
|---|---|
| Does this modify **Shared Core**? | **NO.** Reference §2 places Shared Core in `supabase/functions/*`. Nothing there is touched. |
| Does this modify an **Entry Point**? | **YES** — the voice server, which Reference §3 defines as an entry point owning "playing audio back, handling barge-in/interruption". This change stays inside that owner and moves nothing across the boundary. |
| Does this introduce **new duplication**? | **NO.** The logic exists once before and once after; it changes address, not multiplicity. |
| Does this **eliminate existing duplication**? | **NO.** It was not duplicated. This is an extraction for testability, not de-duplication. |
| Does this modify **Protected Core**? | **YES.** Reference §4: *Voice orchestration — `naavi-voice-server/src/index.js` (entire file)*, review level **Full**. This is why the risk below is Medium rather than Low, and why Phase 3 is mandatory. |

---

## 5. Risk classification: **MEDIUM**

**Not Low**, despite being mechanical, because:

- It edits Protected Core, whose stated rationale is "heard live by a real caller with no undo."
- It edits **the exact code path that broke normal conversation in July**, in the same file, on the
  same feature. That history is the argument for care, not evidence this change is dangerous.

**Not High**, because:

- Each extracted function has **exactly one call site** (§7), verified by search.
- `resumePointOf` moves verbatim.
- `bytesSpokenSoFar` keeps identical arithmetic with a defaulted parameter, so the production call
  is unchanged in behaviour.
- The failure mode that caused the original revert — calling a function nobody wrote — is now
  caught mechanically by the `no-undef` pre-push gate added the same day.

---

## 6. Regression Impact

Every item answered. Silence is not acceptable in either direction.

| Function | Affected? | Why |
|---|---|---|
| **Voice commands** | **NO behaviour change; YES code proximity.** The file is the voice command path, so a mistake would land here. Nothing about command recognition, routing, or vocabulary is touched — `pauseCommand.js` is not modified. |
| **Geofencing** | **NO.** Lives in the mobile app and `report-location-event`/`fire-pending-dwells`. Untouched. |
| **Gmail integration** | **NO.** `sync-gmail` and the Gmail read paths are Shared Core. Untouched. |
| **Calendar integration** | **NO.** Calendar reads happen in Shared Core and in a separate part of the voice server. No shared state with playback position. |
| **Reminders** | **NO.** `check-reminders` and the `reminders` write paths are Shared Core. Untouched. |
| **SMS / call alerts** | **NO.** `evaluate-rules` and the send-* functions are Shared Core. Untouched. |
| **Onboarding** | **NO.** Mobile-side. Untouched. |
| **Staging build** | **YES, in the sense that this deploys to staging.** No build configuration changes; Railway builds from `staging` as it does today. Production is not touched — promotion is a separate post-Phase-8 decision. |

---

## 7. Regression Matrix — consumer trace

Produced by searching `git show staging:src/index.js`, not from memory.

| Function | Call sites found | Consumers | Changing? |
|---|---|---|---|
| `bytesSpokenSoFar` | **1** — `:10301` | The pause handler, capturing how much was heard before holding | Yes — gains a state argument |
| `resumePointOf` | **1** — `:10274` | The resume handler, computing where to restart | No — import only |
| `holdAnswer` | 4 — `:10304`, `:10376`, `:10586`, `:13259` | Pause handler (×2), reply-born-held (Race A), fast-path hold | **Not extracted; not modified** |
| `endSpeech` | 2 — `:10512`, `:13903` | Speech teardown, and `response_end` | **Not extracted; not modified** |

**The two functions being changed have exactly one consumer each, both inside the same file.**
Neither crosses a module, repo, or network boundary, so there is no consumer that could be missed
by this trace. `holdAnswer` and `endSpeech` are listed because they are adjacent in the same
mechanism and a reviewer would reasonably ask — **they are not being touched.**

---

## 8. What this plan deliberately does not do

- **No behaviour change of any kind.** Any observable difference is a defect, per Phase 0.
- No change to the pause vocabulary, the 5-minute hold TTL, the one-sentence rewind, or the "as I
  was saying" wording.
- No promotion to production.
- No change to `sendAudioToTwilio`'s 43 call sites.
- No attempt to resolve the interruption trade-off documented in Phase 1 §1.3 — that belongs to the
  production-promotion decision, as the reviewer confirmed at Phase 1.

---

## 9. Required output

Risk is **Medium**, so per governance Phase 3 is mandatory: this plan goes to external technical
review before any code is written. Phase 3 does not begin until Wael's own explicit go-ahead.
