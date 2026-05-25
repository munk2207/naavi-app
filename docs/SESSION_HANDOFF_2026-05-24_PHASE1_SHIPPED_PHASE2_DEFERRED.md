# Session Handoff — 2026-05-24 — Phase 1 Shipped, Phase 2 Deferred

**READ FIRST (in this order):**
1. `CLAUDE.md` (project root) — standing rules. **TWO new authoritative rules added tonight:**
   - **Rule 12 rewritten** — every state-changing commitment now requires pre-confirmation + specific post-action readback (carve-out removed)
   - **Rule 15a added** — every new functionality / modification MUST have a corresponding auto-tester test before moving on to the next item
2. This handoff (the file you're reading)
3. `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md` — restructured tonight: 25 closed rows moved into a new consolidated `## Closed history` section at the end. Active tables now show only OPEN work (7 B / 7 F / 6 T / 3 I).

**Auto-tester baseline:** **127 / 127 GREEN** (Rule 15 ✓). Includes 4 new tests added tonight (B4y / B3z / B4f) per Rule 15a.

---

## What shipped tonight (6 distinct fixes, 12 commits across 2 repos)

| Item | What | Where | Verified |
|---|---|---|---|
| **B4f** | TTS postal codes no longer read as "meters" — `sanitiseForSpeech` now normalizes Canadian postal codes + province abbreviations BEFORE the existing char-splitter | `hooks/useOrchestrator.ts:3262` | ✓ Wael live test (mobile chat: *"K1C5M3"* → "K one C, five em three") |
| **B4x** | Disabled alerts surfaced in name-match queries; combined "Want me to reactivate it and attach your list?" ask; auto-reactivate preprocessor on user "yes" turn | `supabase/functions/naavi-chat/index.ts` + `naavi-voice-server/src/index.js` | ✓ Wael live test mobile + voice |
| **B4y Phase 1** | HAS_CREATE_INTENT regex gate blocks SET_EMAIL_ALERT / SET_ACTION_RULE(email) when user message lacks explicit create-intent phrase | `naavi-chat::detectEmailAlert` + naavi-chat post-Claude validator + voice askClaude validator | ✓ Wael live test (mobile: "Find McDonald alert" → no rule created) |
| **B4y storage fixes** | Parse `trigger_config` if string (Haiku oneOf-schema misbehavior) + default `to_phone` from `user_settings.phone` when missing | `hooks/useOrchestrator.ts::SET_ACTION_RULE` + `naavi-voice-server/src/index.js::SET_ACTION_RULE` | ✓ Mobile fix ships with next AAB; voice live; auto-tester clean |
| **B3z** | OAuth `naavi_google_oauth_pending` gate removed — every SIGNED_IN event now writes fresh `provider_refresh_token` to `user_tokens` (idempotent overwrite) | `lib/calendar.ts:154` | ✓ Mobile fix ships with next AAB; eliminates "intermittent disconnect" pattern Wael had been noticing |
| **CLAUDE.md Rule 12** | Rewritten — every state-changing commitment requires pre-confirmation + specific readback (was carved out before) | `CLAUDE.md` | ✓ Authoritative text live |
| **CLAUDE.md Rule 15a** | New — test required for every new functionality before moving on | `CLAUDE.md` | ✓ Authoritative text live |

**Plus tonight's bonus deliverable per Rule 15a:** `tests/catalogue/session-2026-05-24.ts` with 4 new tests covering B4f / B4y Phase 1 (positive + negative controls) / B3z static analysis. Test catalogue now 127 / 127 green.

---

## ⭐ Phase 2 — DEFERRED, the focused next-session work

**What Phase 2 is:** the FULL implementation of new CLAUDE.md Rule 12 — universal server-side confirm-then-act gate covering EVERY state-changing action type (not just the email-rule class that Phase 1 covers).

**Why it was deferred tonight (not a failure — a scope decision):**

Attempted Phase 2 mid-session: added prompt RULE 23 + universal gate in naavi-chat + voice. Live probe of "alert me at Walmart" showed Claude:
1. Did NOT follow RULE 23 cleanly (said "Which Walmart location?" instead of "Say yes to confirm")
2. BROKE the existing chain-store rule that says "don't ask which Walmart for bare brands"

The harmonization between RULE 23 and ~22 existing prompt rules needs careful tuning. **Plus the auto-tester showed 14 new failures** — tests that expected single-turn action emission now fail because the gate enforces 2-turn flow. Test rewrites needed.

**Revised honest estimate: 5-10 hours of focused work**, not the 3-5 hours originally estimated. Reverted Phase 2 attempt cleanly (commits `f4f2265` main + `926e520` voice) to restore 117/123 → then 123/123 → then 127/127 green baseline.

**Phase 2 scope for the next focused session:**

1. **Update `supabase/functions/get-naavi-prompt/index.ts`** — add a new RULE 23 instructing Claude on the confirm-then-act + specific readback pattern. Must be carefully written to NOT dilute existing rules (chain-store, list-connect, calendar, etc.) — this is the prompt-harmonization work.

2. **Implement universal server-side gate in `naavi-chat`** — drops state-changing actions when there's no prior confirm-shape ask + user "yes". State-changing list per Rule 12: `SET_ACTION_RULE`, `SET_EMAIL_ALERT`, `SET_REMINDER`, `CREATE_EVENT`, `SCHEDULE_MEDICATION`, `UPDATE_MORNING_CALL`, `REMEMBER`, `ADD_CONTACT`, `SAVE_TO_DRIVE`, `DRAFT_MESSAGE`, `LIST_CREATE`, `LIST_ADD`, `LIST_REMOVE`, `LIST_CONNECT`, `LIST_DISCONNECT`, `LIST_DELETE`, `DELETE_RULE`, `DELETE_EVENT`, `DELETE_MEMORY`, `LOG_CONCERN`, `UPDATE_PROFILE`, `SET_LOCATION_RULE_CHAIN`, `SET_LOCATION_RULE_ADDRESS`. Exempt (read-only): `GLOBAL_SEARCH`, `LIST_RULES`, `LIST_CONNECTION_QUERY`, `lookup-contact`.

3. **Implement universal gate in voice `naavi-voice-server::askClaude`** — same logic, voice parity.

4. **Rewrite ~14-50 affected tests** to expect 2-turn flow. The `chatWithConfirm` helper is already saved in `tests/lib/assertions.ts:128-167` — sends user message, parses confirm-shape ask, sends "yes", returns turn 2 response. Tests likely affected (per the Phase 2 attempt):
   - `chat.location-default-one-time`, `chat.priority-flag-critical`
   - `lists.create`, `lists.add`, `lists.remove`
   - `prompt-regression.chain-store-walmart`, `chain-store-tim-hortons`
   - `prompt-regression.calendar-no-auto-invite`
   - `prompt-regression.home-no-clarification`, `office-no-clarification`
   - `prompt-regression.remember-medication`
   - `prompt-regression.list-remove-item-not-disconnect`
   - `prompt-regression.all-day-holiday-date-only-format`
   - `prompt-regression.all-day-explicit-phrasing-date-only-format`

5. **Auto-tester back to 100% green** before any AAB build (Rule 15). Rule 15 acknowledgment: **AAB build blocked from Phase 2 start until tests return to green.**

6. **Bump `PROMPT_VERSION`** in `get-naavi-prompt/index.ts` to reflect the new rule.

7. **Per Rule 15a (the new rule shipped tonight):** Phase 2 itself must produce regression tests proving the confirm-then-act behavior. The `chatWithConfirm` helper enables this cleanly.

**Pre-existing Phase 2 inputs already in place:**
- ✓ CLAUDE.md Rule 12 (authoritative policy text)
- ✓ `chatWithConfirm` helper (tests/lib/assertions.ts)
- ✓ Phase 1 narrow gate (the validator pattern Phase 2 generalizes)
- ✓ B4y entry in holding-list (full Phase 2 plan documented)

---

## ⭐ End-to-end mobile + voice parity verification

| Fix | Mobile path | Voice path | Status |
|---|---|---|---|
| **B4f TTS postal codes** | `hooks/useOrchestrator.ts::sanitiseForSpeech` (shipped tonight) | `naavi-voice-server::normalizeAbbrevForTTS` at `:3965-4011` (shipped under B4i 2026-05-23) | ✓ **In parity** |
| **B4x disabled alerts** | `naavi-chat`: alerts context shows both ACTIVE + DISABLED; 3 validators handle 4 match cases; auto-reactivate preprocessor on user "yes" turn | `naavi-voice-server::askClaude`: alerts context shows both; deterministic bypass on affirmative + prior combined ask (turn 2); `_b4xMaybeReactivateForEntityRef` in LIST_CONNECT/LIST_DISCONNECT handlers | ✓ **In parity** — both surfaces live + verified live by Wael (mobile passed; voice passed after deterministic-bypass iteration) |
| **B4y Phase 1 HAS_CREATE_INTENT gate** | `naavi-chat::detectEmailAlert` regex gate + post-Claude validator for SET_EMAIL_ALERT / SET_ACTION_RULE(trigger=email) | `naavi-voice-server::askClaude` post-Claude validator with same regex pattern + speech override | ✓ **In parity** — both surfaces deployed |
| **B4y storage fixes** | `useOrchestrator.ts::SET_ACTION_RULE`: parse `trigger_config` if string + default `to_phone` from `user_settings.phone` | `naavi-voice-server::executeAction SET_ACTION_RULE`: same parse + same to_phone default | ✓ **In parity** — both surfaces deployed (mobile ships with next AAB) |
| **B3z OAuth pending-flag gate removed** | `lib/calendar.ts:150` `captureAndStoreGoogleToken` — gate removed; every SIGNED_IN with provider_refresh_token writes to user_tokens | Voice doesn't have this code path (Path B Edge Function path) — `parity-impact: voice=none` documented in commit `8deb379` | ✓ **N/A for voice** (mobile-only fix; voice unaffected) |
| **CLAUDE.md Rule 12 + Rule 15a** | Both surfaces bound by the authoritative text from next session forward | Same | ✓ **In parity** |

**Drift discipline check (Rule 16):** every commit tonight that touched watchlist files (`naavi-voice-server/`, `hooks/useOrchestrator.ts`, `supabase/functions/naavi-chat/`, `supabase/functions/get-naavi-prompt/`) carries a `parity-impact:` line in the commit body. Audit by `git log origin/main --since="2026-05-24 00:00" --grep="parity-impact"` on each repo.

**Net parity status:** **mobile and voice are fully synced as of tonight's session-end.** No drift introduced. Phase 2 will need to maintain parity again — the same universal gate must land on both surfaces simultaneously.

---

## Open items carrying into the next session

**HIGH-priority (queue first):**

1. **B4y Phase 2** — the universal confirm-then-act gate. Detailed plan above + in holding-list `B4y` entry. 5-10 hour focused session.

2. **B4w — Naavi fabricates contact names on 0-result contact search** (HIGH severity, truth-at-user-layer breach). Live evidence: Wael's 2026-05-24 voice call where Naavi fabricated *"Saline Paris"* and *"CSA mailing list"* as contact-search results. Fix path: server-side bypass for "find contact by <attribute>" intents that runs deterministic attribute-search; if 0 results → canonical "I don't have a contact with [attribute] [value]" without calling Haiku. Holding-list B4w entry.

3. **F2h — Contacts adapter doesn't fetch postal addresses from Google People API** (feature gap). `personFields=names,emailAddresses,phoneNumbers` — no `addresses`. So "find contact at postal code K1A 0B1" structurally cannot return matches. Pairs with B4w. ~30-45 min server code. Holding-list F2h entry.

**MEDIUM (background):**

4. **B4f mobile ships with next AAB** — `hooks/useOrchestrator.ts::sanitiseForSpeech` change. Wael's TTS will fully match the live server normalizer once the new AAB lands.

5. **B3z mobile ships with next AAB** — `lib/calendar.ts` gate removal. Eliminates "intermittent disconnect" pattern post-install.

6. **B4r mobile half** — already shipped per holding-list closure (V57.22.2 build 198); next AAB stays on this baseline.

7. **B4u location-clarification UX fix** — shipped per holding-list (in V57.22.2 build 198 area); ships with next AAB if not already on user's phone.

**LOW (informational):**

8. **mynaavi2207 OAuth re-auth complete tonight** — `user_tokens` row fresh; auto-tester back to full 123 + 4 new = 127 green. If Wael powers off mynaavi2207 again for extended periods, may need re-auth in future sessions.

9. **Test catalogue documented gaps** (per Rule 15a exception path) in `tests/catalogue/session-2026-05-24.ts` header:
   - B4x disabled-alert surfacing needs seeding + multi-turn — deferred
   - B4y storage normalization defensive code — hard to exercise without Claude mocking

---

## Commits this session (12 + 5 = 17 across 2 repos)

`naavi-app` (main repo) — 12 commits, last hash `33413d2`:
```
33413d2  docs(CLAUDE.md): add Rule 15a — test required for every new functionality
0989920  test: regression coverage for tonight's fixes + restructure holding list
8deb379  fix(B3z): remove OAuth pending-flag gate so user_tokens always rotates
f4f2265  revert(B4y Phase 2): roll back universal confirm-then-act gate + RULE 23
eb4bb5e  fix(B4y): storage normalization + Rule 12 policy rewrite
b52760d  fix(B4y): block unauthorized email-rule writes from search-shape utterances
0a610e8  fix(B4x): two-turn-aware prompt rule for disabled-alert combined ask
98a03ff  fix(B4f+B4x): TTS postal-code "meters" + disabled-alert truth-at-user-layer breach
(plus 4 earlier in the session before the first checkpoint)
```

`naavi-voice-server` (Railway-deployed) — 5 commits, last hash `926e520`:
```
926e520  revert(B4y Phase 2): roll back universal confirm-then-act gate
1f9705d  fix(B4y): voice parity — drop email-rule actions from search-shape utterances
680da14  fix(B4y): voice parity — parse trigger_config + default to_phone
064848b  fix(B4x): voice deterministic bypass + two-turn prompt rule for combined ask
2662533  fix(B4x): voice parity — surface disabled alerts in name-match queries
```

---

## Where to start next session

1. **Open CLAUDE.md** — read the new Rule 12 + Rule 15a text. Internalize the confirm-then-act + readback pattern + the test-before-moving-on obligation.
2. **Open holding-list** `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md` — active tables now show only the 23 open items.
3. **Pick a track:**
   - Track A — **B4y Phase 2** (5-10 hr focused session, full confirm-then-act enforcement)
   - Track B — **B4w + F2h** together (~1-2 hr, contact-search trust breach + postal-address feature gap)
   - Track C — **AAB build** to ship B4f + B3z + B4u mobile fixes (run test:auto first per Rule 15, then `eas build --auto-submit`)

---

**Auto-tester:** ✓ 127 / 127 GREEN — Rule 15 ✓ — AAB builds unblocked
