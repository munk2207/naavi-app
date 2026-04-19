# Session 18 — Retrieval robustness & text truncation

**Date:** Sunday, April 19, 2026
**Focus:** Remove Claude from the retrieval data path (fix #1A, #1B). Investigate text truncation in user bubbles (fix #2) — suspected root cause of digit hallucination.
**Carryover from Session 17:** V52.1 (build 95) on phone. Five failures documented in SESSION_17_HANDOFF.md.

---

## Ground rules (carried forward, repeat every session)

1. Call out known-fragile paths UPFRONT in test scripts (voice for structured data is fragile).
2. Test what the end user actually does (voice, not just typed).
3. Do not soften a failing query to turn red into green.
4. "Curl worked" ≠ "feature works." Closed only on the user's phone.
5. No test theater.

---

## Session 18 proposed plan (awaiting approval)

### Objective

Make retrieval deterministic: when the user asks a retrieval-style question, the **orchestrator** runs `global-search` with the user's **literal, untouched text** — Claude never sees the query as a free-form field to paraphrase. This closes #1A (phrasing fragility) and #1B (digit hallucination in `GLOBAL_SEARCH.query`) in one change.

In parallel, investigate #2 (user-bubble truncation) — this may be related to #1B if the message is being truncated *before* it reaches Claude.

### Phase 1 — Diagnose #2 (text truncation) FIRST (no code changes)

**Why first:** if the user's typed text is being truncated *before* `send()` is called, then the orchestrator-side pre-search would also receive truncated input. We need to know where the string is actually complete vs. not. This is 15 minutes of read-only investigation.

Trace for a concrete failing message `"Find phone 6137976679"`:

1. Read `app/index.tsx::handleSend` — inspect `inputText` state + `setInputText('')` timing. Does `text` equal the full input string at call time?
2. Read `hooks/useOrchestrator.ts::send()` — how is `userMessage` stored to `turns[]`? Is it `userMessage` or `enrichedMessage`?
3. Read the bubble render site in `app/index.tsx` — check for wrapping Views with `flex`, `width`, `overflow`, `numberOfLines` on Text, or anything truncating the string.
4. Add instrumentation plan only (not code): what `console.log`s would definitively answer where the string is intact.

**Deliverable:** a one-paragraph finding — "truncation is at location X, here's the evidence" OR "truncation is cosmetic (rendering only), the real string reaches Claude intact."

### Phase 2 — Orchestrator-side pre-search (Option A from SESSION_17)

**Architectural principle:** Claude decides *how to talk about* results. The orchestrator decides *what to search for*.

**Implementation sketch (confirm before coding):**

1. **New helper** `lib/retrieval.ts` (or inline in `useOrchestrator.ts`):
   - `detectRetrievalIntent(userMessage: string): { isRetrieval: boolean; searchText: string }`
   - Regex detection — deliberately crude. Triggers on: `what|who|where|when|how many|tell me about|do (we|you|I) have|is there|look up|find|search|show me|list` + a noun phrase, OR any message with a digit run ≥ 7 (likely a phone/ID lookup), OR any `@`/email pattern.
   - `searchText` = the raw user message, lightly stripped of question words at the front (e.g. "what do you know about my dentist" → "my dentist"), but NEVER rewriting digits or identifiers. If unsure, pass the full message.

2. **In `useOrchestrator.ts::send`**, BEFORE `Promise.all([sendToNaavi, ...])`:
   - If `detectRetrievalIntent(userMessage).isRetrieval` → run `global-search` with `searchText` (raw).
   - Attach top-N results to `enrichedMessage` under a `## Search results` section, marked clearly so Claude uses them.
   - Set `turnGlobalSearch = { query, results }` so the card renders the data regardless of what Claude says.
   - On retrieval intent, instruct Claude via enriched context NOT to emit a second `GLOBAL_SEARCH` action.

3. **Remove reliance on Claude's `GLOBAL_SEARCH` action for retrieval** — keep the action handler in place as a safety net, but the orchestrator-driven path takes precedence. Claude is no longer the primary trigger.

4. **Voice server mirror** — `naavi-voice-server/src/index.js` gets the same pre-search logic (same regex). Without this, voice calls still go through Claude-decides-to-search and inherit the same bugs. Single-source the regex by putting it in a tiny JS helper both sides import (or duplicate with a comment if sharing is painful).

**Trade-offs (disclose):**
- Adds ~0.5–1.5 s latency on retrieval messages (parallel `global-search` fetch during Claude thinking).
- Crude regex will misfire — e.g. "find me a quiet cafe" has "find" but shouldn't search the user's own data. Acceptable: a spurious search returns 0 hits and Claude ignores it.
- Some true retrievals won't match the regex — acceptable fallback: Claude's own `GLOBAL_SEARCH` still fires.

### Phase 3 — #1C minimum-similarity threshold (small, scoped)

While touching retrieval:
- `supabase/functions/global-search/adapters/knowledge.ts` — add `similarity < 0.5` filter (threshold tunable).
- Detect identifier-like queries (mostly-digit, contains `@`, or UUID shape) server-side in `global-search` dispatcher — skip knowledge adapter for those; run only exact-match adapters (contacts, sent_messages, gmail, calendar).

Keep Phase 3 optional — only do it if Phase 1 + 2 land quickly. Otherwise it becomes Session 19.

### Phase 4 — Verification (honest, representative)

For each change:
- Call out fragile paths upfront (voice is fragile for digits).
- Test #1A with the exact failing wording: *"What do you know about my dentist"* typed AND spoken.
- Test #1B with the exact failing number: type `Find phone 6137976679` — confirm the search runs on `6137976679`, not a rewritten number.
- Reproduce from the user's phone, not just curl. If the loop can't be closed on the phone this session, document that clearly.

---

## Out of scope this session

- #1D button clipping (cosmetic, queue for a UI polish pass)
- #1B voice transcription of emails/phones (Deepgram tuning — separate effort)
- Document OCR / attachment harvesting (next major feature, future session)
- Drive item-level adapter
- Merge cleanup of stale worktrees
- Gmail non-tier-1 adapter

---

## Work log

(to be filled during the session)

---

## Known commits / builds

(to be filled at session close)
