/**
 * Anthropic tool-use definitions for Naavi chat actions.
 *
 * Phase 2 of the V57.11.9 Structured Outputs migration. Locks every action
 * Claude can emit on the chat surfaces into a JSON-Schema-typed tool. With
 * `temperature: 0` and these tools attached, Claude's output is deterministic
 * for action shape — replacing the previous "JSON-in-prose" parsing that drove
 * the V57→V58→V59 prompt-drift cycle.
 *
 * Source of truth for the schemas: docs/STRUCTURED_OUTPUTS_SCHEMAS_DRAFT.md
 *
 * Locked Phase 1 decisions (do not relax without re-approval):
 *   A. `to` is a contact NAME string only. The orchestrator owns to_phone /
 *      to_email resolution. Tools never expose those as input fields.
 *   B. `one_shot` is optional in every variant. Per-trigger defaults
 *      (location → true, others → false) are applied in the orchestrator.
 *   C. `is_priority: boolean` is exposed on CREATE_EVENT, SET_REMINDER,
 *      REMEMBER. Forwarding wiring lands in Phase 4.
 *   D. LOG_CONCERN, UPDATE_PROFILE, SET_EMAIL_ALERT are dropped — no tools.
 *
 * Out of scope for Phase 2: 4 background extractors (extract-email-actions,
 * extract-document-text, extract-actions, ingest-note). Those migrate later.
 */

// Type alias matches the SDK's Tool shape without forcing the SDK import here.
// The shared module lives under `_shared/` and is imported by Edge Functions
// running on Deno; keeping the dependency at the call site avoids a duplicate
// SDK import on every cold-start.
export interface NaaviTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

// ── trigger_config sub-shapes for SET_ACTION_RULE ─────────────────────────────
//
// One discriminated union via `oneOf`, keyed on trigger_type which sits at the
// SET_ACTION_RULE top level (not inside trigger_config). The sub-schemas are
// strict where the doc allows; permissive only where the user can plausibly
// omit a field (e.g. weather city default Ottawa).

const TRIGGER_CONFIG_EMAIL = {
  type: 'object',
  title: 'email',
  properties: {
    from_name: { type: 'string', description: 'Sender name to match (substring).' },
    from_email: { type: 'string', description: 'Sender email to match.' },
    subject_keyword: { type: 'string', description: 'Subject substring to match.' },
  },
  additionalProperties: false,
};

const TRIGGER_CONFIG_TIME = {
  type: 'object',
  title: 'time',
  properties: {
    datetime: { type: 'string', description: 'ISO 8601 fire datetime.' },
    cron: { type: 'string', description: 'Crontab expression (alt to datetime).' },
  },
  additionalProperties: false,
};

const TRIGGER_CONFIG_CALENDAR = {
  type: 'object',
  title: 'calendar',
  properties: {
    event_match: { type: 'string', description: 'Substring matched against calendar event titles.' },
    timing: { type: 'string', enum: ['before', 'after'] },
    minutes: { type: 'integer', description: 'Offset from event start. Mirror user number exactly.' },
  },
  required: ['event_match', 'timing', 'minutes'],
  additionalProperties: false,
};

const TRIGGER_CONFIG_WEATHER = {
  type: 'object',
  title: 'weather',
  properties: {
    condition: { type: 'string', enum: ['rain', 'snow', 'temp_max_above', 'temp_min_below'] },
    threshold: { type: 'number', description: '% chance for rain/snow; °C for temp.' },
    when: { type: 'string', description: "today | tomorrow | next_3_days | this_week | YYYY-MM-DD" },
    city: { type: 'string', description: 'Default Ottawa.' },
    match: { type: 'string', enum: ['any', 'all'] },
    fire_at_hour: { type: 'integer', minimum: 0, maximum: 23 },
    fire_at_timezone: { type: 'string', description: 'IANA tz, default America/Toronto.' },
  },
  required: ['condition', 'threshold', 'when'],
  additionalProperties: false,
};

