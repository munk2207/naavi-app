# Architecture — `naavi-chat`'s Two Action-Generation Systems

**Status: living reference doc.** Written 2026-07-14 (F16), based on direct code reading of `supabase/functions/naavi-chat/index.ts` and `intentHandlers.ts` as they stood that day. Line numbers drift as the file changes — treat them as a starting point for a grep, not a permanent citation. Update this doc whenever either system's routing logic or the recipient-resolution paths change.

**Why this doc exists:** during the F15 investigation (2026-07-09), substantial diagnostic effort was spent instrumenting the wrong pipeline before discovering that `naavi-chat` actually runs two structurally different systems for turning a user's message into an action. Neither F12 nor F15's own first three revisions knew the second system existed. This doc exists so the next investigation starts from an accurate map instead of re-discovering the split.

---

## The split, in one paragraph

Every user message that isn't a fast-path chat greeting goes through **Layer 2** first — a small, separate, stateless Haiku call (`classifyIntent()`) that sees only the current message text, no conversation history, no tools. If Layer 2 confidently recognizes the message as a single, well-known action, it handles the whole thing deterministically with hand-written templates and never calls Claude's tool-use system at all. If Layer 2 doesn't recognize it (multi-action, ambiguous, needs conversation context, or an intent it doesn't handle), the message falls through to **Path B** — a full Claude tool-use call with `NAAVI_TOOLS`, the entire conversation history, and native tool-calling instead of JSON-in-prompt.

Both systems, when they produce a "here's what I'll do, say yes to confirm" response, embed the same kind of marker (`<!--PENDING_INTENT:{...}-->`) in the reply. A single shared piece of code — informally "Step 1.4" — is the only place that actually reads that marker back on the user's next "yes" and executes the write. That marker is the entire contract between the two systems and the database; if either system produces a confirm-sounding reply without embedding a valid marker, the "yes" turn has nothing to execute and Naavi still says "Done" (this exact failure mode is B9i and its 2026-07-14 follow-up — see the Known Gaps section).

---

## System 1 — Layer 2 (deterministic classifier)

**Entry point:** `classifyIntent()`, `naavi-chat/index.ts`. Called from the main handler unless the message matches `FAST_CHAT_RE` (short greetings/acknowledgements) or `LIST_CONNECTION_RE` (list-to-alert connection queries), both of which skip classification entirely.

**Critical property: stateless.** `classifyIntent(client, userText)` receives only the single current message string — not the conversation array. This is deliberate (keeps the classifier fast and cheap), but it means Layer 2 structurally cannot resolve a bare follow-up reply like "Halo" or "3pm" on its own; anything that depends on earlier turns falls through to Path B by construction, every time, regardless of how short or long the conversation is.

**Output shape:** `{ level: 'A' | 'B' | 'action' | 'chat', intent, confidence, params }`.

