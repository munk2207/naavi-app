# Session 18 — Retrieval robustness, live data sources, website rewrite

**Date:** Sunday, April 19, 2026
**Status:** Closed.
**Closing builds shipped:** V53.2 build 98 DIAG on Internal Testing. Voice server commit `dd92c5f`. Website live on `origin/main` with `81e2952` and prior.

---

## Session headline

Two architectural shifts landed tonight, both from the same insight: **Claude is good at reasoning about data, bad at carrying data.**

1. **Retrieval moved from Claude's action payload into the orchestrator.** Mobile and voice server both detect retrieval intent, strip question words, run `global-search` with the user's literal text, and inject results into Claude's prompt. Claude speaks grounded answers instead of guessing, and digits/IDs never get paraphrased by an LLM.

2. **Global Search adapters stopped keeping silos and started reading live sources.** Calendar now queries Google Calendar API live. Contacts now queries Google People API live. Lists now reads item content from Drive docs. The sync tables are no longer the search-of-truth — Google is.

The supporting fixes: 0.5 similarity threshold on knowledge search (in two places), TextInput autocomplete disabled, pre-search query word-stripping, bubble-truncation fix via fixed-pixel `maxWidth` + `flexShrink: 1`.

---

## Ground rules from the top of the session (still apply for Session 19)

1. Do not craft test scripts to make tests pass. Call out known-fragile paths upfront.
2. Test what the end user would actually do (voice input included).
3. Do not re-run with a softer query to turn a red into a green.
4. "It worked on my side via curl" does not close the loop. It closes on the user's phone in the user's session.
5. No test theater.

Two more that emerged tonight:

6. **Do not assume.** When a fix doesn't work, instrument and observe before proposing the next one. (I violated this with the autocomplete fix — claimed it would solve the digit-strip bug without verifying; it didn't on the first try, and the user called it.)
7. **Do not blindly mirror patterns across features.** The email_actions pipeline uses next-morning confirmation; the recording pipeline does NOT. Applying one pattern to the other created a contradiction between the home page and the how-to-use page. Tonight's root fix: check the actual code path, not the nearest pattern.

---

## What shipped — server side (live, no install)

| Change | Where |
|---|---|
| Live Google Calendar query replacing the 6-hour-sync adapter | `supabase/functions/global-search/adapters/calendar.ts` |
| Live Google People API query replacing the internal contacts silo | `supabase/functions/global-search/adapters/contacts.ts` |
| Drive-doc item search for lists (not just list names) | `supabase/functions/global-search/adapters/lists.ts` |
| 0.5 similarity threshold on Global Search knowledge adapter | `supabase/functions/global-search/adapters/knowledge.ts` |
| 0.5 similarity threshold on the voice-server's knowledge endpoint | `supabase/functions/search-knowledge/index.ts` |
| `[TRACE-3]` diagnostic log in `naavi-chat` | `supabase/functions/naavi-chat/index.ts` |
| Voice server pre-search on retrieval intent | `naavi-voice-server/src/index.js` (commit `bc6ba2e`) |
| Voice server pre-search query word-stripping | `naavi-voice-server/src/index.js` (commit `dd92c5f`) |

---

## What shipped — mobile side (V53.2 build 98 DIAG, Internal Testing)

| Change | File |
|---|---|
| OAuth scopes now include `contacts.readonly` + `contacts.other.readonly` | `lib/supabase.ts` |
| Orchestrator pre-search on retrieval intent, with question-word stripping | `hooks/useOrchestrator.ts` |
| Bubble truncation fix (fixed-pixel maxWidth + flexShrink) | `components/ConversationBubble.tsx` |
| TextInput autocomplete / autocorrect / spellcheck disabled | `app/index.tsx` |
| Live `inputText` DIAG readout under chat box (orange, to be removed in next clean build) | `app/index.tsx` |
| Version bump chain: V53 (build 96) → V53.1 (build 97) → V53.2 (build 98) | `app.json`, `app/settings.tsx` |

The diagnostic orange readout is still in the current build. It will come out in the next clean build. Not urgent.

**User must sign out and sign back in after install** — the new contacts OAuth scope isn't in tokens minted before V53.

---

## What shipped — website (live on mynaavi.com)

Full home-page rewrite for the invited-early-adopter audience, following the ground rules the user articulated during the session:

- Lead with what Robert *actually* experiences, not what Naavi *does*. The stories carry the product.
- Do not name the reader's fears out loud — they recognize themselves.
- Well-educated older people don't want to be lectured.
- The product answer never appears in the same breath as the fear.

