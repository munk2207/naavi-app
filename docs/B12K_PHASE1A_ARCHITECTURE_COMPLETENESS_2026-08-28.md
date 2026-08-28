# B12k — Phase 1A: Architecture Completeness Review

**Work item:** [[B12k]] — Naavi is too slow to answer on voice.
**Date:** 2026-08-28
**Prior phases:** Phase 0 approved (after one rewrite, one return). Phase 1 approved (after four returns), with two measurements explicitly deferred by Wael.
**Status:** **REWRITTEN 2026-08-28 — awaiting Wael's review.** No code written. No mechanism proposed.

---

## 0. What was wrong with the first version of this document

**Wael challenged how I had used a past work item, [[B9x]], as supporting evidence in conversation.** The examination that followed found the same habit inside this document, so it is rewritten rather than patched.

**The habit:** taking a fact that exists and presenting the half of it that supports the point I was already making.

Three instances, all mine, all corrected below:

1. **§5 was written as a stop-work blocker. It is not one.** I argued that an omission in the Architecture Reference triggered the governance rule requiring implementation to halt. **The omission did not mislead this investigation** — I found `search-knowledge` by searching the code directly, and nothing in Phase 1 depended on the Reference having a row for it. I presented it at the strength that made the case for fixing it, not at the strength the facts supported. It is now stated at its real size.
2. **§3.3 opened with "This is the most important finding of this review."** It is not obviously that. §3.3 concerns the rare catastrophic stall; §3.4 concerns the model choice that dominates the *everyday* slowness Wael's prospects actually complained about. **I ranked first the finding with the better story.** The ranking is removed; both are stated and the reader can weigh them.
3. **Two internal contradictions.** The Shared Core and Voice rows in §3.3 said "None" for timeout convention and then, in the same cell, gave a non-zero count. And the closing line said "No Reference edit made" at a point when the edits had been approved and made.

**A fourth correction, later the same day.** Those Architecture Reference edits were **reverted on Wael's instruction**, so every statement in this document describing them as in place had to be corrected again — §1, Q5, §3.1, §5 and §6. **The Reference stands at `2026.07.18.15` and this work item has changed nothing in it.**

**Everything verified with `file:line` evidence in the first version was re-checked and is unchanged.** The corrections here are to framing and to two contradictions, not to the underlying facts.

---

## 1. Architecture Reference Version Verification

**Version this review was performed against: `2026.07.18.15`** (revision 15, 2026-08-27).

**Version currently in the repository: `2026.07.18.15`. This work item has made no change to the Architecture Reference.**

**Freshly verified this session** — the version line read directly from the file after the revert described in §5, not carried forward.

**History, recorded because it happened and the document should not read as though it did not:** on 2026-08-28 two entries were drafted, put to Wael in plain language, approved by him, and written in as revision `2026.07.18.16`. **He then instructed that they be reverted, and they were.** Nothing was committed at any point, so the Reference was never in that state outside this machine. The two omissions §5 describes therefore stand.

---

## 2. The six mandatory questions

**Q1 — What is the architectural owner of the affected capability?**

B12k has no single affected capability. It is a latency defect spanning a pipeline, not a fault in one feature. Owners, per Reference §0a:

| Element on the critical path | Owner |
|---|---|
| Voice turn pipeline, timing markers, greeting path, TTS route | **Voice** — `munk2207/naavi-voice-server` |
| `search-knowledge` | **Shared Core** |
| `manage-rules` | **Shared Core** |
| `get-naavi-prompt` | **Shared Core** |
| Live Google Calendar read | **Duplicated** — neither surface owns it |
| Claude model selection for the main conversation turn | **Duplicated** — see §3.4 |

**Q2 — Is the capability Shared Core, Duplicated, or Platform-specific?**

All three categories appear on this one path, and they carry different rules. Any later change aimed at voice latency will need to say which category each file it touches falls into.

**Q3 — If duplicated, were all documented implementations investigated?**

**No.** Phase 1 investigated the **voice** implementation only. Mobile was placed out of scope by Phase 0, and Wael approved that scope.