- **Level A** (read-only, answerable from real data): `LIST_RULES`, `LOOKUP_CONTACT`, `CALENDAR_SEARCH`, `READ_CALENDAR`, `GMAIL_SEARCH`, `PERSON_LOOKUP`, `LIST_READ`, `REMINDER_READ`, `MEMORY_SEARCH`, `CREATE_TICKET` (the full set is `HANDLED_INTENTS` in `intentHandlers.ts`). Executed immediately via a dedicated handler function (`handleListRules`, `handleLookupContact`, etc.) — no confirmation step, no marker.
- **Level action** (single create/update/delete): only handled deterministically if `intent` is in `HANDLED_ACTION_INTENTS` (`intentHandlers.ts`) — `SET_REMINDER`, `CREATE_EVENT`, `REMEMBER`, `DELETE_RULE`, `DELETE_MEMORY`, `ADD_CONTACT`, `DELETE_EVENT`, `DRAFT_MESSAGE`, `SET_ACTION_RULE`. A template builds the confirm speech (`buildActionConfirm()`), embeds a `PENDING_INTENT` marker, and returns — nothing is written yet.
  - `SET_ACTION_RULE` with `trigger_type: 'time'` has its own large sub-branch inside the `__FALLTHROUGH__` handling with three further forks: **self-override** (literal destination the user gave directly — no contact lookup needed, hardened by B9i/B9i-followup), **third-party by name** (calls `lookup-contact` directly, has its own inline disambiguation), and **self-reminder, no recipient** (sets `pathB = true` and falls to Claude, since a plain reminder needs no deterministic template Layer 2 doesn't already have via `SET_REMINDER`).
- **Level B or `chat`, or an action intent not in `HANDLED_ACTION_INTENTS`, or classification failure** → `pathB = true`, falls through to System 2.

---

## System 2 — Path B (Claude tool-use)

**Entry point:** `client.messages.create({ model: 'claude-haiku-4-5-20251001', messages: augmentedMessages, tools: NAAVI_TOOLS, temperature: 0, ... })`, later in the same handler.

Same underlying model as Layer 2 (Haiku) — the difference is **context and mechanism**, not model quality: Path B sees the full conversation history and calls native tools (`NAAVI_TOOLS`, defined in `supabase/functions/_shared/anthropic_tools.ts`) instead of Layer 2's single-message JSON-in-prompt classification.

Handles everything Layer 2 didn't: multi-action requests ("and" chains), opinion/reasoning questions, **all location-trigger alerts** (`set_location_rule_address` / `set_location_rule_chain` tools — Layer 2 has no location-alert path at all), and any bare follow-up reply to an earlier Layer 2 question that Layer 2 itself can't re-classify (per the statelessness note above).

Claude's tool_use output for actions also gets intercepted before being returned to the user — e.g. a time-trigger `SET_ACTION_RULE` tool call gets a `PENDING_INTENT` marker embedded the same way Layer 2's does, so the shared Step 1.4 executor can act on it regardless of origin.

---

## The shared executor — "Step 1.4"

Informal name for the block in `naavi-chat/index.ts` that runs when the user's message is `YES_RE`/`NO_RE` (or, since 2026-07-14, an `awaitingField` marker is present — see Known Gaps). It finds the last assistant message, extracts the `PENDING_INTENT` marker from its `display` field, and dispatches on `pending.intent` — `LIST_RULES`, `SET_REMINDER`, `CREATE_EVENT`, `SET_ACTION_RULE`, etc. `SET_ACTION_RULE`'s branch is the one that actually calls `manage-rules` to write the row.

This is the single point where **both systems' output converges**. It doesn't matter which system produced the marker — Step 1.4 doesn't know or care. That's the useful property (one write path, one place to audit) and the dangerous one (a marker that's malformed, missing, or built from stale/wrong params breaks silently here, and the user only finds out when the alert never fires).

---

## Recipient resolution — NOT unified (real, current gap)

F12 built `resolve-recipient` as *the* shared Recipient Resolver. As of this doc, it is only actually shared for **location-trigger** alerts:

| Trigger type | Recipient resolution mechanism | Shared? |
|---|---|---|
| Location (third-party or self) | `resolve-recipient` Edge Function | Yes — one function, used by mobile (`useOrchestrator.ts`), voice (`naavi-voice-server/src/index.js`, 2 call sites), and `evaluate-rules`' fire-time re-resolution |
| Time-trigger, third-party by name | **Three separate, independent `lookup-contact` call sites**, none sharing code: (1) Layer 2's own fallthrough branch, (2) Step 1.4's `lookupWithPhone` helper (used when Claude's tool output already has a `to`/`to_name`), (3) a third intercept point (informally "T2" in code comments) that resolves Claude's own tool_use output for a time-trigger rule before the marker is embedded | No |
| Self-override, any trigger type | None needed — the user gave a literal address directly | N/A |

**Practical implication:** a third-party time-trigger recipient bug (wrong contact, contamination, disambiguation failure) could be sitting in any of the three `lookup-contact` call sites above, and a fix to one does not fix the others — this is exactly the shape of bug B9g/B9n turned out to be (fixed in the mobile-side injection that fed *into* these call sites, not in the call sites themselves). If this becomes a recurring pain point, the fix is extending `resolve-recipient` to cover time-trigger third-party resolution too, collapsing three call sites into one.

---

## Self-Override Behavioral Contract

The four self-override fields (`self_override_email` / `self_override_sms` / `self_override_whatsapp` / `self_override_voice`) redirect **one specific channel** of a self-alert to a literal address the user gave directly, while every other enabled channel still reaches the user normally. Two independent dispatchers implement the same fallback pattern — confirmed in sync as of this doc, but duplicated code, so drift is possible if one is edited without the other:

- `report-location-event/index.ts` (location-trigger fires): `selfEmailTarget = selfOverrideEmail || userEmail`, and the equivalent for sms/whatsapp/voice.
- `evaluate-rules/index.ts` (time/email/weather/contact_silence-trigger fires): same `override || userDefault` pattern per channel.

**Expected contract, any trigger type:**

| User says | Field written | Dispatcher behavior at fire time |
|---|---|---|
| "email me at X when..." | `self_override_email` | That one fire uses X for email; SMS/WhatsApp/voice/push still go to the user's own registered contact info, if those channels are enabled |
| "text me at X..." | `self_override_sms` | Same pattern, SMS channel only |
| "WhatsApp me at X..." | `self_override_whatsapp` | Same pattern, WhatsApp channel only |
| "call me at X..." | `self_override_voice` | Same pattern, voice-call channel only (location-trigger `arrive` only — time-trigger voice calls aren't gated the same way) |
| No override given | none of the four fields set | Alert fans out to every channel the user has enabled, at their own registered phone/email (see `project_naavi_alert_fanout` memory) |

**Never valid:** both a `self_override_*` field AND `to`/`to_name` populated on the same `action_config` — that's a third-party recipient and a self-override colliding, and it's the exact contamination shape of B9g/B9n. `hooks/useOrchestrator.ts`'s `SET_ACTION_RULE` handling now guards against this (`hasSelfOverride` check strips stray `to`/`to_name`), but any new write path to `action_rules` should carry the same guard — it isn't enforced at the database layer.

**If this doc goes stale:** the fastest way to re-verify is to grep both dispatchers for `self_override_` and re-diff their target-selection logic — they should be structurally identical modulo the trigger-type-specific config field names.

---

## Known gaps as of this doc (2026-07-14)

- **Recipient resolution unification** (above) — location is unified via `resolve-recipient`, time-trigger third-party is not. Not urgent unless a bug surfaces there.
- **B9i-followup class of bug** — any Layer 2 action branch that needs to ask a clarifying follow-up question is only as reliable as its own marker-based state-passing. The self-override time-trigger branch got this fix 2026-07-14 (`awaitingField` marker, see `naavi-chat/index.ts`'s `buildSelfOverrideTimeConfirm` and Step 1.4's `pendingAwaitingField` handling). Other Layer 2 branches that ask a follow-up question (e.g. the plain third-party time-trigger recipient-not-found message, `CREATE_TICKET`'s missing-body question) have **not** been audited for the same gap — if one of them turns out to silently drop a request in a long conversation, this is the mechanism to check first.
- **This doc itself** — written from a single read-through, not an exhaustive line-by-line audit of every branch. Treat it as a strong starting map, verify specifics against current code before relying on a claim for a fix.
