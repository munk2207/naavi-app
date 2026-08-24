# B11z — Phase 1A: Architecture Completeness Review

**Work item:** [[B11z]] — competitor named twice, and a hedge appended to confident answers
**Date:** 2026-08-24
**Phase 1:** `docs/B11Z_PHASE1_PROBLEM_DEFINITION_2026-08-24.md` (commit `b070187`)
**Architecture Reference version reviewed against:** **2026.07.18.11** (revision 11, `f06cf1c` — created by [[B11x]] earlier today)

**Status:** ✅ **PASS — with two facts that must be added to Phase 1 before Phase 2 is drafted.**

Neither finding invalidates Phase 1's problem definition. Both change how a fix must be *planned and verified*, which is why they belong on the record now rather than being discovered during Phase 5.

---

## The six mandatory questions

### 1. Architectural owner of the affected capability

**Shared Core** — the Edge Functions codebase, `munk2207/naavi-app/supabase/functions/*`.
*Relying on Architecture Reference §0a classification, not re-checked this session.*

### 2. Shared Core, Duplicated, or Platform-specific?

**Two capabilities, two answers.**

**Defect A — the prompt rule.** *"Claude system prompt (non-classifier) — `get-naavi-prompt` (Shared Core). Genuinely shared — voice fetches this Edge Function live, same bytes mobile uses."*
*Freshly verified this session — evidence: `naavi-voice-server/src/index.js:1918` fetches `get-naavi-prompt`; `supabase/functions/naavi-chat/index.ts:1361` fetches the same function independently.* **The Reference's claim holds.**

**Defect B — the hedge wrapper.** **Mobile-backend only, not a documented capability at all.**
*Freshly verified this session — evidence: `naavi-chat/index.ts:4471` (the `_genuinelyUncertain` regex) and `:4473` (the wrapper). A grep for "best reading", "verify this from a live source" and `_genuinelyUncertain` across `naavi-voice-server/src/index.js` returns **nothing**.*

### 3. If duplicated, were all documented implementations investigated?

**The comparison rule is NOT duplicated.** It exists in exactly one place.
*Freshly verified this session — `grep -ci "chatgpt\|competitor"` returns **0** for both `lib/naavi-client.ts` and `naavi-voice-server/src/index.js`.*

### 4. ⭐ Which implementations were investigated, and which were not

**All prompt-assembly paths investigated. None excluded.**

| Path | `file:line` | Carries the comparison rule? |
|---|---|---|
| `get-naavi-prompt` (canonical) | `:262`, `:287`, `:313` | ✅ **yes — the only copy** |
| `naavi-chat` fetches it server-side | `naavi-chat:1361` | fetches, does not define |
| Voice server fetches it | `voice:1918` | fetches, does not define |
| **Mobile local fallback** — `buildSystemPrompt` | `lib/naavi-client.ts:289` | ❌ **no** |
| **Voice local fallback** — `buildVoiceSystemPrompt` | `voice:1935` | ❌ **no** |

*All five freshly verified this session.*

**⭐ FINDING 1 — the two local fallbacks do not contain the comparison rule at all.**

CLAUDE.md states the local fallbacks *"MUST stay roughly in sync with the Edge Function."* For this rule they are not in sync — they are **absent**.

**Two consequences, pulling opposite ways:**

- **Good for scope:** a fix to `get-naavi-prompt` needs no matching fallback edit. There is no second copy to drift.
- **Latent gap, unrelated to this item:** if `get-naavi-prompt` ever fails, both surfaces fall back to prompts with **no competitor guidance whatsoever** — no exactly-once rule, no structure, no ban on capability-negation claims. The very behaviour Wael spent four live rounds eliminating on 2026-08-14 would return, and nothing would report it.

**Out of scope for B11z, and explicitly not proposed here.** Recorded because Phase 1A is where an unexamined implementation must be named rather than left silent.

### 5. ⭐ Does the documented problem scope match the Architecture Reference?

**Yes** — with one operational fact Phase 1 does not mention.

**⭐ FINDING 2 — the shared prompt is cached for five minutes inside `naavi-chat`.**

*Freshly verified this session — evidence: `naavi-chat:1341` `const PROMPT_CACHE_TTL_MS = 5 * 60 * 1000;`, a module-level `Map` at `:1342`, checked at `:1355`.*

**A prompt change is not live the moment it deploys.** Each warm Edge Function instance keeps serving the previous prompt for up to five minutes, keyed by `channel:timezone`.

**Why this matters more here than usual:** B11z's fix is a *prompt* change validated by the Non-Determinism Rule's **three independent trials**. Trials run inside the cache window would measure the **old** prompt and report a false result — a false failure if run too early, or worse, a false pass if the cache happens to hold a response shaped like the target.

**Phase 2 must state a cache-expiry step before trial collection**, and Phase 5's evidence must show trials were taken after it. This is the same class of error as the 2026-07-20 incident behind the Cross-Cutting Change Parity Check: measuring the wrong thing and believing the number.

### 6. Is any documented implementation excluded from the investigation?

**No implementation is excluded.**

**Voice — in scope for Defect A, explicitly out of scope for Defect B, with justification:**

- **Defect A reaches voice.** *Freshly verified — `voice:1918` fetches the same Edge Function.* A `get-naavi-prompt` fix therefore ships to voice **with no voice deploy and no client build**, the instant it is deployed and the caches expire.
- **⭐ This includes the public 1-888-91-NAAVI demo line**, which runs on the voice production server itself. *Relying on Architecture Reference §0b, not re-checked this session.* **A prompt fix is simultaneously a demo-line release.**
- **Defect B does not reach voice.** *Freshly verified — the wrapper does not exist in the voice file.* **No matching change required in voice**, and a `naavi-chat` fix has zero voice blast radius.

**Mobile client: out of scope, with justification.** No mobile file changes for either defect. `naavi-chat` assembles the prompt server-side (`:1361`), so the fix ships as an Edge Function deploy. **No APK, no AAB** — which matters, because Rule 15's three gates are currently red on this very item.

---

## Required additions to Phase 1

Neither changes the problem definition. Both must be recorded before Phase 2 plans against them.

1. **The 5-minute prompt cache** (`naavi-chat:1341`) — load-bearing for how any prompt fix is verified.
2. **The two local fallbacks lack the comparison rule entirely** — no duplication to maintain, but a latent gap if `get-naavi-prompt` ever fails.

---

## What this document authorizes

**On Wael's approval:** the Phase 1A → Phase 2 transition, once the two additions above are made to Phase 1.

**Does not authorize:** any code change, any prompt edit, any mechanism selection, or any deploy.

---

## Provenance summary

Per the Verification Provenance Rule, every claim is tagged. **Two rest on the Architecture Reference without re-checking** — §0a ownership, and §0b's demo-line topology. **Every claim about what the code does was freshly verified this session by direct read**, including the two negative results that matter most: the voice file does not contain the hedge wrapper, and neither fallback contains the comparison rule.

Both findings came from checking things the Reference does not describe — the fallback prompts and the cache TTL are not in it. **That is the B10r pattern again: the Reference was not wrong, it was silent, and silence reads as "nothing there" unless someone looks.**
