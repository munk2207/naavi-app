# E2E Test Matrix — Session 21

**Created:** 2026-04-21 (Session 21 opening deliverable)
**Scope:** 15 orchestration commands from [NAAVI_ORCHESTRATION_DEMO.md](NAAVI_ORCHESTRATION_DEMO.md) × 3 input channels.
**Verdict rule:** a test passes ONLY when Wael confirms from his end. This matrix is empty by default — Claude does not pre-mark anything green.

---

## Channels

| ID | Channel | Where the command is issued |
|---|---|---|
| **MT** | Mobile — text | Typed into the app chat on the phone (V54.2 build 103) |
| **MV** | Mobile — voice (hands-free) | Spoken into the app in hands-free mode |
| **PC** | Phone call | Spoken during a live Twilio voice call to +1 249 523 5394 |

---

## Status legend

| Symbol | Meaning |
|---|---|
| ✅ | Tested today, user confirmed pass |
| ❌ | Tested today, user confirmed fail |
| ⚠️ | Blocked by a known open bug (do not test until the bug clears — see notes) |
| ⭕ | Never tested in this channel — candidate for today |
| ➖ | Not applicable (command cannot be issued in this channel by design) |

---

## The matrix

| # | Command | MT | MV | PC | Notes / blockers |
|---|---|---|---|---|---|
| 1 | Buried warranty surfaced (*"Find the warranty for my washing machine"*) | ⚠️ | ⭕ | ⚠️ | Apr 22 — partial. Claude text answer correct (*"Nothing found for warranties"*) + irrelevant card shown (S2 — warranty-in-condo-meeting doc false-positive). Text-vs-card contradiction confused the user. PC blocked by voice privacy UX. |
| 2 | Geofenced grocery list at Costco (*"Alert me at Costco with my grocery list"*) | ✅ | ⚠️ | ⭕ | Apr 22 MT — PASS (2-alias save confirmed, S9 open). Apr 22 MV — 4/6 steps pass + final TTS silent (S18). S9 re-confirmed. |
| 3 | School calendar PDF answer (*"When is the first day of school?"*) | ✅ | ⚠️ | ⚠️ | Apr 22 MT — Sep 2, 2025. Apr 22 MV — 4/5 (STT truncation, NLU recovered). Apr 22 PC — 4/5 (verbose read of raw search results, S19). All 3 channels delivered the correct date. |
| 4 | Contact silence (*"Tell me if Sarah hasn't emailed in 30 days"*) | ❌ | ⭕ | ⚠️ | Apr 22 — **FAIL**. Phrasing uses present-perfect tense (past/present query); Naavi created a future alert rule instead of answering now. See S11. |
| 5 | Morning brief phone call | ➖ | ➖ | ⭕ | PC-only by design (Naavi dials out). Trigger via `trigger-morning-call` cron or manual invoke |
| 6 | In-call visit recorder (*"Naavi, record my visit"*) | ➖ | ➖ | ⚠️ | PC-only by design. Stop-word regression open ([project_naavi_stop_word_regression.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_stop_word_regression.md)) — *"Naavi stop"* may not interrupt TTS |
| 7 | "Home" becomes a real place (*"Alert me when I arrive home"*) | ✅ | ⚠️ | ❌ | Apr 22 MT — *"from Settings (home)"* ✅. Apr 22 MV — 5/5 mechanical, but "already inside" UX missing (AAB #2). Apr 22 PC — **FAIL 2/5**: call connects ✅, voice clean ✅; STT missed ❌, no rule created ❌, verbose ❌ (S19). STT miss = root cause (known Deepgram PC bug). |
| 8 | Weather + checklist morning ping | ✅ | ✅ | ⭕ | Apr 22 MT — rule-set PASS (S13 open on channel fan-out). Apr 22 MV — all 5 criteria pass, STT clean, TTS audible, no truncation. Fire-verify deferred to next 7 AM. |
| 9 | *"What do I know about David?"* | ✅ | ⚠️ | ⚠️ | Apr 22 — user-confirmed pass. Truncation bug did not repro here. |
| 10 | Bill due from invoice PDF (*"When do I owe money to Bell?"*) | ❌ | ⭕ | ⚠️ | Apr 22 — **FAIL**. Naavi dumped search card instead of composing an answer. Zero Bell results (matched "bill"/"balance" elsewhere). Bell invoice exists in inbox but wasn't surfaced. See AAB doc §Server-fix list. |
| 11 | Leave-time with weather buffer (*"What time should I leave for my 3 PM dentist?"*) | ❌ | ⭕ | ⭕ | Apr 22 — **FAIL**. Test event *"Meeting with Hussein, 1pm, 408 Lockmaster Crescent"* on today's primary calendar. Naavi replied *"I don't see a meeting with Hussein..."* + truncated. See S6 (calendar lookup) + AAB item #5 (truncation). |
| 12 | Cross-channel recall (*"What did I tell the doctor about my BP?"*) | ❌ | ⚠️ | ⚠️ | Apr 22 — **FAIL** against 4 of 5 criteria. No composed answer (S1), irrelevant card results (S2), no "how to capture" guidance (S16). **New: S17 — semantic direction ignored** (query was outbound "what did I tell"; Naavi searched inbound appointment emails). |
| 13 | Calendar-triggered message to contact (*"30 min before my dentist, text my wife…"*) | ❌ | ⭕ | ⚠️ | Apr 22 — **FAIL** due to S6. Naavi said *"I don't see a meeting with Hussein on your calendar."* + offered *"Once it's added, I can set that alert up for you."* Good that she didn't guess. "My wife" resolution path remains **untested**. |
| 14 | One sentence, two writes (*"Remember Sarah's birthday is April 15"*) | ❌ | ⭕ | ⚠️ | Apr 22 — **FAIL**. UI showed 2 save cards but Notes confirmed 1 fragment stored (S7 — cosmetic). Calendar event NOT auto-created (S8). Text reply truncated (AAB #5). |
| 15 | Prescription timeline (*"When does my Atorvastatin run out?"*) | ✅ | ⚠️ | ⚠️ | Apr 22 MT — PASS after REMEMBER seed (date math "8 days", typo tolerance). Apr 22 MV — 4/6 pass + STT mangled *"Atorvastatin"* → *"Aturvastin"* (semantic match recovered), answer missing relative "8 days" framing, TTS audible. PC blocked by voice privacy UX. |

---

## Coverage summary

- **Total cells:** 45 (15 × 3)
- **Not applicable:** 4 (commands 5, 6 are PC-only)
- **Blocked by open bug:** 11 (voice privacy, stop-word, name mangling, response truncation)
- **Previously passed and re-testable:** 1 (cell 7-MT, from Session 20)
- **Candidate for today:** 29

---

## Recommended Session 21 test order

Start with the cheap, fast, unblocked MT cells. They prove server-side orchestration without tripping any of the open voice bugs.

1. **3-MT** — school calendar PDF answer.
2. **7-MT** — *"arrive home"*, confirm *"from Settings"* reply.
3. **10-MT** — *"When do I owe money to Bell?"* (text is safe; voice privacy gap only matters on PC).
4. **11-MT** — leave-time calculation (needs a real calendar event).
5. **14-MT** — one sentence, two writes (REMEMBER + auto-calendar).
6. **2-MT** — set the Costco rule with grocery list name; verify row in `action_rules` + `user_places`. Fire-verify deferred to physical trip.
7. **4-MT** — contact_silence rule set; server fires can be simulated with a SQL fixture that backdates gmail_messages.
8. **8-MT** — weather rule set; fire-verify deferred to tomorrow 7 AM.
9. **13-MT** — calendar-triggered wife-message rule (verify rule stored; fire-verify when the event arrives).
10. **15-MT** — Atorvastatin refill answer from email_actions.

Then MV for the same commands to verify voice-in → text-out parity (no voice privacy risk because mobile can render visually).

PC cells wait for the voice-server session that addresses the four open voice bugs.

---

## Per-test artifact checklist

For every cell Claude marks during execution, capture:

1. **User's confirmation** (screenshot or typed *"pass"* / *"fail"*).
2. **Supabase Edge Function log** URL (for the EF that served the turn).
3. **SQL state assertion** — post-test query proving the side-effect is correct (`action_rules` row shape, `user_places` alias pair, `email_actions` classification, etc.).
4. **For fire-verify tests** — message delivery receipt (Twilio console status, inbox screenshot, push tray).

Missing any of 1-3 for a ✅ cell = not actually ✅. Downgrade to ⭕.

---

## Known bugs — tracker links

| Bug | Affected cells | File |
|---|---|---|
| Voice name search / Deepgram STT mangles proper nouns | 4-PC, 9-PC, 12-PC, 13-PC, 14-PC | [project_naavi_voice_name_search.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_voice_name_search.md) |
| Mobile text response cut off (*"Nothing stored on"*) | 9-MT, 9-MV, 12-MT, 12-MV | [project_naavi_next_mobile_build.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_next_mobile_build.md) item #1 |
| Voice stop-word regression | 6-PC | [project_naavi_stop_word_regression.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_stop_word_regression.md) |
| Voice first-word truncation | any PC cell with fast-path phrasing | [project_naavi_deepgram_first_word_truncation.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_deepgram_first_word_truncation.md) |
| Voice privacy UX (medical/financial read-aloud) | 1-PC, 10-PC, 12-PC, 15-PC | [project_naavi_voice_privacy.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_voice_privacy.md) |

---

## Next deliverables (from Session 20 §5)

1. ✅ E2E test matrix (this file).
2. ⭕ Pre-ship smoke checklist — 10 tests, 5-minute sheet for every new AAB.
3. ⭕ Server-only Node.js harness — curl/invoke each Edge Function with canned inputs, assert responses.
4. ⭕ Voice + text parity tester — same DB side-effect from MT vs MV vs PC.
5. ⭕ Bug triage workflow — log-first diagnostic path.

Waiting on user direction before starting #2.
