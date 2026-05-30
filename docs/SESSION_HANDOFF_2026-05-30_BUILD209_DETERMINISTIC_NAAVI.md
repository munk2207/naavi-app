# Session Handoff — 2026-05-30 | Build 209 | Next: Deterministic Naavi

## Status at close

- **Build 209** — ✅ submitted to Google Play Internal Testing
- **Auto-tester** — 188/188 green
- **Firebase Test Lab** — ON HOLD (suspended by Wael, no review process yet)

---

## What shipped this session

### Contact search fixes
- `CONTACT_STOPWORDS` — added search-intent verbs (`check`, `find`, `list`, `show`, `search`, etc.) so "Check RBC" no longer fails AND-logic
- `organizations` field added to Google People API `personFields` — company name is now searchable
- Combined name+org matching: `${nameLower} ${orgName}` — "Sara from Amazon" now works
- Prompt v104 — CRITICAL rule: Naavi NEVER suggests a contact name from its own training knowledge. Zero results → say so, do not invent alternatives

### Keyboard fix
- `app.json` — `softwareKeyboardLayoutMode: "pan"` → `"resize"` — keyboard no longer covers bottom buttons on Android

### FAQ updates (`mynaavi-website/faq.html`)
- Added 3 new questions at top: What is MyNaavi, What is the MyNaavi Community, How do I add someone
- Removed listen-bar audio block

### Mobile = Conversation. Web = Management (design principle)
- Added to `CLAUDE.md` as standing rule
- Mobile shows summaries and takes actions by voice
- Web handles review, edit, configure — anything that grows unbounded

### Web/Mobile architecture (Steps 1–3)
- **`app/manage.tsx`** — reusable authenticated WebView screen. Gets Supabase session → appends `#access_token=...&refresh_token=...` as URL fragment. Loading overlay, offline error, Retry. Restricts navigation to mynaavi.com only.
- **`mynaavi.com/manage/settings.html`** — interactive settings web page. Reads token from fragment, calls `setSession()`, auto-saves on change. Sections: Morning Call, Briefing Windows (coming soon preview), Alert Channels (5 chips), Addresses, Additional Phones.
- **`app/settings.tsx`** — "Advanced Settings →" row added after Voice PIN, opens manage.tsx → settings web page.
- **`app/_layout.tsx`** — `manage` screen registered with `headerShown: false`

---

## THE NEXT SESSION — Deterministic Naavi

### Origin of the design (from this session, before compaction)

Wael showed two screenshots of the same question ("Drive me to my next appointment") asked 2 minutes apart — Naavi gave two different answers. He said: *"I noticed this in several situations. I asked the exact question twice and received different answers."*

The diagnosis: **Claude is probabilistic by design.** Every response is generated from probabilities, not lookup. Same input → slightly different internal weighting → different output. This is not a bug in the code — it's a fundamental LLM behavior.

Wael's position: **"We are not designing an AI system. We are designing and delivering a correct, honest, and verifiable answer."**

---

### The architecture Wael designed

#### Core model

```
Robert speaks → Claude hears intent → Server fetches truth → Naavi delivers fact
```

- **Claude's only job:** understand what Robert asked and convert it to a structured request
- **Server's job:** fetch the real answer from the real source
- **Naavi's job:** deliver it in plain language using a fixed template

Claude is a **translator**, not an **answerer**.

---

#### Three layers

**Layer 1 — Pre-Claude bypass (Path A — Deterministic)**
Before Claude is called, the server checks the message against known intent patterns. If matched → fire deterministic handler → return verified answer. **Claude never runs.**

Already exists: B6e (calendar read bypass), B4y (confirm-then-act gate)
To build: NAVIGATE_TO_MEETING, FREE_BUSY_CHECK, and others progressively

Each new deterministic handler permanently moves one more query type off Claude.

---

**Layer 2 — Intent verification gate**
If Layer 1 doesn't match, Claude's ONLY job is to classify intent and output a structured object:

```json
{ "intent": "NAVIGATE", "confidence": "high", "params": { "target": "next_meeting" } }
```

Server reads it:
- **High confidence + handler exists** → run handler (Path A — deterministic answer)
- **High confidence + no handler** → honest-out: "I can't answer that yet, but here's what I know: [deterministic facts I can state]"
- **Low confidence** → Naavi asks Robert to confirm: *"I think you're asking me to navigate to Hussein's meeting — is that right?"* Robert confirms → handler runs

