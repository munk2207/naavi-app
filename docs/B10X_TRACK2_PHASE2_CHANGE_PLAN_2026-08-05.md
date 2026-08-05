# B10x — Track 2 (Voice) — Phase 2 — Change Plan (Revision 2)

**Date:** 2026-08-05
**Governance version:** v4.0
**Phase 1A:** Approved — `docs/B10X_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-08-05.md`
**Revision 2 resolves:** 8 blockers from external review of Revision 1 (below). Revision 1's original 8 design decisions are retained except where a blocker required a real change — noted inline.

---

## AMENDMENT — 2026-08-05, same session, Wael's direct simplification

Revision 2's capture design (lazy trigger via `requiresConfirmedTimezone`'s intent/action gate, mid-conversation interrupt via `pendingTimezoneCapture` holding and resuming an original utterance) is **superseded** by a much simpler design, per Wael's explicit direction after a discovery mid-session changed the picture:

**The discovery:** `lib/location.ts::syncDeviceTimezone()` already exists and already writes the device's real timezone to `user_settings.timezone` automatically on every mobile sign-in/foreground event (`app/_layout.tsx:194, 239`) — a live mechanism, not a hypothetical one, which Track 2 Phase 1's evidence had twice failed to find. This raised the question of whether voice could just trust that value directly. Investigation found no reliable way to distinguish "mobile keeps this fresh" from "stale one-time snapshot" for a given caller — `user_settings.updated_at` is contaminated by voice's own writes (e.g. `morning_call_status`, `:12566`), so it can't serve as a proxy for mobile recency.