Specific changes on the site:
- Home page rewritten: short hero, "Your life" prose section with four alternating panels (asymmetry intro + hockey + insurance + brakes), honest doctor visit scene, personal invitation merged into the signup section.
- Removed: the Siri/Alexa comparison table, the 4-persona audience grid, the "She's already in every room you live in" section, the long "letter to Robert."
- Added the OCR-of-attachments-coming-soon parenthetical to the brake scene — the only forward-looking claim on the page, and it's labelled.
- Doctor visit scene corrected to match the actual immediate auto-create behavior — calendar + reminders are ready before Robert reaches his car, transcript goes to Drive, added to memory, searchable for future use.
- `/guide` renamed to `/how-to-use` with a 308 redirect; label unified across nav, footer, page title, meta.
- Blogs nav button inverted to secondary styling so Getting Started (now "How to use") reads as primary.
- Early Adoption three-step added to the how-to-use page: sign up → receive invitation → download.
- Role dropdown trimmed to Active senior / Family member / Other.
- CTA unified to "I'd be glad to try it" — a personal acceptance phrase, not a waitlist ask.
- Signature on the invitation: `— Wael`. No title, no "co-founder" framing — keeps it personal.

Website commit hashes (in order tonight):
`e168646`, `26238db`, `81b5ec3`, `db1b04f`, `0a78d5f`, `8e0da22`, `77881f9`, `cf5b614`, `23ae759`, `02e7f16`, `81e2952`.

---

## Bugs diagnosed, resolved or deferred

| # | Bug | Status after Session 18 |
|---|---|---|
| 1 | Chat bubble truncated long digit strings on Android | **Resolved** (V53.1+). Fixed-pixel maxWidth + flexShrink. |
| 2 | Claude appeared to hallucinate digits in `GLOBAL_SEARCH.query` | **Root cause different from first suspected.** It was Android's keyboard autocomplete replacing typed digits with contact suggestions from the user's phone book before the app even received the keystrokes. Not Claude. Resolved by disabling autocomplete + autocorrect on the TextInput. |
| 3 | Phrasing fragility ("what do you know" vs "what do we have" diverged in behavior) | **Partially resolved.** Orchestrator-side pre-search now catches most retrieval phrasings via regex. Claude is no longer the routing decision-maker for retrieval. |
| 4 | Knowledge adapter returning 5 unrelated results for non-semantic queries | **Resolved.** 0.5 similarity threshold applied in both `global-search/adapters/knowledge.ts` and `search-knowledge` Edge Function. |
| 5 | Claude's voice reply said "nothing found" while the card showed the actual result (the "Find Hany" contradiction) | **Partially resolved.** Pre-search results are now injected into Claude's prompt so replies are grounded. Query word-stripping added so `Find Hany` searches for `Hany`, not the literal phrase. |
| 6 | Contacts adapter was an internal Supabase silo, never knew about the user's real contacts | **Resolved.** Live Google People API query. Requires user re-auth after V53 install. |
| 7 | Calendar adapter had a 6-hour sync lag | **Resolved.** Live Google Calendar API query. |
| 8 | Lists adapter only searched list names, never items | **Resolved.** Drive doc content now scanned at search time. |
| 9 | Home page contradicted the how-to-use page about what happens after a recording ends | **Resolved.** Home page now describes the immediate auto-create behavior. The contradiction was caused by me misapplying the email_actions pattern to the recording flow. |

---

## Verified working on the user's phone (Session 18 close)

- `Find Bob` → card shows the calendar event `meeting with bob — Apr 20, 2026`. Live calendar fix proven.
- `Find Hany` → card shows `Dr. Hany Yassa - Eye - 613-590-1077 - Oct 31, 2025`. Card correct; pre-search query fix addresses the prior contradiction between voice and card.
- `Find phone 6137374471` (typed) → bubble shows full digits on V53.2. Autocomplete disable + bubble-truncation fix both proven.
- User reports "everything works" after V53.2 install.

---

## Known open items — Session 19 scope

**Session 19 name: `SESSION_19_SAME_QUESTION_SAME_ANSWER.md`**
*Subtitle: Robert asks the same thing twice. Naavi answers the same way both times.*

Scope (in priority order):

1. **Intermittent Deepgram transcript dropout** — calls where user speaks, audio arrives, no `[Deepgram] FINAL:` ever produced. Workaround: hang up and redial. Not root-caused. Evidence captured in the 16:56 voice call logs from tonight.

