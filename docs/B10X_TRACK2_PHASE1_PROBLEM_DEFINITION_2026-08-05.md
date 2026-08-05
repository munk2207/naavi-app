# B10x — Track 2 (Voice) — Phase 1 — Problem Definition

**Date:** 2026-08-05
**Governance version:** v4.0
**Phase 0:** Approved, amended to add this track — `docs/B10X_PHASE0_INTENT_2026-08-05.md`

---

## What exactly is broken?

Voice has no mechanism, of any kind, for knowing a registered caller's real timezone. `naavi-voice-server/src/index.js` hardcodes the literal `'America/Toronto'` at 40+ call sites spanning calendar all-day-event windowing, brief/schedule date formatting, "now" computation used to resolve relative dates in prompt context, and medication-schedule defaults. For a registered user whose real timezone differs from Eastern, numerous voice interactions involving dates or times — including calendar windowing, schedule formatting, relative-date context, and medication defaults — can be computed against the wrong timezone.

*(Corrected 2026-08-05, external review — the original wording, "every voice interaction... is computed against the wrong one," overstated what the cited evidence proves. The evidence establishes many important hardcoded paths are wrong; it doesn't establish that every date/time interaction goes through one of them.)*

## Evidence (freshly verified this session, 2026-08-05)

1. **Scale of the hardcoding**, representative sample across distinct functional areas (not exhaustive — 40+ total matches for `America/Toronto` in this one file):
   - Calendar all-day windowing: `index.js:810-811` (`todayDateStr`, `sevenDaysDateStr`).
   - Brief/schedule formatting: `index.js:1396-1406`, `:1751-1771`.
   - "Now" computation for date-arithmetic prompt context: `index.js:1902-1911`.
   - Medication-schedule defaults: `index.js:5927-5944`.
2. **`user_settings.timezone` already exists and is almost entirely unused.** `supabase/migrations/20260415000002_user_settings.sql:8`: `timezone text DEFAULT 'America/Toronto'`. Grepped every read/write of it across `naavi-chat`, the voice server, and mobile this session — zero hits besides two dead comments (below).

   **Correction, found during Phase 2 (2026-08-05):** the original Phase 1 grep missed `supabase/functions/trigger-morning-call/index.ts:77-78`, a third Edge Function which already reads this column: `const tz = s.timezone || 'America/Toronto';` — used to decide per-user morning-call timing. So the column isn't *completely* unused — one real consumer already exists, and its read pattern is exactly the "value-or-Toronto-fallback" shape this track proposes elsewhere, which is a point in favor of the design, not against it. See `docs/B10X_TRACK2_PHASE2_CHANGE_PLAN_2026-08-05.md`'s Blocker 2 resolution for the full analysis.
3. **A prior session already identified this exact fix and never built it.** `supabase/functions/naavi-chat/index.ts:3410` and `naavi-voice-server/src/index.js:3334` both carry the comment: *"replace with user_settings.timezone when global-first refactor lands."*
4. **The ask/parse/confirm mechanic already exists, proven live, but discarded instead of persisted.** `naavi-voice-server/src/voice/parseTimezone.js` — a dedicated, deterministic (no-LLM), well-factored module that maps spoken city/region names to IANA timezone strings, paired with a working Gather/Say/confirm TwiML flow (`index.js:7394-7583`, functions `buildDemoContextAndTimezoneTwiml` → `buildDemoTimezoneConfirmTwiml`). Traced the full flow: the confirmed value is passed **only** as a Twilio callback URL query parameter (`tz=...`) through that single call's remaining TwiML round-trips, used solely to parse that one demo reminder's send time. Grepped the entire flow (`index.js:7360-7700`) for any `supabase`/`user_settings` write — **none exists.** The value is discarded the moment the call ends.
5. **Voice already has an established read/write pattern on `user_settings` for the same user, via the same phone-based resolution this fix would reuse.** Confirmed multiple existing direct PostgREST calls against `user_settings` in this file: user resolution by phone (`index.js:970`), custom keyterms (`:1143`), phone lookup for confirmation replies (`:1561, 4679, 4844`), home/work addresses (`:3302`). Adding a `timezone` column read (and a write, for the confirm step) extends an already-used pattern — it is not a new capability being introduced to this codebase.

## Root cause

Structurally different from Track 1 — not "a value exists but isn't threaded one more hop," but **"no value has ever existed for this medium."** A phone call carries no device-timezone signal the way a mobile HTTP request does (confirmed: no such field exists anywhere in the Twilio webhook payloads this codebase already parses). The F2b demo line already solved the harder half of this problem — asking, parsing, and confirming a spoken timezone reliably — but that work was scoped narrowly for anonymous, one-shot demo callers, so its output was never wired to persistence. The gap is entirely in the "what happens to the confirmed answer" step, not in capturing or understanding it.

## Alternatives considered

- **(Recommended) Ask once per registered caller, reusing the proven `parseTimezone.js` + confirm-TwiML mechanic; persist the confirmed IANA string to `user_settings.timezone`; read it at voice's hardcoded call sites, falling back to the same `'America/Toronto'` default already in use everywhere.** Minimal new code — reuses a proven parser, a proven UX flow, and an already-used DB table/pattern.
- **Infer timezone from the caller's phone number area code.** Rejected — unreliable given mobile number portability and VOIP numbers; would reintroduce exactly the "confident-but-wrong" inference trap CLAUDE.md's Rule 18 exists to prevent (presenting a guess as a fact).
- **Twilio Lookup API / CNAM caller geolocation.** Rejected as a primary source — weak, unreliable signal for mobile numbers specifically (the overwhelming majority of real callers), adds API cost and a new dependency for marginal benefit over simply asking.
- **Mobile auto-writes its per-request `client_timezone` into `user_settings.timezone`, so voice benefits passively without ever asking.** Considered complementary, not adopted as part of Track 2's own scope (per the amended Phase 0) — a voice-only caller who has never opened the mobile app would get no benefit from this alone, so Track 2 still needs its own ask/confirm path regardless. Worth a future follow-up, not required here.
- **Do nothing; voice stays permanently Toronto-only.** Rejected — directly contradicts Wael's stated intent for this ticket ("fix Time zone across all").

## Architecture ownership

Per `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md:68`, Calendar reads are **Duplicated** (ADR 0002) — voice's live-fetch and date-handling code is independently implemented from mobile/`naavi-chat`'s, in a separate repository (`munk2207/naavi-voice-server`) with a separate deploy target (Railway, auto-deploy from `main`). This is Protected Core — **Voice orchestration** and **Calendar integration** both, per the Architecture Reference's risk table.

### Cross-Repository Verification (Architecture Scope Rule)

**Freshly verified this session:**
- Voice's implementation is confirmed structurally distinct from Track 1's (evidence #1-4 above) — different file, different repo, different mechanism (no per-request client value exists to reuse; must be captured and persisted instead).
- `user_settings` is the same Supabase table already shared and read/written by both mobile (`naavi-chat`) and voice (evidence #5) — this is a genuinely shared table, not a duplicated one, so writing the confirmed timezone here makes it visible to both surfaces going forward, even though this track's scope is voice's read/write path only. (Whether mobile should also read from this column, or should instead keep relying on its own per-request `client_timezone` as Track 1 does, is explicitly out of this track's scope — Track 1's fix does not depend on or benefit from Track 2's write path.)
- No other implementation of "ask/confirm a caller's timezone" exists anywhere else in the codebase besides the F2b demo line's — confirmed by grep for `parseTimezone` (3 files: the module itself, its test-adjacent `parseReminderTime.js` neighbor, and `index.js`'s usage — no other consumer).

---

## External review, 2026-08-05 — Mandatory Phase 2 requirements

Track 2 Phase 1 reviewed and **Approved, subject to the following being explicitly resolved in Phase 2** (not merely literal replacement of the hardcoded strings):

1. **Trigger point.** Lazy capture at the first timezone-dependent request, not an automatic interruption on every caller's first call. E.g., when the caller first asks about a calendar, reminder, medication time, "today," or another timezone-sensitive function: *"Before I answer, what city or timezone should I use for your dates and times?"* Avoids onboarding friction for callers who never touch timezone-sensitive functionality.
2. **Confirmation-state schema.** Do not rely on `timezone` being null vs. populated — the column already defaults to Toronto for every row. Add an explicit `timezone_confirmed_at timestamptz NULL`: `NULL` = never explicitly confirmed; non-null = `user_settings.timezone` holds a confirmed value. A timestamp (not a boolean) for auditability/troubleshooting.
3. **Fallback semantics, defined centrally.** Confirmed timezone → use stored value. Otherwise → `America/Toronto`. Unconfirmed users keep current behavior until they provide one. The system must never present the Toronto default as though it were a confirmed fact.
4. **Validation boundary.** Only valid IANA timezone identifiers may be persisted or used. Even though the existing parser only returns known-good values, Phase 2 must define server-side validation — DB contents can also originate from migrations, support tooling, future clients, or manual corrections. An invalid stored value must fail safely to Toronto and emit a diagnostic signal, not break a call.
5. **Centralized voice timezone resolution.** No independent querying/interpretation of `user_settings.timezone` at dozens of call sites. Phase 2 must define one helper (conceptually `resolveEffectiveTimezone(userSettings)`), consumed by every timezone-dependent voice function — reduces the chance future code reintroduces Toronto literals.
6. **Call-site classification, before replacement.** Each of the 40+ occurrences must be classified as one of: user-local timezone dependency / deliberate Toronto business-default behavior / test fixture / demo-only behavior / comment or dead code / unrelated timezone use. A blind global replacement is unsafe.
7. **Update/correction path.** Phase 2 must define how a caller changes a previously confirmed timezone — at minimum, support an explicit request like *"Change my timezone to Vancouver,"* updating both `timezone` and `timezone_confirmed_at`.
8. **Concurrent-call and partial-flow behavior.** The ask/confirm flow must not persist the proposed timezone until confirmation succeeds — a disconnected or abandoned call must leave the prior setting unchanged. Phase 2 must also define behavior when: the caller rejects the interpreted city; parsing fails repeatedly; the caller hangs up; a previously-confirmed user declines to change their timezone.

**No code written during this phase**, per governance.

**Status:** Track 2 Phase 1 — **Approved, subject to the above 8 items being explicitly addressed in Phase 2.** Track 1 Phase 1 — **Approved.** Per the Phase-Gate Approval Rule, this reviewer verdict is not itself authorization to proceed — awaiting Wael's own separate, explicit go-ahead before Phase 1A begins for either track.