**Resolution — do not try to distinguish these cases at all.** For **inbound voice calls specifically**:
- Every call, unconditionally, the first thing Naavi does — before any other processing, not gated by intent/action classification — is ask the same question the demo line already proves works: *"What city or time zone are you in?"*, confirm with the same *"Got it — {zone} time. Is that right?"* pattern, using the same `parseTimezone.js` module, unchanged.
- The confirmed answer is written into `user_settings.timezone` + `timezone_confirmed_at` — the **same two columns** `syncDeviceTimezone` writes, so a voice-captured answer is indistinguishable from a mobile-synced one to any other reader. (`syncDeviceTimezone` itself should also be updated to set `timezone_confirmed_at`, so its automatic sync counts as a confirmation too — a small addition to `lib/location.ts`, mobile-side, cross-referenced here since it's a shared dependency, not owned by either track alone.)
- **`timezone_confirmed_at` is never checked on the voice side to decide whether to ask.** Every new call asks again, regardless of what a previous call or mobile already established. The stored value exists for *other* readers (mobile, `trigger-morning-call`, or a future feature) — voice itself doesn't consult it before asking.
- Within a single call, the confirmed value is held in a simple call-scoped variable (same lifetime/scope as the other `pendingX` state, e.g. `let effectiveTimezone`) and used directly for every timezone-dependent call site in that call — no DB re-read needed mid-call.
- **Outbound calls (the morning brief, Groups M/N) are unaffected — this ask never happens there**, per the earlier, separate decision: the brief uses `resolveEffectiveTimezone(userSettings)` reading whatever is already stored (confirmed by a prior voice call or by mobile), falling back to a disclosed Toronto default, exactly as already designed. There's no live caller to ask before the call connects.

**What this removes from Revision 2's design:**
- `requiresConfirmedTimezone.js`'s intent/action classification (`TIMEZONE_SENSITIVE_INTENTS`/`TIMEZONE_SENSITIVE_ACTION_TYPES`) — no longer needed; the ask isn't conditioned on what the caller is about to request.
- `pendingTimezoneCapture`'s "hold the original utterance and resume it after confirmation" logic — no longer needed; nothing has started yet when the question is asked, so there's nothing to resume.
- The distinction between "mobile-active" vs "voice-only" callers — no longer needed; voice always asks regardless.

**What's retained unchanged:** the migration (`timezone_confirmed_at`), `resolveEffectiveTimezone.js` (still the single read-path for outbound/background contexts and as the general-purpose resolver), `parseTimezone.js` reused as-is, the call-site classification table (Groups A-N still need the literal replaced — just sourced from the call-scoped variable for inbound groups, and from `resolveEffectiveTimezone()` for outbound Groups M/N).

---

## Correction to Phase 1's evidence (found while resolving Blocker 2)

Track 2 Phase 1 claimed `user_settings.timezone` was "completely unused." **That was wrong.** `supabase/functions/trigger-morning-call/index.ts:77-78` already reads it: `const tz = s.timezone || 'America/Toronto'; const todayStr = now.toLocaleDateString('sv-SE', { timeZone: tz });` — used to decide *when* to place each user's morning call. This wasn't found in Phase 1 because that grep only covered `naavi-chat`, the voice server, and mobile — not every Edge Function individually. This finding directly resolves Blocker 2 (below) and *strengthens* the case for this track: the exact "value-or-Toronto-fallback" pattern this track proposes is already live in production, proven safe.

---

## Blocker resolutions

### Blocker 1 — Regression matrix cannot be deferred

Traced execution context and `userId`/`userSettings` availability for every group, by direct code read (not memory):

| Group(s) | Containing function | Execution boundary | `userId` already available? | Resolution strategy |
|---|---|---|---|---|
| A | `fetchCalendarEvents(userId)` | Interactive turn (called from live-call handling) | Yes — direct parameter | Resolve once inside, or accept an optional pre-resolved value from caller (mirrors Track 1's own pattern) |
| D, E, F | `buildVoiceSystemPrompt(userName)` | Interactive turn, called from `askClaude` | **Not currently** — only receives `userName`. `askClaude(userMessage, conversationHistory, userIdOverride, ...)` (`:2361`) *does* have `userIdOverride` | Add a new parameter, `buildVoiceSystemPrompt(userName, effectiveTimezone)`; `askClaude` resolves once (it already has `userIdOverride`) and passes the resolved string down — no new DB read at the `buildVoiceSystemPrompt` layer |
| G, H | `askClaude` directly | Interactive turn | Yes — `userIdOverride` parameter | Resolve once at `askClaude`'s entry, reuse for the whole turn (Groups D/E/F/G/H all share this one resolution) |
| I, J | `executeAction(action, userIdOverride)` | Action execution, one per confirmed action | Yes — `userIdOverride` parameter | Resolve once inside `executeAction` |
| K | `processCallRecording({ callSid, recordingUrl, duration })` | Async, post-call | **Not currently** — signature has no `userId`. Its only caller, `triggerProcessingIfReady(callSid)` (`:636`), already does `activeRecordings.get(callSid)`, and that map's stored value **already includes `userId`** (`:8906-8911`, set when recording starts) | Add `userId` to the destructured object passed into `processCallRecording` at its one call site (`:645`) — reads from the same in-memory `ctx` already being dereferenced, no new DB read |
| L | `FETCH_TRAVEL_TIME` speech composition | Interactive turn / action-adjacent | Yes — `userId` used directly a few lines above (`:11228`, `user_id=eq.${userId}`) | Resolve once in this block |
| M, N | Morning-brief flow | Outbound, cron-triggered call | Yes — `userId` referenced directly (`:12450`, `fetchCalendarEvents(userId)`; `:12563`, `if (userId) {...}`) | Resolve once at the top of this flow |
| B, C | Brief/reminder TTS formatting, schedule-context builder | Same interactive-turn or brief-building scopes as the groups above (adjacent line ranges, same containing functions) | Yes, by the same evidence as their neighbors | Reuse the same per-scope resolved value, no separate lookup |

**Design principle this establishes (addressing the reviewer's latency/consistency concern directly):** every logical scope (one interactive turn, one action execution, one recording, one outbound brief) resolves the effective timezone **exactly once**, by fetching `user_settings.timezone, timezone_confirmed_at` alongside whatever else that scope already queries from `user_settings` where possible (e.g., the existing `home_address, work_address` lookup at `askClaude`'s `:3302` can select the two new columns in the same round trip), and threads the resolved **string value** — not the whole `userSettings` object — down through existing parameter chains. No group requires an independent new database round trip beyond what its scope already performs or could combine with an existing one.

### Blocker 2 — Group N cannot remain an implementation-time question

**Resolved, no cron file added to this track's scope.** `trigger-morning-call/index.ts` (evidence above) already resolves `s.timezone || 'America/Toronto'` for scheduling. Since Track 2's design (decision 2, unchanged) only ever writes `user_settings.timezone` together with `timezone_confirmed_at` in the same transaction, `timezone` never holds a non-default value without `timezone_confirmed_at` also being set — so the cron's simpler existing check and voice's new `resolveEffectiveTimezone()` will always agree in practice. **Classification: Group N is user-local calendar-day bookkeeping** (the reviewer's first option) and should use `resolveEffectiveTimezone()` for consistency and future-proofing, but **`trigger-morning-call/index.ts` itself needs no code change** — its existing read already matches the new design by construction. No cron file is added to the Files table.

### Blocker 3 — Lazy-capture continuation mechanism, corrected

**The original plan's approach (reusing the demo line's stateless TwiML-redirect pattern) was the wrong mechanism for this case, not just underspecified.** The demo line's ask/confirm flow works because it's a linear, single-purpose script with nothing else happening in the call. A registered caller's lazy-ask must interrupt an *arbitrary* in-progress intent (a calendar question, a medication reminder, anything) and resume it — that requires real conversation state, which the demo's URL-query-param approach was never designed to carry.

**Found instead: voice already has a proven mechanism for exactly this shape of problem.** The live WebSocket call handler already maintains in-memory, per-call session state — `conversationHistory` and `pendingActionRuleCreate` (both declared `:8394-8421`, inside the live-call handler, not a stateless HTTP route). `pendingActionRuleCreate` already implements "hold something, ask a follow-up, resume on confirmation" for action-rule creation (`:10053-10087`).

**Design: reuse this same mechanism**, not the demo's TwiML pattern:
- New in-memory variable, same scope and lifetime as `pendingActionRuleCreate`: `pendingTimezoneCapture = { originalUtterance, attempt }` — set when a timezone-dependent intent is detected with no confirmed timezone (Blocker 4's gate).
- Naavi speaks the timezone question as the **next turn in the same live call** — not a TwiML redirect to a separate route.
- On the caller's next utterance, check `pendingTimezoneCapture` first (same pattern as the existing `pendingActionRuleCreate` check at message-loop top, `:10053`): parse with `parseTimezone.js`, confirm, and on "yes," persist (`timezone` + `timezone_confirmed_at` together) and **re-process `pendingTimezoneCapture.originalUtterance`** through the normal turn pipeline, now with a confirmed timezone available.
- This resolves the reviewer's specific concerns about the stateless pattern **by construction**, not by adding new machinery to compensate for it:
  - **Max state in callback URLs** — N/A, no callback URL is used for this flow.
  - **Tamper protection** — N/A, state lives server-side in memory, never round-trips through the client/Twilio.
  - **Expiration** — bounded by the call's own lifetime; state cannot outlive the call.
  - **Idempotency if Twilio retries a webhook** — N/A, this flow doesn't use webhook redirects for its state.
  - **What happens when the resumed action has side effects** — no different from any other resumed pending-action flow already in production (`pendingActionRuleCreate`'s own resume already handles this case).
- `parseTimezone.js` is reused unmodified, exactly as Revision 1 already stated — only the *transport* around it changes, not the parser.

### Blocker 4 — Centralized gate, defined

New predicate, `naavi-voice-server/src/voice/requiresConfirmedTimezone(intent, action)`, called once per turn before dispatching to an intent handler:

- **Read-only date/time requests** (calendar query, "what's on my schedule," "what time is it") → gate fires if unconfirmed.
- **Mutating actions that schedule something** (`CREATE_EVENT`, `SET_ACTION_RULE` with `trigger_type='time'`, `SCHEDULE_MEDICATION`) → gate fires if unconfirmed.
- **Explicit timezone-change requests** → never gated — this intent *is* the confirmation flow itself, always allowed through.
- **Background/outbound operations** (morning-brief calls) → the gate does not fire interactively (no one to ask before the call is answered); resolved by Blocker 5 below instead.
- Every other intent (contacts, lists, non-time-sensitive Q&A) → gate does not fire.

Explicitly **not adopting** the reviewer's fifth suggested category ("requests where Toronto fallback is acceptable for the current call") as a distinct bucket — per this project's Rule 18 (never present an unconfirmed default as though it were a confirmed fact), there's no case where silently using Toronto for a timezone-sensitive answer is acceptable. If the gate doesn't interactively ask (e.g., attempt cap reached), the Toronto value is used **and disclosed**, per decision 3 (unchanged) — "acceptable to use silently" is never a state this design allows.

### Blocker 5 — Rollout wording corrected; outbound calls addressed

**Corrected regression statement**, replacing Revision 1's "zero behavior change" claim:

> Existing unconfirmed callers retain Toronto-based computation until a timezone-sensitive interactive request triggers the new confirmation flow; non-interactive (outbound/cron) paths continue using the Toronto fallback, disclosed per decision 3.

**Outbound morning calls, explicit decision:** an outbound brief cannot pause before the caller has even said hello to conduct a timezone interview — greeting time-of-day (Group M) and any timezone-sensitive brief content use the resolved value (confirmed if set, disclosed Toronto default otherwise) for that call's opening. If the account is unconfirmed, the brief's own content may include a lazy-ask trigger the same as an interactive call would (e.g., if the brief needs to state "your first meeting is at 9 AM," that's a timezone-dependent statement) — in that case, Naavi asks *after* the greeting, using the same in-memory mechanism as Blocker 3, with the brief's remaining content as the "original intent" to resume. This is a real, deliberate product behavior, not a gap — but it should be confirmed with Wael before Phase 4, since it does change the outbound-call experience for unconfirmed users, which the original "zero behavior change" framing incorrectly implied would never happen.

### Blocker 6 — Test infrastructure confirmed, files named

**Voice has a real, executable test framework** — confirmed: `naavi-voice-server/package.json`, `"test": "node --test test/*.test.js"`, with existing tests including `test/parseTimezone.test.js` (the exact module this track reuses already has test coverage). Rule 15a's exception path is **not** needed — a framework exists.

New test files, following the existing naming convention:
- `test/resolveEffectiveTimezone.test.js` — pure resolver unit tests: confirmed value returned, unconfirmed → Toronto, invalid stored value → Toronto + diagnostic log, missing `userSettings` → Toronto.
- `test/timezoneCapture.test.js` — the in-memory ask/confirm/persist/resume flow (Blocker 3's mechanism): happy path, reject-and-reask, parse-fail-to-default, hangup-mid-flow (assert no DB write occurs), change-timezone path, decline-to-change.
- `test/requiresConfirmedTimezone.test.js` — gate classification for each intent category (Blocker 4).
- Existing `test/parseTimezone.test.js` — confirmed adequate as-is; no change anticipated to the parser itself.
- Representative (not exhaustive) tests for each call-site group's *use* of the resolver — one test per group category (A/B/C, D/E/F, G/H, I, J, K, L, M/N), not 43 individual literal-by-literal tests.
- Live staging call scenarios — manual, per Phase 7, same as every other voice feature in this project's governance.

No Twilio retry/idempotency tests are needed for the *capture* flow specifically, since Blocker 3's resolution removed the stateless-webhook mechanism those tests would have targeted — that concern no longer applies to this design.

### Blocker 7 — Deployment sequencing and rollback

1. Apply the nullable `timezone_confirmed_at` migration to staging.
2. Verify existing voice code remains fully compatible (it doesn't yet read the new column — no behavior change expected at this step).
3. Deploy voice code (`naavi-voice-server`, Railway) that reads/writes the new column and implements the resolver, gate, and capture flow.
4. Run the automated test suite (`node --test test/*.test.js`).
5. Conduct live inbound-call testing on staging (happy path, reject, parse-fail, hangup, change-timezone).
6. Conduct outbound/morning-call testing on staging, per Blocker 5's decision.
7. Verify fallback behavior for existing (unconfirmed) rows explicitly — a real staging account with `timezone_confirmed_at = NULL` must behave identically to today until it triggers the flow.
8. Promote: migration to production first (additive, nullable — safe to apply independently of the voice code deploy), then voice code to production, in that order — never the reverse, since voice code that expects the column would error on a database that doesn't have it yet.

**Rollback:** rolling back the voice server deploy while leaving the migration applied is safe — the column simply goes unread again, identical to today's behavior. Rolling back the migration itself (dropping the column) is **not** planned and not needed for any rollback scenario — additive nullable columns don't require reversal.

### Blocker 8 — Group J / `create-calendar-event` scope

**Group J does not contradict Phase 0's exclusion.** Phase 0 excludes touching `create-calendar-event`'s **own code** — its internal default/deliberate behavior when it receives a `timeZone` argument. Group J doesn't modify `create-calendar-event` at all; it changes what **argument value** voice's own `SCHEDULE_MEDICATION` handler supplies to `create-calendar-event`'s existing `timeZone` parameter — squarely "voice using timezone correctly when it calls a shared function," which is exactly Track 2's scope, not a violation of it. The exclusion was about not touching the Edge Function's own code (Track 1's Phase 0 note), not about forbidding callers from passing it more accurate arguments.

**Required before Phase 4, per the reviewer:**
- Confirm exactly which voice medication-scheduling calls currently build a naive local ISO string (found: `index.js:5927-5944`, the `SCHEDULE_MEDICATION` default-time construction referenced in the classification table).
- Both the naive-string construction **and** the `timeZone` argument passed to `create-calendar-event` must change together — changing only one would reintroduce exactly this session's Demo 1 bug (naive string + mismatched timezone argument = wrong instant).
- **New test requirement, adopted as stated:** tests proving the stored Google event instant is correct both before and after a DST transition, for a medication schedule created with a non-Toronto confirmed timezone — added to `test/` per Blocker 6's file list (folded into the Group J representative test, not a separate file).

### Non-blocking refinement — cache the resolved timezone in a request context, not pure parameter threading

External review of Revision 2 accepted the "resolve once per scope" design from Blocker 1 but recommended formalizing where the resolved value lives: an explicit `callContext.effectiveTimezone` (or equivalent), rather than growing every function's parameter list one string at a time. Reduces signature churn, removes the risk of a future helper silently forgetting to accept/forward the parameter, and gives every handler one canonical place to inspect the value for debugging.

**Adopted.** `askClaude` already receives an `opts = {}` parameter (`:2361`) — an existing per-turn context object, the same shape this refinement asks for. Rather than inventing a new mechanism, resolve the timezone once at `askClaude`'s entry and stash it on `opts.effectiveTimezone`; `buildVoiceSystemPrompt` and other turn-scoped helpers read `opts.effectiveTimezone` instead of taking a new dedicated parameter. `executeAction` and `processCallRecording` don't currently have an equivalent context object — Phase 4 should check whether one already exists nearby (matching this same pattern) before introducing a new one for those two scopes, rather than assuming either way here.

### Additional correction — `parseTimezone.js` table placement

Fixed: moved out of "Files that will change" into a new "Existing components reused unchanged" note (below), since Revision 1's own explanation already said no change is anticipated — it shouldn't have been listed as changing.

---

## Files that will change

| File | Classification | Explanation |
|---|---|---|
| `supabase/migrations/[new]_user_settings_timezone_confirmed_at.sql` | Database | Add `timezone_confirmed_at timestamptz NULL` to `user_settings`. |
| `naavi-voice-server/src/voice/resolveEffectiveTimezone.js` | Shared Logic (new) | Centralized resolver (decision 5) + IANA validation (decision 4). |
| `naavi-voice-server/src/voice/requiresConfirmedTimezone.js` | Shared Logic (new) | Centralized gate (Blocker 4). |
| `naavi-voice-server/src/index.js` | Backend (voice server) | In-memory `pendingTimezoneCapture` ask/confirm/persist/resume flow (Blocker 3); gate call at turn dispatch; `buildVoiceSystemPrompt` signature extended with `effectiveTimezone`; `processCallRecording`'s call site extended with `userId`; all Group A-M call sites updated per the classification table; Group J's medication-scheduling call updated to pass the resolved zone to `create-calendar-event`. |
| `naavi-voice-server/test/resolveEffectiveTimezone.test.js` | Tests | New — resolver unit tests. |
| `naavi-voice-server/test/timezoneCapture.test.js` | Tests | New — capture/resume flow tests. |
| `naavi-voice-server/test/requiresConfirmedTimezone.test.js` | Tests | New — gate classification tests. |

**Existing components reused unchanged:** `naavi-voice-server/src/voice/parseTimezone.js` (parser, no changes anticipated); `naavi-voice-server/test/parseTimezone.test.js` (existing coverage, confirmed adequate); `supabase/functions/trigger-morning-call/index.ts` (already correct by construction, per Blocker 2 — not touched).

**Risk classification: Medium** (unchanged from Revision 1) — real schema addition (additive, nullable, safe rollback), a new voice UX flow now built on a proven existing mechanism rather than an unproven reuse of the demo's pattern, and a fully classified, search-based call-site inventory rather than a blind replacement.

---

## Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | No | Unchanged from Revision 1. |
| Voice | Yes | Unchanged from Revision 1. |
| Shared Core | No | Unchanged from Revision 1. |
| Database | Yes | Unchanged from Revision 1. |
| Cron | **No** (resolved, was "Possibly" in Revision 1) | `trigger-morning-call` needs no change — Blocker 2. |
| API contracts | No | Unchanged from Revision 1. |
| Tests | Yes | Expanded — three new test files named, per Blocker 6. |

**Duplicated-capability statement:** unchanged from Revision 1.

## Mandatory Architecture Impact Checklist

Unchanged from Revision 1 — all five answers hold under this revision.

## Regression Impact

| Function area | Affected? | Details |
|---|---|---|
| Voice commands | Yes | Regression statement corrected per Blocker 5 — not "zero behavior change," but "unconfirmed callers keep today's behavior until they trigger the new flow." |
| Geofencing | No | Unchanged. |
| Gmail integration | No | Unchanged. |
| Calendar integration | Yes | Unchanged. |
| Reminders | Yes | Unchanged. |
| SMS / call alerts | Possibly — Group L | Still flagged for explicit trace in Phase 4; not resolved by this revision, correctly left open rather than guessed. |
| Onboarding | No | Unchanged — decision 1 still rejects onboarding-time interruption. |
| Staging build | Voice server only | Unchanged. |

## Regression Matrix (per-change consumer trace)

Now resolved at the design level (Blocker 1's table above) rather than deferred wholesale. Per-line replacement details for each of the 43 occurrences remain Phase 4 execution work — but the **execution boundary, `userId` availability, and resolution strategy for every group** is now established with direct evidence, which is what this phase is required to produce. The one item still explicitly open is the Group L / SMS-alert trace, carried forward honestly rather than closed prematurely.

---

**No code written during this phase.**

**Status:** **Approved** (external review, 2026-08-05) — all 8 blockers resolved, plus the non-blocking request-context refinement adopted. One sub-item (outbound-call UX for unconfirmed users, Blocker 5) still needs Wael's explicit product confirmation before Phase 4, separate from this technical approval. Per the Phase-Gate Approval Rule, this reviewer verdict is not itself authorization to proceed — awaiting Wael's own separate go-ahead before Phase 3 begins.
