# Session 19 — Complete Handoff

**Date:** Monday, April 20, 2026
**Duration:** full-day session
**Mobile builds shipped:** V53.3 build 99, then V53.4 build 100 (hotfix for `lookupContact`)
**Closing state:** V53.4 build 100 AAB uploaded to Google Play Internal Testing by user. Server-side pipeline fully in place; one open diagnostic (school-calendar PDF read) at session close.

---

## Session headline

Session 19 went far beyond its original "One Question, One Answer" scope. What started as a fix for plural/singular retrieval inconsistency grew into a full restructure of Naavi's Drive storage, a complete Global Search coverage audit, the attachment-harvest + OCR pipeline (A1 + A2 + A3 Phase 1 and 2), document-type routing, voice-server fixes, and the first AAB of the session (V53.3), followed by a hotfix AAB (V53.4) when `lookupContact` was caught hallucinating phone numbers.

The day's spine was the principle: **Robert asks the same thing twice, he gets the same answer.** That principle drove dozens of incremental fixes.

---

## What shipped (14 server-side + 2 mobile builds)

### Global Search foundation

1. **Knowledge identifier guard** — queries that look like phone numbers, emails, or UUIDs skip the semantic-embedding adapter. No more "Wael likes pizza" appearing when searching for `6137976679`.
2. **email_actions adapter** — new Global Search adapter on top of the Claude-Haiku extracted actions. "Look up pay", "find anything about appointments" now hit extracted bills/appointments.
3. **Reminders adapter** — new. Closes the final Global-Search coverage gap. Every content repo Robert has is now searchable.
4. **Query normalization** — `expandQuery()` helper at the global-search handler. Plural/singular stemming (`payments` → `payment`), synonym map (bill→pay, meeting→appointment, doctor→appointment), AND email-username expansion (`david@gmail.com` → also `david`). All ILIKE adapters now match any variant. Calendar and knowledge left alone (their own intelligence).

### Gmail richness

5. **sync-gmail wider window + richer body + 3-tier signal_strength** — 7-day window (was 24h), 100-msg max (was 20), 3000-char body (was 500). New enum `signal_strength` on `gmail_messages`:
   - `personal` — sender is in Robert's Google People contacts
   - `institutional` — sender domain on the curated list (Canadian government, banks, insurance, utilities, telecoms, healthcare) OR Claude-promoted via `extract-email-actions`
   - `ambient` — Gmail flagged tier-1 but unknown sender (CNN articles etc.)
   Contacts are now read via Google People API (live), replacing the sparse local `contacts` table.
6. **Ambient excluded from Global Search gmail adapter** — per user's call, retrieval is not research. Only personal + institutional emails surface.
7. **Gmail adapter +0.1 score boost for personal + institutional** — known-sender hits outrank ambient on equal match.

### Claude document pipeline (A1, A2 Phase 1, A3 Phase 1 + 2)

