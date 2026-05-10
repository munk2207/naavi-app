# F1a — Lists wired to events (product spec)

**Author:** Wael (decisions) + collaborator (drafting)
**Status:** Spec locked 2026-05-09. Ready for engineering planning.
**Source:** Walked through with Wael 2026-05-09 in continuation of the holding-list classification session.

---

## Concept

Three independent entities, with one relationship type between them:

- **Alert** — an active thing. Triggers something based on a condition (time, location, calendar, email, SMS, WhatsApp, etc.). Created by geofencing, REMEMBER, voice, or direct UI. Already exists in `action_rules`.
- **List** — a passive container of items. Independent first-class entity. Already exists in `lists`. The user names it ("groceries", "errands", "questions for Mom") and adds items at any time.
- **Other entities Naavi knows about** — calendar events, emails, contacts, documents, reminders, sent messages, knowledge fragments, and lists themselves.

A **connection** wires a list to any entity. The list provides context for the entity:

- When an alert fires, Naavi can read items from the connected list aloud.
- When a calendar event arrives, Naavi can surface the connected list as the meeting's notes.
- When an email arrives, the connected list shows the user's planned response/follow-up items.

The list itself does nothing on its own — it's just the content. The entity does the triggering.

---

## Cardinality

**One list ↔ many entities. Each entity ↔ at most one list.**

- A single "groceries" list can be connected to your Costco arrival alert AND your Saturday calendar event AND a reminder to text Sarah.
- A single alert/event can have at most one list at a time.
- If the user wants two lists' worth of items at one event, they create a third combined list.

**Why not many-to-many?** The user can always combine. Many-to-many would force Naavi to make editorial decisions at fire time (which list first? merged or separate?) and complicate every voice query. The simpler model gives the user full control.

---

## Voice command vocabulary

Naavi recognizes natural-language synonyms — the user is never required to memorize a verb.

**Connect (any of):** *"Connect / attach / wire / link / use / put / hook / tie / add my X list to my Y."*

**Disconnect (any of):** *"Disconnect / detach / unlink / unwire / take off / remove my X list from my Y."*

**Query — connections:** *"Where is my X list connected / used / attached?"*, *"Which alerts / events use my X list?"*, *"What list is on my Y?"*, *"What's connected to my Y?"*

**Query — list contents:** *"Read me the items on my X list."* (existing list-read flow)

**Disambiguation:**
- "Add" is shared between list-item operations and connection operations. Naavi disambiguates from context — *"add milk to groceries"* (item) vs *"add my groceries list to Costco alert"* (connection).
- "Remove" is shared between list-item removal, connection removal, and list deletion. Same context-based disambiguation.

**Auto-create on missing:** when the user says *"connect my groceries list to my Costco alert"* and no "groceries" list exists, Naavi asks: *"You don't have a groceries list — should I create one?"* Doesn't silently create.

---

## Confirmation flow

**Every CRUD operation on lists or connections is confirmed before execution. No silent commits.**

Standardized confirmation phrase across ALL confirmable actions (DRAFT_MESSAGE, list ops, default fallback):

> *"Say yes to confirm, no to cancel, or tell me what to change."*

The user replies with:
- **yes / send / go ahead / ok / sure** → confirm and execute
- **no / cancel / never mind / forget it** → cancel, no action taken
- **anything else** (e.g. *"change the destination to my Saturday alert"*) → free-form edit instruction; Naavi re-drafts and re-asks

Examples:

- *"Connect groceries to Costco alert"* → Naavi: *"I'll connect your groceries list to your Costco arrival alert. Say yes to confirm, no to cancel, or tell me what to change."* → user: *"Yes."* → Naavi: *"Connected."*

- *"Add milk to groceries"* → Naavi: *"I'll add milk to your groceries list. Say yes to confirm, no to cancel, or tell me what to change."* → user: *"Yes."* → Naavi: *"Added."*

- *"Delete groceries list"* → Naavi: *"Your groceries list is connected to your Costco alert and Saturday meeting. I'll delete the list and remove both connections. Say yes to confirm, no to cancel, or tell me what to change."* → user: *"Yes."* → Naavi: *"Deleted."*

This applies to confirmable actions across the system. The existing `voice-confirm` framework already has the three-mode classifier (confirm / cancel / edit); the standardization is in the spoken prompts only.

---

## Entity reference resolution

When the user says *"my Costco alert"* or *"my Tuesday meeting"* or *"Bob's email"*, Naavi searches across all entity types to find a match.

- **Single match** → confirm-and-execute via the standard confirmation flow.
- **Multiple matches** → Naavi asks for clarification: *"I see two Costcos: your Costco arrival alert and Saturday's calendar event. Which one do you mean?"* — numbered list per CLAUDE.md Rule 13.
- **No match** → *"I don't have anything called Costco. Did you mean…?"*

User can also be explicit (*"my Costco alert"*) which narrows the search to one entity type.

---

## Cascade behavior

