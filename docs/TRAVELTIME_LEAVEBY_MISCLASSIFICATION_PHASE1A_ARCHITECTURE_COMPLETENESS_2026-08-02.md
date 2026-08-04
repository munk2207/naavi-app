# Travel-Time / Leave-By Misclassification — Phase 1A — Architecture Completeness Review

**Date:** 2026-08-02
**Governance version:** v4.0
**Architecture Reference version used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` (2026-07-18 — no newer version exists as of this review)
**Phase 1:** Approved 2026-08-02 — `docs/TRAVELTIME_LEAVEBY_MISCLASSIFICATION_PHASE1_PROBLEM_DEFINITION_2026-08-02.md`

## Wael's two Phase 1A requirements

1. **The voice conclusion from Phase 1 is treated as code-level verification only.** It is not upgraded to "confirmed working" until a live voice call test is run (Phase 7). Restated explicitly below.
2. **Checked for any other entry point, shared classifier prompt, duplicated deployment copy, or test fixture carrying the same instruction/gap**, before the Phase 2 change boundary is defined. Findings below.

## Required Questions

**What is the architectural owner of the affected capability?**
Calendar — reads (live event fetch). Owned jointly by `naavi-chat` (mobile-facing) and `naavi-voice-server` (voice-facing) as two independent implementations.

**Is the capability Shared Core, Duplicated, or Platform-specific?**
**Duplicated.** Architecture Reference `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md:68` — *"Calendar — reads (live event fetch) | Duplicated | Both `naavi-chat` and the voice server independently call the Google Calendar API themselves"* — `docs/adr/0002-calendar-reads-remain-duplicated.md`.

**If duplicated, were all documented implementations investigated?**
Yes — both.

**Which implementations were investigated, and which were not?**

| Implementation | Result | Provenance |
|---|---|---|
| Mobile (`naavi-chat/index.ts`) | **Confirmed broken.** `classifyIntent` (line 1627, prompt at 1664) has no exclusion for leave-by/travel-time phrasing → misclassifies as `READ_CALENDAR` → short-circuits at line 2816-2822, never reaches Claude/RULE 7. | Freshly verified this session — evidence: `naavi-chat/index.ts:1627,1664,2816-2822`; live screenshots, staging + production, 2026-08-02. |
| Voice (`naavi-voice-server/src/index.js`) | **Not broken by this mechanism.** Voice's own Level A classifier (`voiceClassifyAndHandleIntent`, line 2255-2352) has a separate, independently-authored intent list (line 2273: `LIST_RULES, LOOKUP_CONTACT, CALENDAR_SEARCH, LIST_READ, REMINDER_READ, MEMORY_SEARCH`) — **`READ_CALENDAR` is not in it.** Its switch statement (2300-2348) `default: return null`s for anything else, so it always falls through to full Claude, which shares `get-naavi-prompt`'s RULE 7. | Freshly verified this session — evidence: `naavi-voice-server/src/index.js:2255-2352`. **Code-level only, per Wael's Requirement 1 — not confirmed by a live voice call. Must not be treated as "working" until Phase 7 runs that test.** |

**Does the documented problem scope match the Architecture Reference?**
Yes — the Reference's own duplication note (line 68, ADR-0002 §Consequences) states plainly: *"A future fix to one side's calendar-read logic... will not automatically reach the other side — the same Cross-Repository Verification discipline... applies here too."* This is exactly what's being followed here: the mobile-side bug does not imply anything about voice, and the investigation above treats them as fully independent.

**Is any documented implementation excluded from the investigation?**
No. Both documented implementations (mobile, voice) were investigated. No third documented implementation exists for this capability in the Architecture Reference.

## Requirement 2 — Other entry points, shared prompts, duplicated deployments, test fixtures

| Candidate | Finding | Provenance |
|---|---|---|
| `supabase/functions/naavi-chat/intentHandlers.ts` | Defines `HANDLED_INTENTS` (includes `'READ_CALENDAR'`, line 24-35) — this is the single source the Layer 2 router checks, not a second/duplicate classifier. Confirms wiring, does not add a second bug source. | Freshly verified this session — evidence: `intentHandlers.ts:1-35`. |
| `naavi-voice-server/src/index.js` — separate `calendarListRe` regex (line 2861, a latency-optimization "route to Haiku instead of Sonnet" gate, unrelated to the Level A short-circuit) | Does not match any of the reproduction phrasings, nor the user-supplied equivalent phrasings ("How early do I need to go", "When should I head out"). Even if it matched, it changes which Claude model answers — it does not skip Claude or bypass RULE 7 the way the mobile bug does. | Freshly verified this session — evidence: direct regex test against `"What time should I leave for my dentist appointment"`, `"What time i should leave for my next meeting"`, `"Navigate to my next meeting"`, `"How early do I need to go"`, `"When should I head out"`, `"What time should I leave for my next appointment"` — all `false`. |
| `lib/naavi-client.ts` (mobile's local fallback system prompt, used only when the shared `get-naavi-prompt` fetch fails) | Already contains its own correct `FETCH_TRAVEL_TIME` rule with a matching worked example ("what time should I leave for my 2pm meeting at 100 Queen Street" → emits `FETCH_TRAVEL_TIME`, lines 403, 454-457). Not a gap — and structurally cannot be, since `classifyIntent`'s Level A gate runs in `naavi-chat/index.ts` *before* either the shared prompt or this fallback is ever selected. A fix to the classifier gate covers both. | Freshly verified this session — evidence: `lib/naavi-client.ts:340,403,416,450,454-457`. |
| `supabase/functions/get-naavi-prompt/index.ts` | Contains the correct, working "next"-phrasing handling (RULE 7, line 687-714, and a separate "next [X]" clause at line 720) — this is the destination system the fix routes requests *to*, not a duplicate of the broken classifier. | Freshly verified this session — evidence: `get-naavi-prompt/index.ts:687-720`. |
| `tests/catalogue/calendar.ts` | Existing test fixture, `ARCH-1 READ_CALENDAR regression` (2026-06-13). Two tests lock in that `"what do I have today"` and `"what's coming up"` **must** return the deterministic `READ_CALENDAR` response and must **not** get Claude hedging (lines 46-99). No existing test covers leave-by/travel-time phrasing — no conflicting fixture. These two tests define a hard constraint on the Phase 2 fix: the exclusion must not cause these two phrasings to stop matching `READ_CALENDAR`, or `npm run test:auto` breaks. | Freshly verified this session — evidence: `tests/catalogue/calendar.ts:46-99`. |
| Deploy sync (`naavi-chat` staging vs. production) | Identical SHA (`a2cfb490b2d797aa`), deployed 16 minutes apart on 2026-07-22 — confirmed **not** deploy-drifted the way `resolve-place` was. Both environments are running the same broken classifier prompt, which is why the bug reproduces identically on both. | Freshly verified this session — evidence: `npx supabase functions list` output, both project refs, compared. |
| Duplicated deployment copy of `classifyIntent` elsewhere in the codebase | None found. `classifyIntent` exists in exactly one file. | Freshly verified this session — evidence: `grep -rl "classifyIntent" supabase/functions/` → `naavi-chat/index.ts` only. |
| Other entry points (web/WebView management surfaces) | Not separately re-checked this session — per CLAUDE.md's "Mobile = Conversation, Web = Management" architecture, web surfaces are read-only management views (alerts, lists, notes), not conversational chat entry points, so they have no classifier of their own to carry this bug. | Relying on Architecture Reference / CLAUDE.md's documented architecture, not re-checked this session. |

## Carried forward to Phase 2 — fix framing (Wael's directive)

The Phase 2 change must be expressed as: **leave-by, departure-time, commute-time, navigation-time, and travel-time questions must not be classified as `READ_CALENDAR`** — expressed as an intent/meaning exclusion, not a fixed keyword list. It must not rely only on the literal words "leave" or "travel time," since equivalent phrasings ("How early do I need to go?", "When should I head out?") must also be covered. Phase 2 will define the exact instruction wording and test it against both the literal reproduction phrases and these paraphrase-equivalent forms.

---

**Status:** Awaiting Wael's explicit approval to proceed to Phase 2.