8. **A1 — doc-type classification in `extract-email-actions`** — Haiku now also extracts `document_type` / `reference` / `expiry_date`. Backfill of 60 tier-1 emails ran successfully.
9. **A2 Phase 1 — attachment harvest to Drive** — new `harvest-attachment` Edge Function: PDF/JPG/PNG/DOCX/XLSX attachments (>10 KB, <25 MB) land in `MyNaavi/Documents/<document_type>/`. Cascade from `extract-email-actions`. Idempotency guard: before upload, checks `documents` table for `(user_id, gmail_message_id, file_name)`. Signature-image filter: skips `imageNNN.*` pattern and images < 100 KB.
10. **A3 Phase 1 — Claude reads text-layer PDFs** — new `extract-document-text` Edge Function. Claude Haiku with `document` content block. Stores `extracted_summary`, `extracted_amount_cents`, `extracted_currency`, `extracted_date`, `extracted_reference`, `extracted_expiry`.
11. **A3 Phase 2 — Google Vision OCR fallback** — same `extract-document-text` function. On scanned PDFs or JPG/PNG images, falls back to Vision `DOCUMENT_TEXT_DETECTION`, feeds the OCR text to Haiku for structured extraction. Saves raw OCR text in `documents.extracted_text` AND uploads a sidecar `.ocr.txt` file to Drive next to the source (so Robert can verify what Vision read).
12. **Classify-once folder routing** — if a file is harvested into the wrong `Documents/<type>/` folder (e.g. because email_action wasn't yet classified at harvest time), `extract-document-text` moves the Drive file to the correct folder after Claude/OCR classifies its content. Moves are rare after initial classification — rule is: only reclassify if current type is `other` or NULL, or if caller passes `reclassify=true`.

### Drive restructure

13. **`save-to-drive` category routing** — accepts `category: 'transcript' | 'brief' | 'note' | 'list'`. Routes to `MyNaavi/Transcripts/`, `/Briefs/`, `/Notes/`, `/Lists/` lazily (subfolder auto-creates). Writes a `documents` row for each non-list save so Global Search covers it. Lists are excluded from `documents` (they have their own `lists` table + adapter, avoiding duplicate Global Search hits).
14. **Voice server tagged every save-to-drive call** — `SAVE_TO_DRIVE` action → `note`; call recording summary → `transcript`; missed-morning-brief save → `brief`.
15. **`manage-list` creates Lists under `MyNaavi/Lists/`** — server-side rewrite. Mobile-side `lib/lists.ts` also updated to pass `category: 'list'` (ships with next AAB).
16. **Migration** — `migrate-drive-structure` Edge Function moved 14 legacy loose files into their proper subfolders: 9 lists → `Lists/`, 1 brief → `Briefs/`, 4 notes → `Notes/`.

### Idempotency + cleanup

17. **`harvest-attachment` idempotency guard** — before upload, looks up existing `(user_id, gmail_message_id, file_name)` row. If present, returns the existing drive_file_id without re-uploading.
18. **`create-calendar-event` idempotency guard** — before Google Calendar API POST, looks up `(user_id, title, start_time)`. Returns existing event if match.
19. **`cleanup-duplicate-documents`** — one-off Edge Function that deleted 127 orphaned Drive duplicates created before idempotency was in place (51× `image001.jpg`, 38× Receipt, 38× Invoice).

### Voice reliability

20. **Voice email reconstruction** — `reconstructEmailAddresses()` in voice server handles two spoken forms: "Bob at gmail dot com" and "Bob at gmail.com". Converts to `bob@gmail.com` before global-search.
21. **Per-digit phone TTS** — voice server + `text-to-speech` Edge Function both normalise contiguous digit runs into space-separated single digits. No more "plus one, six hundred thirteen" for a phone number.
22. **Claude prompt v7 — inline answer when pre-search present** — `get-naavi-prompt` Edge Function updated. When `## Live search results` block is in Claude's prompt, Claude uses those results inline rather than emitting a GLOBAL_SEARCH action. Saves 5+ seconds on retrieval replies.
23. **Tail-append guard in `hooks/useOrchestrator.ts`** — the "In contacts: …" tail-append now only fires when `turnGlobalSearch.origin === 'claude-action'`. Pre-search results are already in Claude's reply, so appending them again caused double-reading. Ships with V53.3+.

### Other wins

24. **Hybrid Drive adapter** — `global-search/adapters/drive.ts`. Reads both the harvested `documents` table AND Google Drive's live `fullText` index. Rich metadata from harvest, plus catch-all from Drive.
25. **First-word-truncation fast-path** (attempted, then **REVERTED**) — two commits to `naavi-voice-server` regex relaxed the trivial-query fast path to accept "Time now." or "Date?" when Deepgram dropped "what". Three consecutive calls hung after deploying; revert restored normal behaviour. **Cause unclear** — logged that regex change and Deepgram hang are correlated but not proven causal. See `project_naavi_deepgram_first_word_truncation.md`.
26. **`calendar` document_type added** — 11th enum value. School-year calendars, sports schedules, holiday lists now route to `MyNaavi/Documents/calendar/`.
27. **Calendar ask-time PDF read in `naavi-chat`** — when the incoming user message matches `/\b(when|what\s+(date|day|time)|how\s+many\s+days|next|first|last|upcoming)\b.*\b(school|pa\s*day|holiday|break|...)/i` AND the user has a `document_type='calendar'` PDF, `naavi-chat` downloads the PDF binary and passes it to Claude as a `document` content block. **Verification inconclusive at session close** — see "Open diagnostic" below.
28. **Due-date vs expiry-date prompt tightening** — `extract-email-actions` prompt now has explicit rules and examples: appointments / events / meetings → `due_date`, warranties / policies → `expiry_date`. Re-backfilled 67 tier-1 emails. RBC appointment, Condo AGM now correctly in `due_date`.

### Mobile builds

- **V53.3 build 99** — consolidated server work + lib/lists.ts category + DIAG readout removed + useOrchestrator tail-append guard + version bumps. EAS built, user uploaded to Play Internal Testing, installed, verified working.
- **V53.4 build 100** — hotfix for `lookupContact` returning bogus phone `+20261` for Fatma. Google People API now step 1 in `lib/contacts.ts`; knowledge-fragment regex path removed entirely. EAS built; user uploaded to Play.

---

## Open diagnostic (the session closed without closing this)

### The school-calendar PDF read did NOT work on the user's mobile test

- The Ottawa-Carleton School Board PDF is in Drive at `MyNaavi/Documents/calendar/` with `document_type='calendar'` (verified via SQL after reclassification — `moved_to: calendar`).
- The `extract-document-text` run confirmed it: `summary: "Ottawa-Carleton District School Board elementary school calendar for 2025-2026 academic year"`.
- The user asked in the mobile app: *"When is the first day of school?"*
- Naavi's reply: *"I do not have school calendar, check with your school board."*
- **Supabase naavi-chat logs for the last 15 minutes showed no rows at all** — meaning the naavi-chat Edge Function was not invoked.

### Possible causes for next session to investigate

1. **Mobile version mismatch** — user may still be on V53.3 (build 99) despite uploading V53.4 (build 100) to Play. Play rollout can lag by minutes to hours. Check Settings screen version string.
2. **Client-side cache of an older Claude prompt** — `get-naavi-prompt` is cached per call after first fetch. Unlikely to matter but possible.
3. **Claude prompt v7 says "answer inline when pre-search results are present"** — but `detectRetrievalIntent` in `hooks/useOrchestrator.ts` does NOT include "when" in its regex. So for a "when is X?" question, pre-search DOES NOT run, no `## Live search results` block is injected, and the user message reaches naavi-chat without context. naavi-chat SHOULD still catch calendar intent and attach the PDF — but if somehow it doesn't, Claude has no context and replies as seen.
4. **Deploy cache** — Supabase occasionally serves previous version for a few minutes after deploy. Refreshing logs or waiting 5-10 min often resolves.

### Recommended next-session first move

1. Verify user is on V53.4 build 100 (Settings → bottom of screen).
2. Have user repeat the test. Time-stamp it.
3. Check naavi-chat logs for the `[TRACE-3]` line and the `[timing] calendar PDF attached for Claude` line from that exact invocation.
4. If naavi-chat STILL isn't being invoked, instrument more aggressively — add a `console.log('[naavi-chat] received request')` at the top of the function, deploy, retest.

---

## Schema additions

All applied via SQL migrations (files in `supabase/migrations/`):

| File | Change |
|---|---|
| `20260420_gmail_signal_strength.sql` | `gmail_messages.signal_strength` enum ('personal','institutional','ambient') |
| `20260420_email_actions_doctype.sql` | `email_actions.document_type`, `reference`, `expiry_date`; later constraint update to include `calendar` |
| `20260420_documents.sql` | New `documents` table with FK to `email_actions`, full extraction columns + RLS |
| `20260420_document_extraction.sql` | `documents.extracted_text`, `ocr_sidecar_drive_file_id` for OCR path |

### `document_type` enum (as of session close)

`invoice | warranty | receipt | contract | medical | statement | tax | ticket | notice | calendar | other`

---

## Memory entries created this session

| File | Purpose |
|---|---|
| `project_naavi_voice_privacy.md` | ⭐ HIGH PRIORITY — 4-piece voice-side privacy UX (labels + toggle + voice-server logic + per-category preferences). NOT shipped. Design captured; wait for dedicated session. |
| `project_naavi_query_normalization.md` | Plurals/synonyms SHIPPED. Voice email reconstruction piece 2 (short-form "Bob at gmail.com") still open in voice server. |
| `project_naavi_stop_word_regression.md` | "Naavi stop" no longer interrupts TTS; becomes next-question. Voice server fix needed. |
| `project_naavi_deepgram_first_word_truncation.md` | Deepgram drops leading word during barge-in. Regex relax reverted. Needs surgical re-attempt with actual logs. |
| `project_naavi_reminders_search_gap.md` | Reminders adapter SHIPPED this session — gap closed. |
| `project_naavi_alert_scope.md` | 6-trigger-type roadmap for future alert expansion: location (with Wael's school/mall examples), weather, health, contact_silence, list_change, price. |

MEMORY.md index updated with all of the above at the top. `project_naavi_next_mobile_build.md` appended with items 7 (voice tail-append verbose regression — shipped), 8 (lib/lists.ts category shipped), 9 (mobile mirror of calendar ask-time PDF reader — for next AAB).

---

## Demo video assets

`docs/DEMO_VIDEO_SCRIPTS.md` created — 6 scripts (Warranty, How Naavi works, Hockey, Renewal, Brakes, Doctor's Visit), 4 of them pulled verbatim from the mynaavi.com prose sections. AI-platform guide included (Runway, Pika, Sora, Synthesia, HeyGen, Invideo AI, ElevenLabs). Shot-list tables ready to paste into any video-gen tool.

---

## Configuration discipline findings

Adhered to CLAUDE.md rules throughout:

- No new parallel rule tables — `action_rules` is the canonical rule store.
- `evaluate-rules` still the canonical cron reader.
- `user_id` resolution in new Edge Functions followed the 3-step fallback chain (JWT → body → user_tokens) everywhere.
- `UNIQUE` constraints on new config tables (`documents.unique(user_id, drive_file_id)`).
- Did not use `.limit(1)` on multi-user tables as a shortcut.

### Lessons re-learned

- Logs are ground truth — don't assume, grep them (the Fatma `+20261` hallucination was actually a regex bug in `lookupContact`, not Claude making things up. Only found by reading the enriched message that was sent to Claude).
- Classify-once is the right design: if a file has already been classified as a specific type by Claude, don't reclassify on re-extract unless explicitly told to.
- Small regex changes to production voice-server trivial-query path can hang calls in unexplained ways; verify with logs before declaring cause.

---

## Session close — what the next session should know

1. **V53.4 build 100 is the latest AAB.** Nothing new since then needs an AAB (all fixes since were Edge Functions).
2. **The school-calendar PDF read is the one unclosed item.** Start there — it's a 10-minute diagnostic with live logs.
3. **Global Search coverage is now complete** across every content repo — reminders adapter closed the last gap.
4. **Drive structure is tidy.** `MyNaavi/Documents/<type>/`, `/Briefs/`, `/Notes/`, `/Lists/`, plus `.ocr.txt` sidecars next to images.
5. **Voice privacy UX is the next big feature.** 4-piece bundle documented in `project_naavi_voice_privacy.md`.
6. **No new memory pollution** — every new entry follows the frontmatter format + is indexed in MEMORY.md.
7. **Claude prompt v7 is live** on `get-naavi-prompt` (PROMPT_VERSION string reflects it).

---

## Quick-reference URLs

| What | URL |
|---|---|
| Supabase dashboard | https://supabase.com/dashboard/project/hhgyppbxgmjrwdpdubcx |
| Edge Functions | https://supabase.com/dashboard/project/hhgyppbxgmjrwdpdubcx/functions |
| SQL editor | https://supabase.com/dashboard/project/hhgyppbxgmjrwdpdubcx/sql/new |
| EAS builds | https://expo.dev/accounts/waggan/projects/naavi/builds |
| V53.4 AAB | https://expo.dev/artifacts/eas/o8Tdn4A18tpDuLNgLrQak5.aab |
| Google Play Console | https://play.google.com/console |
| Railway (voice server) | https://railway.app |
| Voice server repo | https://github.com/munk2207/naavi-voice-server |
| Mobile app repo | https://github.com/munk2207/naavi-app |
| Website repo | https://github.com/munk2207/mynaavi-website |
| Cloud Vision API | https://console.cloud.google.com/apis/library/vision.googleapis.com?project=naavi-490516 |
| Twilio number | +1 249 523 5394 |