**Q4 — Which implementations were investigated and which were not?**

| Implementation | Investigated in Phase 1? |
|---|---|
| Voice turn pipeline | **Yes** — 30 turns, 14 calls, stage-level timings |
| Mobile / `naavi-chat` equivalent path | **No** — out of scope per Phase 0 |
| Mobile client (`hooks/`, `lib/`) | **No** — out of scope per Phase 0 |

**Declared, not silent**, which is what the Architecture Scope Rule requires. No change is proposed for either side at this phase, so the live question is narrower: does mobile's implementation hold anything the voice work should not ignore? **Yes — §3.3 and §3.4.**

**Q5 — Does the documented problem scope match the Architecture Reference?**

**No, in two places — a missing capability row and a missing duplication entry. Both still stand** (§5). **Neither affected Phase 1's findings**, and neither blocked this work.

**Q6 — Is any documented implementation excluded from the investigation?**

**Yes — mobile, deliberately, by approved Phase 0 scope.** B12k's defect is a voice-call complaint, its evidence is voice-call measurement, and the bar is a voice bar. Mobile carries its own latency complaint in `project_naavi_latency_issues` (~15 s on chat) which has never had a tracked item. Phase 0 states that if a shared cause emerges it is raised on its own under Rule 1b, not absorbed into B12k.

---

## 3. Cross-Repository Verification Rule — element by element

*Every bullet tagged per Governance §3's Verification Provenance Rule.*

### 3.1 `search-knowledge`

**Freshly verified this session — evidence:** `naavi-voice-server/src/index.js:1200` (voice), `supabase/functions/naavi-chat/intentHandlers.ts:719` (Shared Core), `lib/knowledge.ts:58` (mobile client), and `supabase/functions/global-search/adapters/knowledge.ts:5`, whose header states it *"Mirrors the existing `search-knowledge` Edge Function"*.

**Genuinely shared as an implementation** — one function, three callers — **and also mirrored** by the `global-search` knowledge adapter, an intra-Shared-Core duplication of the same operation. **Neither fact is recorded in the Architecture Reference** (§5).

### 3.2 Live Google Calendar read — Duplicated

**Freshly verified this session — evidence:** identical endpoints in both codebases — `naavi-voice-server/src/index.js:915` and `:927` against `supabase/functions/naavi-chat/index.ts:1136` and `:1150`, both hitting `calendarList` then `calendars/{id}/events`.

Matches Reference §2 and ADR 0002. **Consequence: anything done to voice's calendar read does not reach mobile.** `fetchLiveCalendarEvents` is one of the two lookups measured at 98 s in the catastrophic turn.

### 3.3 Bounded outbound calls — mobile bounds them, voice and Shared Core do not

**Freshly verified this session — evidence:**

| Surface | Convention | Evidence |
|---|---|---|
| **Mobile client** | Central wrapper `invokeWithTimeout`, used across `lib/` | `lib/invokeWithTimeout.ts`; call sites `lib/knowledge.ts:58`, `lib/contacts.ts:71`/`:113` (15 s), `lib/calendar.ts:523`/`:538`, `lib/drive.ts:29`/`:53`/`:77` |
| **Mobile orchestrator** | Same wrapper, explicit 15 s | `hooks/useOrchestrator.ts:1134`, `:1150`, `:1197`, `:1256`, `:1863`, `:3131`, `:3189` — all `manage-rules`, all `15_000` |
| **Shared Core** | **No general convention.** 233 `await fetch(` calls; abort logic present in **2 files only** (`naavi-chat/intentHandlers.ts`, `search-google-drive`) | `intentHandlers.ts:719` calls `search-knowledge` with a raw `fetch` |
| **Voice** | **No general convention.** 132 `await fetch(` calls; **3** `AbortController` usages (`:67`, `:2780`, `:2802`), **none on the turn path** | `src/index.js:1200`, `:13051`, `:8903`; `supabase/functions/search-knowledge/index.ts:23` |