---

**Layer 3 — Best effort path (Path B — disclosed)**
If intent is clear but truly outside deterministic scope:

Naavi says: *"I can't give you a verified answer on that, but here's my best reading: [Claude answer]. Does that work, or would you like me to try a different approach?"*

Robert decides. Claude's answer is flagged as best-effort, not as truth. Robert's approval gates any action.

---

#### What changes per intent type

| Robert asks | Claude translates to | Server fetches | Naavi delivers |
|---|---|---|---|
| "Drive me to my next meeting" | NAVIGATE → next_meeting | Calendar → location → travel API | "Hussein's meeting, 408 Lockmaster, 22 min away" |
| "What rules do I have?" | LIST_RULES | DB query | Numbered list, verbatim from DB |
| "Do I have a doctor this week?" | CALENDAR_SEARCH → doctor | Calendar API | "Yes — Dr. Smith, Friday 2 PM" |
| "Find Hussein" (two Husseins) | LOOKUP_CONTACT | People API → 2 results | "I found 2: #1 Hussein Aggan, #2 Hussein Ali. Which one?" — Robert picks |

---

### Principles confirmed by Wael

1. **Out-of-scope = honest out.** Vague exploratory questions ("how's my afternoon looking?") are NOT part of the core Naavi use case. If Robert asks and Naavi says "Sorry, that's outside what I can do" — that is a correct, honest, and acceptable answer. No need to catch or handle those.

2. **Disambiguation belongs to Robert, not Claude.** When there are two Bobs or two meetings, Naavi surfaces the options as a numbered list and stops. Robert picks. Claude must never silently choose on Robert's behalf.

3. **Risk 2 is managed, not avoided.** Claude can still ASSIST with context and pronoun resolution ("him" = Hussein), but loses the right to EXECUTE. Claude translates; server acts.

4. **Risk 3 — uncertain intent → confirm first.** When classification is uncertain, Naavi surfaces the interpretation and asks Robert to confirm before firing. This is the intent gate.

5. **Build cost is the price of the quality promise.** "AI that says anything" is a different product. Correct reliable answers are exactly what Naavi is being marketed on. This is not for free — it's the feature.

6. **Two paths, both honest.** Path A = deterministic (traced, verified, always the same). Path B = best effort, disclosed, Robert decides. There is no hidden third path where Claude answers and Naavi presents it as fact.

---

### Where to start next session

**The first thing to build is the intent classification layer (Layer 2).**

Currently, every message goes to `naavi-chat` → Claude → full response. The new flow:

1. `naavi-chat` receives message
2. **Pre-check Layer 1** — does it match a known deterministic pattern? If yes → bypass Claude, call handler
3. **If no match** — call Claude with a restricted prompt: *"Classify this intent. Output JSON only: `{intent, confidence, params}`. Do not answer the question."*
4. Server reads the JSON:
   - Handler exists + high confidence → run handler
   - Low confidence → return clarification question to Robert
   - No handler → honest-out or Path B disclosure

**Files to touch:**
- `supabase/functions/naavi-chat/index.ts` — add Layer 1 pre-check + Layer 2 intent router
- `supabase/functions/get-naavi-prompt/index.ts` — add intent-classification-only prompt variant
- New file: `supabase/functions/naavi-chat/intentHandlers.ts` — deterministic handlers (start with LIST_RULES, CALENDAR_SEARCH, LOOKUP_CONTACT — already have server-side logic for these)

**Tests to write (Rule 15a):**
- Intent classifier returns valid JSON for known queries
- Layer 1 bypasses Claude for matched patterns
- Disambiguation surfaces numbered list, does not auto-pick
- Out-of-scope query returns honest-out, not a hallucinated answer

---

## Pending from this session (not started)

- Briefing Windows DB columns + Edge Function + cron (4 windows: Morning/Midday/Afternoon/Evening)
- Alerts, Lists, Notes management web pages (same WebView pattern as settings)
- AAB 210 when ready (209 just submitted — no immediate rebuild needed)

---

## Build reference

| Item | Value |
|---|---|
| Build | 209 |
| Version | V57.32.0 |
| versionCode | 209 |
| Auto-tester | 188/188 ✓ |
| EAS build ID | 546ad8b4-800f-47cc-b98e-e4a16441c513 |
| Submitted | Google Play Internal Testing |