const TRIGGER_CONFIG_CONTACT_SILENCE = {
  type: 'object',
  title: 'contact_silence',
  properties: {
    from_name: { type: 'string' },
    from_email: { type: 'string' },
    days_silent: { type: 'integer', description: 'Days of silence before firing.' },
    fire_at_hour: { type: 'integer', minimum: 0, maximum: 23 },
    fire_at_timezone: { type: 'string' },
  },
  required: ['days_silent'],
  additionalProperties: false,
};

// action_config common shape — Decision A: `to` is name only; no to_phone/to_email here.
const ACTION_CONFIG = {
  type: 'object',
  properties: {
    to: { type: 'string', description: 'Contact NAME only (e.g. "wife"). Orchestrator resolves phone/email.' },
    body: { type: 'string', description: 'Message body.' },
    tasks: {
      type: 'array',
      items: { type: 'string' },
      description: 'Inline ad-hoc reminders folded into the alert body.',
    },
    list_name: {
      type: 'string',
      description: 'Name of an existing user list. Items are looked up at fire time.',
    },
  },
  required: ['body'],
  additionalProperties: false,
};

// ── Tool definitions ──────────────────────────────────────────────────────────

// ── Chain-brand enum for set_location_rule_chain ─────────────────────────────
//
// Phase 3.5 (Wael 2026-05-06) — Tim Hortons resisted prose-only persuasion in
// the unified set_action_rule even after Phase 3 moved chain rules into the
// description. Splitting the location tool and enum-constraining the brand
// removes the schema-valid path for "which one?" replies — Haiku must pick a
// canonical brand.
//
// Schema construct: TWO REQUIRED FIELDS — `chain_brand` (enum) + `place_name`
// (free string). Haiku is forced to choose a canonical brand AND can append a
// branch suffix verbatim in place_name when the user said one
// ("Costco Merivale"). The orchestrator concatenates them at conversion time:
// `${chain_brand} ${place_name_suffix}`.trim().
const CHAIN_BRANDS = [
  'Walmart',
  'Costco',
  'Tim Hortons',
  'Starbucks',
  "McDonald's",
  'Loblaws',
  'Metro',
  'Sobeys',
  'Farm Boy',
  'Canadian Tire',
  'Home Depot',
  'Rona',
  'Ikea',
  'Best Buy',
  'Shoppers Drug Mart',
  'Rexall',
  'Subway',
  "Wendy's",
  'KFC',
  'Burger King',
  'Pizza Pizza',
  'A&W',
  "Harvey's",
  'Dollarama',
  '7-Eleven',
];