*(Corrected from the first version, which wrote "None" in the two right-hand rows and then gave a non-zero count in the same cell. Abort logic exists in both codebases; what does not exist is a convention, and none of it sits on the voice turn path.)*

**The cleanest single comparison:** mobile calls `manage-rules` with `op: 'list'` at `hooks/useOrchestrator.ts:1134`, bounded at 15 seconds. Voice calls the same function with the same operation at `src/index.js:13051`, unbounded.

**Mobile's wrapper describes the same failure mode B12k's Defect B exhibits.** Its header, `lib/invokeWithTimeout.ts:1-26`:

> *"When an Edge Function stalls (third-party API hang — Google People, Whisper, Anthropic, Vision — or a temporary network blip), the awaiting promise hangs INDEFINITELY. We hit this repeatedly in V57.3 testing: **2-3 minute hangs** on transcribe-memo, lookup-contact, naavi-chat, text-to-speech, etc. Each one independently."*

**This project encountered the unbounded-hang failure mode on mobile, implemented a mitigation that bounds it, and neither voice nor Shared Core adopted that mitigation.**

**Three limits on this finding, stated so it is not over-read:**

1. **It is not a proposed fix.** Phase 1A authorizes no mechanism. Whether voice should adopt anything of the kind is Phase 2's to argue and Wael's to approve.
2. **It would not address Defect A** — the 8.7-second median, which is the everyday complaint. A bound makes a hang finite; it makes nothing faster.
3. **It would not explain the stall.** Phase 1 §9d left the cause open, including the possibility that the timings are inflated by event-loop blocking rather than reporting real network delay. **If that is what is happening, a request timeout would never fire**, because there would be no slow request to abort.

### 3.4 Claude model selection — Duplicated, and the two surfaces chose differently

**Freshly verified this session — evidence:**

| Surface | Model for the main conversation turn | Evidence |
|---|---|---|
| **Voice** | **`claude-sonnet-4-6`** for anything not classified trivial / calendar-listing / simple-lookup / personal-lookup | `naavi-voice-server/src/index.js:3446` |
| **`naavi-chat`** (mobile backend) | **`claude-haiku-4-5-20251001`** | `supabase/functions/naavi-chat/index.ts:3683`, `:3848`, `:1896` |
| **Mobile local fallback** | **`claude-haiku-4-5-20251001`** | `lib/naavi-client.ts:695` |

**Measured consequence (Phase 1 §9a):** Sonnet ran on **20 of 24** instrumented voice turns, median inference **4 389 ms** — 88 % of the whole 5-second budget.

**Prompt caching is NOT an asymmetry.** Both surfaces use the same stable/dynamic `cache_control` structure — `src/index.js:627`, `:637` against `naavi-chat/index.ts:3718`, `:3726`. **Freshly verified this session.**

**Not proposed as a fix.** The surfaces have different constraints — a phone call has no screen and every answer is spoken — and nothing this review found records whether the model choice was deliberate. **Phase 2 owes an answer to "why Sonnet on voice", and it must be an answer, not an assumption.**

**Why this sits alongside §3.3 rather than below it:** §3.3 concerns the rare catastrophic stall; this concerns the everyday slowness that produced the complaints Wael actually heard. Neither is ranked above the other here.

### 3.5 `manage-rules`, `get-naavi-prompt`, `global-search`

**Relying on Architecture Reference classification, not re-checked this session** for their Shared Core status: §2 lists `get-naavi-prompt` and `global-search` as genuinely shared, and §4 places `manage-rules` in Protected Core's Action Rules area.

**Freshly verified this session** only for the caller asymmetry in §3.3 — a claim about *how* they are called, not about where they live.

### 3.6 The greeting and TTS path — Voice-only

**Freshly verified this session — evidence:** `src/index.js:7444` (TwiML `<Play>`), `:8867` (`/tts-play/:token` route), `:8903` (Deepgram call).

**Platform-specific by nature, not duplication.** Mobile has its own `text-to-speech` Edge Function for in-app playback; a Twilio `<Play>` round-trip has no mobile equivalent. **No mobile row required.** Phase 1 §9c measured this path at 147–713 ms across 50 samples and excluded it as the cause of the 19.5-second greeting.