2. **Deepgram first-word truncation during barge-in** — observed tonight: user said "what time is it," Deepgram transcribed "Time is it?" The missing "what" drops the query off the trivial fast-path in `askClaude`. The query then falls into the full Sonnet path with knowledge fetch, taking ~5s for what should be a 2s answer.

3. **Trivial fast-path regex fragility** — requires "what" at start for most patterns. One missing word kicks everything to the slow path. Needs reworking so transcript quirks don't degrade the experience.

4. **Voice call latency variance** — retrieval queries now ~6s (expected, due to pre-search), but trivial queries occasionally take 10s when they should be 2-3s. Always correlated with the above Deepgram issues.

5. **Voice STT garbling structured data** (emails, phone numbers, addresses) — Deepgram struggles with identifiers. Needs either Deepgram tuning, post-transcription normalization, or a dedicated "spell it letter by letter" flow.

6. **Intermittent call drops after greeting** — Session 17 added drop-detection instrumentation. Still passive — waiting for the next real occurrence to diagnose. The evidence is ready when it happens: grep Railway logs for `[DROP]`.

All five above roll up to the session's framing: **Robert asks the same thing twice, and gets different answers.** Each of these bugs is a cause of that, not a separate thing.

---

## Carried-forward items that are NOT Session 19 scope

| # | Item | Why deferred |
|---|---|---|
| A | Attachment / OCR harvesting proposal | Next major feature after Session 19. Biggest next pain-point for Robert (warranty receipts, property tax notices). See `docs/PROPOSAL_ATTACHMENT_HARVESTING.md`. |
| B | Drive content adapter for general files (beyond lists) | Future. |
| C | Non-tier-1 Gmail adapter | Future, low priority. Promotional mail isn't what Robert asks about. |
| D | Remove the V53.2 DIAG orange readout | Next clean mobile build, whenever one is queued. Cosmetic. |
| E | Multi-user audit of voice server `/rest/v1/...` calls | Grep pass pending. Session 17 found + fixed two; others may exist. |
| F | Stale worktrees `.claude/worktrees/cranky-hoover` and `focused-agnesi` | Cleanup session whenever. |
| G | Hardening Claude's preference enforcement (e.g. the "no meetings before 10 AM" rule) with a deterministic guardrail, not just prompt wording | Worth doing once Session 19 stabilizes the base. |

---

## Two honest notes for the next session's Claude

1. **The `record-my-visit` flow creates calendar events immediately, not via the next-morning email_actions pipeline.** I got this wrong tonight and wrote a home-page scene describing next-morning confirmation. Wael caught it. The correction is on the live site. Don't re-introduce the mistake.

2. **Autocomplete props on a TextInput are a request, not a guarantee.** Android keyboards can and do ignore them. When the user reports "my digit-strip fix didn't work," instrument before patching again. Tonight, the autocomplete disable WORKED after a fresh install — the first test was against a cached old build. Could have been diagnosed faster if I'd checked the install state first.

---

## File path reminders

| Thing | Path |
|---|---|
| Mobile app main repo | `C:\Users\waela\OneDrive\Desktop\Naavi` |
| Mobile build clone (EAS only) | `C:\Users\waela\naavi-mobile` |
| Voice server | `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server` |
| Website | `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website` |
| This session's doc | `C:\Users\waela\OneDrive\Desktop\Naavi\docs\SESSION_18_RETRIEVAL_AND_TEXT_TRUNCATION.md` |

---

## Commit log — Session 18

| Repo | Commit | Description |
|---|---|---|
| naavi-app | (updated TRACE-3 in naavi-chat) | Diagnostic log for user message handoff |
| naavi-app | `7f817ed` | V53 build 96 — live sources, mobile pre-search, bubble fix, contacts scope |
| naavi-app | `9bb3466` | Fix duplicate `digitsOnly` declaration |
| naavi-app | `28b9014` | V53.1 build 97 — autocomplete disable, question-word stripping, knowledge threshold |
| naavi-app | `6707959` | V53.2 build 98 DIAG — orange live inputText readout |
| naavi-voice-server | `bc6ba2e` | Pre-search on retrieval intent, grounded Claude replies |
| naavi-voice-server | `dd92c5f` | Question-word stripping before global-search |
| mynaavi-website | `e168646` → `81e2952` | Full home rewrite, URL rename, label unification, doctor-scene correction, transcript+memory clarification |

AAB builds on Expo: `V53 (build 96)`, `V53.1 (build 97)`, `V53.2 (build 98) DIAG`.

---

Session 18 closed 2026-04-19 late evening. Next session will be `SESSION_19_SAME_QUESTION_SAME_ANSWER.md`.