export const NAAVI_TOOLS: NaaviTool[] = [
  // 1. SET_ACTION_RULE — non-location triggers only.
  // Phase 3.5: location was split into set_location_rule_chain and
  // set_location_rule_address. This tool now only handles email / time /
  // calendar / weather / contact_silence.
  {
    name: 'set_action_rule',
    description:
      'Create a trigger-action automation rule (alert me when X, do Y) for NON-LOCATION triggers.\n\n' +
      'For LOCATION alerts (arrive at / leave / dwell at a place), use one of the dedicated location tools instead — set_location_rule_chain (chain brands) or set_location_rule_address (specific addresses).\n\n' +
      'Trigger types:\n' +
      '- email: fire when an email matching from/subject arrives.\n' +
      '- time: fire at a specific datetime or cron schedule.\n' +
      '- calendar: fire before/after a calendar event matching a title keyword.\n' +
      '- weather: fire when rain/snow/temperature crosses a threshold.\n' +
      '- contact_silence: fire when a contact has not emailed for N days.',
    input_schema: {
      type: 'object',
      properties: {
        trigger_type: {
          type: 'string',
          enum: ['email', 'time', 'calendar', 'weather', 'contact_silence'],
        },
        trigger_config: {
          oneOf: [
            TRIGGER_CONFIG_EMAIL,
            TRIGGER_CONFIG_TIME,
            TRIGGER_CONFIG_CALENDAR,
            TRIGGER_CONFIG_WEATHER,
            TRIGGER_CONFIG_CONTACT_SILENCE,
          ],
        },
        action_type: { type: 'string', enum: ['sms', 'whatsapp', 'email'] },
        action_config: ACTION_CONFIG,
        label: { type: 'string', description: 'Human-readable description of the rule.' },
        one_shot: {
          type: 'boolean',
          description: 'Optional. Default false for non-location triggers. Set true for one-time rules.',
        },
      },
      required: ['trigger_type', 'trigger_config', 'action_type', 'action_config', 'label'],
      additionalProperties: false,
    },
  },

  // 1b. SET_LOCATION_RULE_CHAIN — chain-brand location alerts.
  // Phase 3.5 — schema-constrained brand. Haiku CANNOT ask "which one?" here
  // because the only schema-valid response is to call the tool with a
  // canonical brand. The orchestrator's picker handles branch disambiguation.
  {
    name: 'set_location_rule_chain',
    description:
      'Create a location-based alert for a CHAIN BRAND or franchise. Use this tool whenever the user references a chain by name — even without a specific branch ("alert me at Walmart", "remind me at Tim Hortons"). DO NOT ask "Which one?" / "Give me a street" — the orchestrator\'s picker presents nearby branches and the user chooses there. If the user already named a branch ("Costco Merivale", "Tim Hortons South Keys"), include the branch part in place_name; the picker dedupes against the cache.\n\n' +
      'Examples:\n' +
      '- "alert me at Walmart" → chain_brand="Walmart", place_name="" (or "Walmart").\n' +
      '- "remind me to buy milk at Tim Hortons" → chain_brand="Tim Hortons", place_name="".\n' +
      '- "alert me at Costco Merivale" → chain_brand="Costco", place_name="Costco Merivale".\n\n' +
      'DO NOT use this tool for personal keywords (home / office / work) — those go through set_location_rule_address with place_name=keyword.',
    input_schema: {
      type: 'object',
      properties: {
        chain_brand: {
          type: 'string',
          enum: CHAIN_BRANDS,
          description: 'Canonical brand name. REQUIRED. Pick the closest match from the enum.',
        },
        place_name: {
          type: 'string',
          description: 'Free text. If the user named a branch ("Costco Merivale"), include it verbatim. Otherwise leave empty or repeat the brand.',
        },
        direction: { type: 'string', enum: ['arrive', 'leave', 'inside'] },
        dwell_minutes: { type: 'integer', description: 'Default 2. Only for arrive/inside.' },
        expiry: { type: 'string', description: 'YYYY-MM-DD; auto-disables after.' },
        action_type: { type: 'string', enum: ['sms', 'whatsapp', 'email'] },
        action_config: ACTION_CONFIG,
        label: { type: 'string', description: 'Human-readable description of the rule.' },
        one_shot: {
          type: 'boolean',
          description: 'Optional. Default true for location triggers. Set false ONLY for explicit recurring intent ("every time", "always").',
        },
      },
      required: ['chain_brand', 'direction', 'action_type', 'action_config', 'label'],
      additionalProperties: false,
    },
  },

  // 1c. SET_LOCATION_RULE_ADDRESS — specific-address location alerts.
  // Phase 3.5 — verified-address rule lives in this tool's description.
  // Haiku must NOT call this tool with an unfamiliar address; it must
  // speak a clarification first. Personal keywords (home / office / work)
  // resolve from user_settings — call directly with place_name=keyword.
  {
    name: 'set_location_rule_address',
    description:
      'Create a location-based alert for a SPECIFIC ADDRESS, neighborhood, or non-chain place.\n\n' +
      'ONLY call this tool when the address is already in the user\'s memory from a prior conversation, OR has been confirmed by the user in THIS conversation after readback. If the address is unfamiliar and unconfirmed, do NOT call this tool — speak a clarification question instead. The orchestrator caps clarification at 3 attempts with "please check the exact location and call me back."\n\n' +
      'Personal keywords ("home", "my home", "the house", "office", "work", "my office") are NEVER ambiguous — they map to the user\'s saved Settings address. CALL IMMEDIATELY with place_name="home" or place_name="office" — DO NOT ask "which home?" / "which office?".\n\n' +
      'For chain brands (Walmart, Costco, Tim Hortons, Starbucks, etc.) use set_location_rule_chain instead — NOT this tool.\n\n' +
      'Examples:\n' +
      '- "alert me at 123 Maple St" with that address in memory → CALL with place_name="123 Maple St".\n' +
      '- "alert me at 123 Maple St" with that address NOT in memory → do NOT call; ask the user to confirm the address first.\n' +
      '- "alert me when I arrive home" → CALL with place_name="home".\n' +
      '- "alert me at the cottage this weekend" with cottage in memory → CALL with place_name="the cottage", expiry=next Monday.\n' +
      '- "alert me at Joe\'s place" with no prior context → do NOT call; ask "where is Joe\'s place?".',
    input_schema: {
      type: 'object',
      properties: {
        place_name: {
          type: 'string',
          description: 'Address, neighborhood, personal keyword (home/office), or named place from memory. Free text.',
        },
        direction: { type: 'string', enum: ['arrive', 'leave', 'inside'] },
        dwell_minutes: { type: 'integer', description: 'Default 2. Only for arrive/inside.' },
        expiry: { type: 'string', description: 'YYYY-MM-DD; auto-disables after.' },
        action_type: { type: 'string', enum: ['sms', 'whatsapp', 'email'] },
        action_config: ACTION_CONFIG,
        label: { type: 'string', description: 'Human-readable description of the rule.' },
        one_shot: {
          type: 'boolean',
          description: 'Optional. Default true for location triggers. Set false ONLY for explicit recurring intent.',
        },
      },
      required: ['place_name', 'direction', 'action_type', 'action_config', 'label'],
      additionalProperties: false,
    },
  },

  // 2. LIST_RULES
  {
    name: 'list_rules',
    description: "List the user's existing alerts/automation rules. Optional match filters by substring across label / trigger / action.",
    input_schema: {
      type: 'object',
      properties: {
        match: { type: 'string', description: 'Optional substring filter.' },
      },
      additionalProperties: false,
    },
  },

  // 3. DELETE_RULE
  {
    name: 'delete_rule',
    description: "Delete one or more rules by match phrase. Set all=true for 'every' / 'all my' phrasings (bypasses disambiguation).",
    input_schema: {
      type: 'object',
      properties: {
        match: { type: 'string', description: 'Match phrase. Empty allowed when all=true.' },
        all: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },

  // 4. CREATE_EVENT
  {
    name: 'create_event',
    description:
      'Add a Google Calendar event. Default to TIMED format (full ISO 8601 datetime). Date-only YYYY-MM-DD only for birthdays / anniversaries / expiry dates.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Event title.' },
        description: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601 datetime OR YYYY-MM-DD (all-day).' },
        end: { type: 'string', description: 'ISO 8601 datetime OR YYYY-MM-DD (all-day = next day).' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Emails. Only when user EXPLICITLY asks to invite.',
        },
        recurrence: {
          type: 'array',
          items: { type: 'string' },
          description: 'RRULE strings.',
        },
        is_priority: { type: 'boolean', description: 'Set true when user says important/critical/urgent/must.' },
      },
      required: ['summary', 'start', 'end'],
      additionalProperties: false,
    },
  },

  // 5. DELETE_EVENT
  {
    name: 'delete_event',
    description: 'Delete a Google Calendar event matching the query string.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Event title or keyword.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },

  // 6. SET_REMINDER
  {
    name: 'set_reminder',
    description: 'One-time reminder. Auto-creates a calendar event AND a push notification at the time.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        datetime: { type: 'string', description: 'ISO 8601, must be future.' },
        source: { type: 'string', description: 'Channel name (app/voice).' },
        phoneNumber: { type: 'string', description: "Default user's phone." },
        is_priority: { type: 'boolean' },
      },
      required: ['title', 'datetime'],
      additionalProperties: false,
    },
  },

  // 7. SCHEDULE_MEDICATION
  {
    name: 'schedule_medication',
    description: 'Expand a medication schedule into per-dose calendar events. Defaults: times=[08:00,20:00], on_days=5, off_days=3, duration=30.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Medication name.' },
        dose_instruction: { type: 'string', description: 'e.g. "Take with food".' },
        times: {
          type: 'array',
          items: { type: 'string', description: 'HH:MM 24h.' },
        },
        on_days: { type: 'integer' },
        off_days: { type: 'integer', description: 'Set 0 for continuous daily.' },
        start_date: { type: 'string', description: 'YYYY-MM-DD.' },
        duration_days: { type: 'integer' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },

  // 8. DRAFT_MESSAGE
  {
    name: 'draft_message',
    description: 'Draft a message for confirm-then-send. Subject is required for email channel only.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Contact NAME only. Orchestrator resolves email/phone.' },
        subject: { type: 'string', description: 'Required when channel=email.' },
        body: { type: 'string' },
        channel: { type: 'string', enum: ['email', 'sms', 'whatsapp'] },
      },
      required: ['to', 'body', 'channel'],
      additionalProperties: false,
    },
  },

  // 9. REMEMBER
  {
    name: 'remember',
    description: 'Save a personal fact or preference to user memory. Emit at most ONCE per turn for the same fact.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Fragment to remember.' },
        is_priority: { type: 'boolean' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },

  // 10. DELETE_MEMORY
  {
    name: 'delete_memory',
    description: 'Remove memory fragments matching a keyword.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Substring match on fragment content.' },
      },
      required: ['keyword'],
      additionalProperties: false,
    },
  },

  // 11. ADD_CONTACT
  {
    name: 'add_contact',
    description: 'Save a contact. At least one of email or phone must be present.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        relationship: { type: 'string', description: 'Freeform e.g. wife / son.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },

  // 12. LIST_CREATE
  {
    name: 'list_create',
    description: 'Create a new list. Categories: shopping, health, tasks, personal, other.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        category: { type: 'string', enum: ['shopping', 'health', 'tasks', 'personal', 'other'] },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },

  // 13. LIST_ADD
  {
    name: 'list_add',
    description: 'Add one or more items to an existing list.',
    input_schema: {
      type: 'object',
      properties: {
        listName: { type: 'string' },
        items: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
      required: ['listName', 'items'],
      additionalProperties: false,
    },
  },

  // 14. LIST_REMOVE
  {
    name: 'list_remove',
    description: 'Remove items from an existing list.',
    input_schema: {
      type: 'object',
      properties: {
        listName: { type: 'string' },
        items: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
      required: ['listName', 'items'],
      additionalProperties: false,
    },
  },

  // 15. LIST_READ
  {
    name: 'list_read',
    description: 'Read items from an existing list aloud.',
    input_schema: {
      type: 'object',
      properties: {
        listName: { type: 'string' },
      },
      required: ['listName'],
      additionalProperties: false,
    },
  },

  // 16-19. F1a — Lists wired to events (Wael 2026-05-11). Tools for the
  // connection-CRUD layer on top of the existing list_create/add/remove/read.
  // The orchestrator translates these tool calls into manage-list-connections
  // Edge Function POSTs. Spec: docs/F1A_LISTS_AND_CONNECTIONS_SPEC.md.
  {
    name: 'list_connect',
    description:
      'Wire a list to an entity (alert, calendar event, email, contact, document, reminder, sent message, knowledge fragment, or other list). Each entity can have at MOST one list at a time — calling this on an entity that already has a list REPLACES the prior connection. Use when the user says "connect/attach/wire/link/use/put/hook/tie/add my X list to my Y."',
    input_schema: {
      type: 'object',
      properties: {
        listName: { type: 'string', description: 'The list name as the user refers to it (e.g., "groceries", "errands").' },
        entityRef: { type: 'string', description: 'The user\'s natural-language reference to the entity (e.g., "Costco alert", "Tuesday meeting", "Bob\'s email"). Orchestrator resolves it.' },
        entityType: {
          type: 'string',
          enum: ['action_rule', 'calendar_event', 'gmail_message', 'contact', 'document', 'reminder', 'sent_message', 'knowledge_fragment', 'list'],
          description: 'Optional explicit type if the user named it (e.g., "my Costco ALERT" → action_rule). Narrows entity resolution.',
        },
      },
      required: ['listName', 'entityRef'],
      additionalProperties: false,
    },
  },

  {
    name: 'list_disconnect',
    description:
      'Remove the list connection from an entity. The list itself stays intact; only the wiring is severed. Use when the user says "disconnect/detach/unlink/unwire/take off/remove my X list from my Y."',
    input_schema: {
      type: 'object',
      properties: {
        entityRef: { type: 'string', description: 'The user\'s reference to the entity.' },
        entityType: {
          type: 'string',
          enum: ['action_rule', 'calendar_event', 'gmail_message', 'contact', 'document', 'reminder', 'sent_message', 'knowledge_fragment', 'list'],
        },
      },
      required: ['entityRef'],
      additionalProperties: false,
    },
  },

  {
    name: 'list_connection_query',
    description:
      'Answer a connection question. Two modes: "where_is_list" answers "where is my X list connected?" / "which alerts use my X list?" — list every entity wired to a given list. "what_list_is_on" answers "what list is on my Y?" / "what\'s connected to my Y?" — return the single list (if any) wired to a given entity.',
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['where_is_list', 'what_list_is_on'] },
        listName: { type: 'string', description: 'Required when mode=where_is_list.' },
        entityRef: { type: 'string', description: 'Required when mode=what_list_is_on.' },
        entityType: {
          type: 'string',
          enum: ['action_rule', 'calendar_event', 'gmail_message', 'contact', 'document', 'reminder', 'sent_message', 'knowledge_fragment', 'list'],
        },
      },
      required: ['mode'],
      additionalProperties: false,
    },
  },

  {
    name: 'list_delete',
    description:
      'Delete a list entirely. Per spec, the user is warned FIRST (in the assistant turn before this tool call) listing every entity the list is connected to. After explicit user confirmation, this tool call drops the list row and all its connections cascade. Use when the user says "delete/remove my X list" AND has confirmed after the warning.',
    input_schema: {
      type: 'object',
      properties: {
        listName: { type: 'string' },
      },
      required: ['listName'],
      additionalProperties: false,
    },
  },

  // 20. SAVE_TO_DRIVE
  {
    name: 'save_to_drive',
    description: 'Save a text note to MyNaavi/Notes/. Do NOT use for "record this conversation" phrasings.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
  },

  // 17. DRIVE_SEARCH
  {
    name: 'drive_search',
    description: "Search the user's Drive (MyNaavi tree).",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },

  // 18. GLOBAL_SEARCH
  {
    name: 'global_search',
    description:
      "Search across all of user's stored data (knowledge, rules, contacts, lists, calendar, gmail, drive, reminders). " +
      "When the user explicitly names a source ('do I have a CONTACT named …', 'any EMAIL about …', 'on my CALENDAR …', etc.), set source_hint to that source so results are restricted to it. Omit source_hint for open-ended asks ('what do we know about …').",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        // Wael 2026-05-22 — when the user names a source, force the
        // server-side adapter filter to that source. The query-string
        // regex in global-search/index.ts can't see what Claude stripped
        // out, so a typed hint is the reliable channel.
        source_hint: {
          type: 'string',
          // Wael 2026-05-22 — "lists" removed: list operations have
          // dedicated list_read/list_create/list_add/list_remove tools,
          // and including "lists" in this enum confused Claude into
          // picking global_search over list_read for "what is on my
          // shopping list" (regressed lists.read test). Drive kept
          // because drive_search is narrower and global_search with
          // source_hint=drive remains valid for cross-source asks.
          enum: ['gmail', 'calendar', 'contacts', 'drive', 'notes', 'reminders'],
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },

  // 19. FETCH_TRAVEL_TIME
  {
    name: 'fetch_travel_time',
    description: 'Compute travel time and leave-by time. Provide eventStartISO when departure must be tied to a meeting.',
    input_schema: {
      type: 'object',
      properties: {
        destination: { type: 'string' },
        eventStartISO: { type: 'string' },
        departureISO: { type: 'string' },
      },
      required: ['destination'],
      additionalProperties: false,
    },
  },

  // 20. SPEND_SUMMARY
  {
    name: 'spend_summary',
    description: 'Sum vendor invoices over a period and return one number per currency.',
    input_schema: {
      type: 'object',
      properties: {
        vendor: { type: 'string' },
        period_label: {
          type: 'string',
          enum: [
            'last month',
            'this month',
            'last year',
            'this year',
            'today',
            'yesterday',
            'past week',
            'all time',
          ],
        },
      },
      required: ['vendor', 'period_label'],
      additionalProperties: false,
    },
  },

  // 21. UPDATE_MORNING_CALL
  {
    name: 'update_morning_call',
    description: 'Set / change / disable the daily briefing call. Provide time (HH:MM 24h) and/or enabled.',
    input_schema: {
      type: 'object',
      properties: {
        time: { type: 'string', pattern: '^[0-2][0-9]:[0-5][0-9]$' },
        enabled: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },

  // 22. START_CALL_RECORDING
  {
    name: 'start_call_recording',
    description: 'Start audio recording the current Twilio call. Voice channel only. No parameters.',
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

/**
 * Tool name (lowercase snake_case) → action type (UPPER_SNAKE) used by the
 * orchestrator. Keep both columns in sync with NAAVI_TOOLS above.
 *
 * The orchestrator dispatches on `action.type` (UPPER_SNAKE). When converting
 * a tool_use block back into the legacy action shape, naavi-chat does:
 *   { type: TOOL_NAME_TO_ACTION_TYPE[block.name], ...block.input }
 */
export const TOOL_NAME_TO_ACTION_TYPE: Record<string, string> = {
  set_action_rule: 'SET_ACTION_RULE',
  // Phase 3.5 — both location tools collapse to SET_ACTION_RULE downstream.
  // The orchestrator dispatches on `action.type`; the converter in naavi-chat
  // also rewrites the flat tool input into the SET_ACTION_RULE shape with
  // trigger_type='location' and trigger_config={...}.
  set_location_rule_chain: 'SET_ACTION_RULE',
  set_location_rule_address: 'SET_ACTION_RULE',
  list_rules: 'LIST_RULES',
  delete_rule: 'DELETE_RULE',
  create_event: 'CREATE_EVENT',
  delete_event: 'DELETE_EVENT',
  set_reminder: 'SET_REMINDER',
  schedule_medication: 'SCHEDULE_MEDICATION',
  draft_message: 'DRAFT_MESSAGE',
  remember: 'REMEMBER',
  delete_memory: 'DELETE_MEMORY',
  add_contact: 'ADD_CONTACT',
  list_create: 'LIST_CREATE',
  list_add: 'LIST_ADD',
  list_remove: 'LIST_REMOVE',
  list_read: 'LIST_READ',
  // F1a (Wael 2026-05-11) — connection-CRUD on top of the list-item CRUD above.
  list_connect: 'LIST_CONNECT',
  list_disconnect: 'LIST_DISCONNECT',
  list_connection_query: 'LIST_CONNECTION_QUERY',
  list_delete: 'LIST_DELETE',
  save_to_drive: 'SAVE_TO_DRIVE',
  drive_search: 'DRIVE_SEARCH',
  global_search: 'GLOBAL_SEARCH',
  fetch_travel_time: 'FETCH_TRAVEL_TIME',
  spend_summary: 'SPEND_SUMMARY',
  update_morning_call: 'UPDATE_MORNING_CALL',
  start_call_recording: 'START_CALL_RECORDING',
};