---

## 4. Independent Review Rule

Governance §3 requires two independent reviews at this stage, and passing one does not imply passing the other.

- **Technical Investigation Review** — Wael reviewed Phase 1 across four returns and approved it on 2026-08-28, with two measurements explicitly deferred.
- **Architecture Completeness Review** — this document. **Not yet reviewed.**

---

## 5. Architecture Reference — two omissions, now corrected

**Both predate B12k. Neither was caused by this work, and — stated plainly, because the first version of this document did not — neither misled it.**

**Omission 1.** `search-knowledge` had no row in §2, despite being a Shared Core function with three callers across both surfaces. A reader consulting §2 for where knowledge search lives would have found `global-search` and nothing else.

**Omission 2.** The `global-search` knowledge adapter mirrors `search-knowledge`, and §5a — which titles itself a **Full** Duplication Inventory — did not list the pair.

**What the first version of this section got wrong.** It argued that these triggered the Architecture Drift Rule's Outcome 3 and therefore **required implementation to stop.** That was overstated in two ways:

- **The precedent is not the same shape.** Revisions 10, 12 and 13 were made at Phase 1A because the Reference contained a claim that was **false and that the work in front of it relied on** — in revision 12's case, a row that answered "yes" to the one question a reader would consult it for. Here the Reference was **silent**, and Phase 1 relied on nothing it said.
- **Nothing was blocked.** `search-knowledge` was found by searching the code. Had the row existed, this investigation would have proceeded identically.

**Its real size:** two omissions worth fixing so the next reader is not misled, in a document whose entire value is that sessions trust it instead of re-deriving. That is a good enough reason on its own, and it did not need to be dressed as a stop-work condition.

**Status: NOT corrected. Both omissions stand.**

**What happened, in order.** The exact entries were put to Wael in plain language on 2026-08-28. He read them and approved both. They were written in as revision `2026.07.18.16`. **He then instructed that they be reverted, and they were** — the Reference is back at `2026.07.18.15` with neither row present, and nothing was committed at any point.

**No reason for the reversal was given and none is inferred here.** Whether these entries are made, in this form or another, is Wael's to decide.

**One fact surfaced while drafting the entries, and it is the strongest argument for having made them.** The two copies have **already drifted**: `global-search/adapters/knowledge.ts:19-34` skips OpenAI entirely for identifier-shaped queries — phone numbers, emails, UUIDs — because embedding search is the wrong tool for them. `search-knowledge` has no such check and embeds them anyway. Both still use the same `0.5` weak-match cutoff. **A duplication inventory exists to make a pair like this visible before they diverge. This pair was never on it, and they diverged.**

**Process note:** the Reference was not edited until Wael had read the exact text going in. It states that only he approves a new Architecture Version, and Rule 1 governs the edit itself.

**A third candidate, raised without a recommendation.** §3.3 and §3.4 describe cross-surface divergences — bounded calls, and model selection — that the Reference records nowhere. Whether they belong in it is a heavier question than a missing row, because it would enlarge what the Reference claims to track. **This review raises it and takes no position.**

---

## 6. Conclusion

**Architecture Completeness: the investigation's scope is complete and correctly declared.** Mobile is excluded by approved Phase 0 scope, and the exclusion is stated rather than silent.

**Two findings a later phase should not have to rediscover**, neither visible from the voice codebase alone:

1. **Mobile implemented a mitigation for the unbounded-hang failure mode; voice and Shared Core did not adopt it** (§3.3) — with the three limits above, the sharpest being that it addresses neither the everyday slowness nor the cause of the stall.
2. **Voice runs Sonnet where mobile runs Haiku** (§3.4), and Sonnet's median inference is 88 % of the whole budget.

**No blocker is raised.** The two Reference omissions (§5) stand uncorrected and were not obstructing this work — that is the same answer either way, and it is the point §0 records me having got wrong the first time.

**No fix proposed. No mechanism named.** Per Governance §3, Phase 1A → 2 requires Wael's own separate word.