**When an entity is deleted (e.g., user deletes a Costco alert):**
- The connection between that entity and its list is removed silently.
- The list itself stays intact and remains connected to any other entities.
- The list shows up in the Lists view as a standalone list (or still wired elsewhere if applicable).

**When a list is deleted:**
- Naavi warns first, listing every entity the list is connected to.
- The user explicitly confirms.
- After confirmation: list and all its connections are removed. Each entity stays intact (just without its list).

The asymmetry is intentional: deleting an entity is a single-wire severing; deleting a list is a multi-wire destructive action that the user should see the full impact of first.

---

## Migration plan (one-time, at F1a deploy)

Existing alerts today carry list context two ways:

1. `tasks[]` array — inline items set at alert creation time.
2. `list_name` — a string referencing a shared list by name.

At F1a deploy time, a one-shot migration converts all existing alerts to the new model:

- `tasks[]` → create a new List named after the alert (e.g., alert "Costco arrival" → list "Costco arrival"). Add the alert's items to the list. Create a connection row from the new list to the alert.
- `list_name` → resolve to the existing list by name. Create a connection row from that list to the alert.
- After all alerts are migrated, the `tasks[]` and `list_name` columns are dropped from the schema.
- Duplicate list names (if migrating two alerts both named "Costco") → append " (1)", " (2)" to disambiguate.

After migration, every alert uses the new model uniformly. The user immediately benefits from the new query capability ("where is my Costco list connected?") for ALL their alerts.

---

## Mobile UI

### New top-level entry in the 3-dots menu

Today the menu has Alerts and Notes (each with subcategories). F1a adds **Lists** as a sibling, with subcategories:

- **All lists** (default) — every list with item count + connection count.
- **Connected** — only lists currently wired to alerts/events.
- **Standalone** — lists not wired anywhere (drafts, archived, recently disconnected).

Lists is a first-class top-level concept, separate from Notes.

### Alert detail card

When viewing the Costco alert:

- Below the alert title and trigger info: *"List: errands (5 items)"* with a chevron tap target.
- Tap → opens the connected list in the existing list-detail view (same edit surface as standalone lists).
- **Explicit delete-connection control** — an "X" or trash icon next to the list line. Tap prompts: *"Disconnect 'errands' from this alert? Say yes to confirm, no to cancel, or tell me what to change."* — removes the connection only, list itself stays.

### List detail (in the new Lists section)

When viewing the errands list:

- At the top: *"Connected to: Costco alert · Saturday meeting"* — each is tap-to-navigate to that entity's detail.
- If the list has many connections, collapse: *"Connected to 7 events — tap to see all."*
- Below: the list items themselves, with the existing edit affordances (add, remove, reorder).

### List operations from voice

All voice commands (connect, disconnect, add item, remove item, delete list, query connections) work identically on PC (phone calls) and MV (mobile chat).

---

## Engineering scope

Roughly 1.5–2 focused sessions to ship.

**Server-side (no AAB needed):**

1. SQL migration: `list_connections` table + indexes + RLS policies.
2. One-shot data migration: convert existing `tasks[]` and `list_name` references into the new model. Drop the old columns.
3. New Edge Function `manage-list-connections` (or extend `manage-list`) with CRUD operations: connect, disconnect, query-connections.
4. New Anthropic tool definitions in `_shared/anthropic_tools.ts` for the connection operations.
5. Voice + mobile prompt rules in `get-naavi-prompt`: how to recognize the natural-language phrasings, the auto-create-on-missing flow, the disambiguation behavior, and the standardized three-option confirmation phrase.
6. Update `lib/voice-confirm.ts` SPEECH constants to use the new three-option phrase across all confirmable actions.

**Mobile (AAB required):**

7. New Lists screen in the 3-dots menu (with the three subcategories).
8. List-detail screen showing connections + item editing.
9. Alert-detail card update: connected-list line + delete-connection control.

**Testing:**

10. Auto-tester additions per Rule 15:
    - Prompt-regression tests for new voice command patterns.
    - Data-integrity tests for the UNIQUE constraint on `(entity_type, entity_id)`.
    - Multi-user matrix tests for cross-tenant isolation.

---

## Future considerations (not in F1a v1)

- **Many-to-many cardinality.** If usage shows users genuinely need two parallel lists per entity (and combining feels wrong), reconsider. Schema migration is cheap if the UNIQUE is dropped.
- **Per-event filtering of a shared list.** If users want the same list to show different items per context (e.g., "groceries for Costco" vs "groceries for the corner store" using the same backing list), that's a tags-on-items + filter-at-fire-time enhancement.
- **Cross-user shared lists.** All lists are currently per-user. Sharing across users (e.g., a household "groceries" list shared between two MyNaavi users) is out of scope.
- **List templates.** Pre-built list templates ("travel checklist", "doctor visit prep") that users can instantiate. Out of scope.

---

## Open work

None at the spec level. Spec is locked.

Build can begin in a future focused session. The engineering scope section above is the launch checklist.
