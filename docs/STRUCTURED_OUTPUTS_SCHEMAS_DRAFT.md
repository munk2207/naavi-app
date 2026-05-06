# Structured Outputs Schemas Draft — V57.11.9 Phase 1

Phase 1 deliverable: enumerate every Naavi action shape so Phase 2 can convert them into Anthropic tool-use schemas. **No code edits** were made for this document. Sources of truth, in priority order:

1. `hooks/useOrchestrator.ts` (mobile chat dispatcher, lines 1322–2186)
2. `naavi-voice-server/src/index.js` (voice surface dispatcher — UPDATE_MORNING_CALL ~2204, START_CALL_RECORDING ~5469)
3. `supabase/functions/get-naavi-prompt/index.ts` (Claude prompt — documented shapes per RULE)
4. `tests/catalogue/prompt-regression.ts` and `tests/catalogue/chat.ts` (locked-in invariants)

---

## Decisions Locked 2026-05-06 (Wael approved)

**A. Contact handling (resolves ambiguities #1 and #2).**
Claude is restricted to writing the contact NAME only (`to: "wife"`). The schema must REJECT `to_phone` / `to_email` from Claude in `SET_ACTION_RULE.action_config` and from `DRAFT_MESSAGE.to`. The orchestrator owns contact resolution as the single path. Phase 2 implication: schemas constrain `to` to a string; the handler then writes `to_name`, `to_phone`, `to_email` server-side.

**B. one_shot default (resolves ambiguity #4).**
Keep the existing per-type defaults — location triggers default to `one_shot: true`, all other trigger types default to `one_shot: false`. Schema marks `one_shot` as optional with the per-variant default applied at handler level (current behavior).

**C. is_priority wired on mobile (resolves ambiguity #5).**
Include `is_priority: boolean` (optional) in CREATE_EVENT, SET_REMINDER, REMEMBER schemas AND extend `useOrchestrator.ts` to forward the flag to the downstream Edge Functions (which already accept it). Phase 2 must add the forwarding code; otherwise the schema field is meaningless on mobile.

**D. Prune dead actions (resolves ambiguity #3 and the LOG_CONCERN/UPDATE_PROFILE note).**
Remove `LOG_CONCERN`, `UPDATE_PROFILE`, and `SET_EMAIL_ALERT` from the orchestrator handlers and do NOT add them to the structured-outputs tool list. SET_EMAIL_ALERT is superseded by `SET_ACTION_RULE` with `trigger_type='email'`. The other two are residue from older sessions with no live emit path. Phase 2 deletes the corresponding handler branches in `useOrchestrator.ts:1862-1866`.

**Net effect on form count:** 26 → 23 (drop 3 dead actions).

---

## Summary

- **26 action types covered** (22 Group A chat actions + 4 Group B background extractors).
- **Total fields counted across all 26 forms: ~165** (counted unique JSON property names in the union of prompt-documented + handler-read fields; SET_ACTION_RULE counted once with 6 trigger-config sub-shapes).
- **Fields with open questions: 17** (flagged inline; key tension is whitelist enforcement and required-vs-optional defaults).

### Top 5 ambiguities blocking Phase 2

1. **`SET_ACTION_RULE.action_config.to`** — when contact name is given (`to: "wife"`), is the `to_phone` / `to_email` filled in by Claude or always resolved by the orchestrator? Today the prompt says "Contact resolution happens automatically" (line 700) and the orchestrator does fill it (lines 1916–1931), but the input schema needs to make `to` exclusive-or `to_phone`/`to_email`. Should the schema ALLOW Claude to populate to_phone/to_email itself, or force only `to` so the orchestrator owns resolution?

2. **`DRAFT_MESSAGE.to`** — same question: a freeform name that the orchestrator resolves to phone/email, or a raw email/phone string. The orchestrator currently accepts both (line 2333: `String(action.to ?? '').trim()` then branches on `@` vs phone regex vs contact lookup). The Phase 2 schema needs to decide whether `to` is `string` or a discriminated union `{name?:string, email?:string, phone?:string}`.

3. **`SET_ACTION_RULE` shape mismatch** — prompt documents `SET_ACTION_RULE` (RULE 15) AND a separate `SET_EMAIL_ALERT` (RULE 14) for the email trigger case, while the orchestrator handles BOTH and inserts both into `action_rules`. They duplicate — should Phase 2 collapse SET_EMAIL_ALERT into SET_ACTION_RULE-with-trigger=email, or keep both? (The handler already routes `SET_EMAIL_ALERT` differently — line 1866.)

4. **`one_shot` default** — varies by trigger_type. Location triggers default to `true` (orchestrator line 2011); non-location SET_ACTION_RULE defaults to `false` (line 2177). Schema needs per-trigger-variant defaults, or should we make `one_shot` always required so Claude must commit?

5. **`is_priority` propagation gap** — the prompt (RULE 16, line 748) instructs Claude to add `is_priority: true` to CREATE_EVENT, SET_REMINDER, REMEMBER. The DOWNSTREAM Edge Functions accept it (`create-calendar-event/index.ts:49`, `check-reminders/index.ts:25`) but `useOrchestrator.ts` never reads or forwards it (zero matches in grep). The mobile path silently drops `is_priority` for REMEMBER and CREATE_EVENT. Phase 2 must decide: include in schema and add forwarding, OR remove from prompt.

### Other ambiguities (not top-5 but flagged inline below)

- DELETE_RULE.match — empty string allowed only when `all=true`?
- REMEMBER.text vs `note` aliases — extracted handler accepts only `text` but does any caller pass `note`?
- LIST_ADD/LIST_REMOVE empty-array semantics
- SCHEDULE_MEDICATION default times when `times` omitted (handler: `['08:00','20:00']`)
- ADD_CONTACT.relationship — freeform vs enum
- LIST_CREATE.category enum — strict or loose?
- GLOBAL_SEARCH.query — minimum length / token rules
- FETCH_TRAVEL_TIME.eventStartISO — required when "navigate to next meeting"?
- SPEND_SUMMARY.period_label — strict whitelist enforced where?
- DELETE_MEMORY backward-compat field `query` (handler reads `keyword ?? query` line 1657)
- DRAFT_MESSAGE.channel default "email" when omitted (orchestrator line 2332)
- LOG_CONCERN / UPDATE_PROFILE / SET_EMAIL_ALERT — UNDOCUMENTED in prompt but handled by orchestrator (lines 1862, 1864, 1866). Should they be in the schema or pruned from the handler?

---

# Group A — Mobile Chat Actions (22)

---

### 1. SET_ACTION_RULE

**Purpose** Create a trigger-action automation rule (alert me when X happens, do Y).
**Triggered by** mobile chat / voice chat (both surfaces emit; orchestrator + voice-server both handle).
**Handler location** `hooks/useOrchestrator.ts:1911-2186` (location intercept at 1938-2166); `naavi-voice-server/src/index.js` parallel handler.

**Top-level fields:**
| field | type | required | notes |
|---|---|---|---|
| type | string `"SET_ACTION_RULE"` | yes | discriminator |
| trigger_type | enum 6 values | yes | `email \| time \| calendar \| weather \| contact_silence \| location` — selects sub-shape |
| trigger_config | object | yes | shape varies by trigger_type (see below) |
| action_type | enum | yes | `sms \| whatsapp \| email` (default `sms` per orchestrator line 1918) |
| action_config | object | yes | see common shape below |
| label | string | yes | human description; orchestrator falls back to `'Action rule'` |
| one_shot | boolean | optional | default `false` (line 2177); EXCEPT location → default `true` (line 2011) |
| is_priority | boolean | optional | DOCUMENTED in prompt RULE 16 but NOT forwarded by orchestrator (gap) |

**`action_config` common shape:**
| field | type | required | notes |
|---|---|---|---|
| to | string | optional | contact name (e.g. "wife"). Orchestrator resolves to phone/email at lines 1916-1931 |
| to_name | string | optional | written by orchestrator after contact resolution |
| to_phone | string | conditionally required | required when action_type=sms\|whatsapp; can be empty if `to` provided |
| to_email | string | conditionally required | required when action_type=email; can be empty if `to` provided |
| body | string | yes | message body |
| tasks | string[] | optional | inline ad-hoc task list (project_naavi_alert_context_fields.md) |
| list_name | string | optional | name of user's list to inject items at fire time |

**`trigger_config` sub-shapes:**

#### 1a. trigger_type = "email"
| field | type | required | notes |
|---|---|---|---|
| from_name | string | optional | at-least-one-of: from_name, from_email, subject_keyword |
| from_email | string | optional | |
| subject_keyword | string | optional | |

#### 1b. trigger_type = "time"
| field | type | required | notes |
|---|---|---|---|
| datetime | ISO 8601 | yes | OR `cron` per orchestrator describe() at line 1725 (handler reads either — backward-compat) |
| cron | string | optional | crontab string — accepted by LIST_RULES describe() but NOT explicitly documented in prompt for SET_ACTION_RULE — OPEN QUESTION |

#### 1c. trigger_type = "calendar"
| field | type | required | notes |
|---|---|---|---|
| event_match | string | yes | substring match against event titles |
| timing | enum | yes | `before \| after` |
| minutes | integer | yes | offset minutes; user's stated number must mirror exactly (NUMBER MIRRORING rule, line 722) |

#### 1d. trigger_type = "weather"
| field | type | required | notes |
|---|---|---|---|
| condition | enum | yes | `rain \| snow \| temp_max_above \| temp_min_below` |
| threshold | number | yes | percent (rain/snow) or °C (temp) |
| when | enum | yes | `today \| tomorrow \| next_3_days \| this_week \| <YYYY-MM-DD>` |
| city | string | optional | default `Ottawa` |
| match | enum | optional | `any` (default) \| `all` |
| fire_at_hour | integer 0–23 | optional | default 7 |
| fire_at_timezone | IANA tz | optional | default `America/Toronto` |

#### 1e. trigger_type = "contact_silence"
| field | type | required | notes |
|---|---|---|---|
| from_name | string | optional | at-least-one-of: from_name, from_email |
| from_email | string | optional | |
| days_silent | integer | yes | NUMBER MIRRORING rule applies |
| fire_at_hour | integer 0–23 | optional | default 7 |
| fire_at_timezone | IANA tz | optional | default `America/Toronto` |

#### 1f. trigger_type = "location"
| field | type | required | notes |
|---|---|---|---|
| place_name | string | yes | bare brand allowed (chain-store rule); personal keywords `home`/`office` mapped server-side |
| direction | enum | optional | `arrive` (default) \| `leave` \| `inside` |
| dwell_minutes | integer | optional | default 2; ignored for `leave` |
| expiry | YYYY-MM-DD | optional | rule auto-disables after this date |
| resolved_lat | number | system-set | written by orchestrator after resolve-place (lines 1998-2003) |
| resolved_lng | number | system-set | same |
| radius_meters | integer | system-set | default 150 if not provided |

**Anthropic tool definition (draft):**
```json
{
  "name": "set_action_rule",
  "description": "Create a trigger-action automation rule. Six trigger variants (email, time, calendar, weather, contact_silence, location) each carry a different trigger_config shape. The handler verifies addresses for location rules.",
  "input_schema": {
    "type": "object",
    "properties": {
      "trigger_type": { "type": "string", "enum": ["email","time","calendar","weather","contact_silence","location"] },
      "trigger_config": {
        "oneOf": [
          { "title": "email",            "type": "object", "properties": { "from_name":{"type":"string"}, "from_email":{"type":"string"}, "subject_keyword":{"type":"string"} } },
          { "title": "time",             "type": "object", "properties": { "datetime":{"type":"string"}, "cron":{"type":"string"} } },
          { "title": "calendar",         "type": "object", "properties": { "event_match":{"type":"string"}, "timing":{"type":"string","enum":["before","after"]}, "minutes":{"type":"integer"} }, "required":["event_match","timing","minutes"] },
          { "title": "weather",          "type": "object", "properties": { "condition":{"type":"string","enum":["rain","snow","temp_max_above","temp_min_below"]}, "threshold":{"type":"number"}, "when":{"type":"string"}, "city":{"type":"string"}, "match":{"type":"string","enum":["any","all"]}, "fire_at_hour":{"type":"integer","minimum":0,"maximum":23}, "fire_at_timezone":{"type":"string"} }, "required":["condition","threshold","when"] },
          { "title": "contact_silence",  "type": "object", "properties": { "from_name":{"type":"string"}, "from_email":{"type":"string"}, "days_silent":{"type":"integer"}, "fire_at_hour":{"type":"integer"}, "fire_at_timezone":{"type":"string"} }, "required":["days_silent"] },
          { "title": "location",         "type": "object", "properties": { "place_name":{"type":"string"}, "direction":{"type":"string","enum":["arrive","leave","inside"]}, "dwell_minutes":{"type":"integer"}, "expiry":{"type":"string"} }, "required":["place_name"] }
        ]
      },
      "action_type": { "type": "string", "enum": ["sms","whatsapp","email"] },
      "action_config": {
        "type": "object",
        "properties": {
          "to":         { "type": "string" },
          "to_phone":   { "type": "string" },
          "to_email":   { "type": "string" },
          "body":       { "type": "string" },
          "tasks":      { "type": "array", "items": { "type": "string" } },
          "list_name":  { "type": "string" }
        },
        "required": ["body"]
      },
      "label":    { "type": "string" },
      "one_shot": { "type": "boolean" },
      "is_priority": { "type": "boolean" }
    },
    "required": ["trigger_type","trigger_config","action_type","action_config","label"]
  }
}
```

**Open questions:**
- SET_ACTION_RULE vs SET_EMAIL_ALERT duplication (top-5 #3).
- Per-variant `one_shot` default (top-5 #4).
- `cron` field for time-trigger — accepted by LIST_RULES describe() but undocumented in prompt's SET_ACTION_RULE section.
- For action_config, can Claude populate `to_phone`/`to_email` directly, or must it use `to`? (top-5 #1)
- `is_priority` is in the prompt but not forwarded (top-5 #5).
- Location trigger's `resolved_lat/lng/radius_meters` are SET BY the orchestrator post-resolve-place — should Claude be allowed to emit them at all? Probably no (orchestrator overwrites them).

---

### 2. LIST_RULES

**Purpose** Read the user's existing alerts back as a numbered list.
**Triggered by** mobile chat (voice surface has parallel handler).
**Handler location** `hooks/useOrchestrator.ts:1664-1742`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"LIST_RULES"` | yes | |
| match | string | optional | substring filter (lowercased), filters all_rules; empty = list all |

**Tool definition:**
```json
{
  "name": "list_rules",
  "description": "List user's existing alerts/automation rules. Optional match filters by substring across label/trigger/action.",
  "input_schema": {
    "type": "object",
    "properties": { "match": { "type": "string" } },
    "required": []
  }
}
```

**Open questions:** none.

---

### 3. DELETE_RULE

**Purpose** Delete one or more existing rules by match phrase.
**Triggered by** mobile chat / voice chat.
**Handler location** `hooks/useOrchestrator.ts:1744-1822`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"DELETE_RULE"` | yes | |
| match | string | conditionally required | required UNLESS all=true (line 1753) |
| all | boolean | optional | default false; true bypasses disambiguation |

**Tool definition:**
```json
{
  "name": "delete_rule",
  "description": "Delete one or more rules by match phrase. Set all=true for 'every'/'all my' phrasings.",
  "input_schema": {
    "type": "object",
    "properties": { "match": { "type": "string" }, "all": { "type": "boolean" } }
  }
}
```

**Open questions:** schema can't easily express "match required unless all=true" — leave as runtime validation in the handler.

---

### 4. CREATE_EVENT

**Purpose** Create a Google Calendar event.
**Triggered by** mobile chat (voice chat parallel).
**Handler location** `hooks/useOrchestrator.ts:1351-1381`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"CREATE_EVENT"` | yes | |
| summary | string | yes | event title |
| description | string | optional | |
| start | ISO 8601 datetime OR YYYY-MM-DD | yes | full datetime = timed event; date-only = all-day (per prompt line 334) |
| end | ISO 8601 OR YYYY-MM-DD | yes | end date for all-day = next day (exclusive); per prompt line 395 |
| attendees | string[] | optional | array of emails (line 1365) — orchestrator wraps each as `{name:'', email}` |
| recurrence | string[] | optional | RRULE strings, e.g. `["RRULE:FREQ=YEARLY"]` |
| is_priority | boolean | optional | RULE 16; create-calendar-event accepts it but orchestrator doesn't forward (gap — top-5 #5) |

**Tool definition:**
```json
{
  "name": "create_event",
  "description": "Add a calendar event. Default to TIMED format (full ISO 8601 datetime). Date-only YYYY-MM-DD allowed only for birthdays/anniversaries/expiry dates per prompt RULE 5.",
  "input_schema": {
    "type": "object",
    "properties": {
      "summary":     { "type": "string" },
      "description": { "type": "string" },
      "start":       { "type": "string" },
      "end":         { "type": "string" },
      "attendees":   { "type": "array", "items": { "type": "string" } },
      "recurrence":  { "type": "array", "items": { "type": "string" } },
      "is_priority": { "type": "boolean" }
    },
    "required": ["summary","start","end"]
  }
}
```

**Open questions:**
- Whether to constrain `start`/`end` to a `oneOf` of date vs datetime. Anthropic schemas don't enforce ISO regex strictly; rely on handler.
- `is_priority` forwarding gap.

---

### 5. DELETE_EVENT

**Purpose** Delete a calendar event matching a query.
**Triggered by** mobile chat.
**Handler location** `hooks/useOrchestrator.ts:1521-1531`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"DELETE_EVENT"` | yes | |
| query | string | yes | event title or keyword |

**Tool definition:**
```json
{
  "name": "delete_event",
  "description": "Delete a calendar event matching the query string.",
  "input_schema": { "type": "object", "properties": { "query": {"type":"string"} }, "required": ["query"] }
}
```

**Open questions:** none.

---

### 6. SET_REMINDER

**Purpose** Create a one-time reminder (paired with calendar event + push).
**Triggered by** mobile chat.
**Handler location** `hooks/useOrchestrator.ts:1832-1861`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"SET_REMINDER"` | yes | |
| title | string | yes | |
| datetime | ISO 8601 | yes | future required (pre-emit checks) |
| source | string | optional | default empty; prompt suggests `${channel}` |
| phoneNumber | string | optional | for fan-out; default user's phone |
| is_priority | boolean | optional | RULE 16; check-reminders honors it (line 76) but orchestrator doesn't forward |

**Tool definition:**
```json
{
  "name": "set_reminder",
  "description": "One-time reminder. Auto-creates a calendar event AND a push notification at the time.",
  "input_schema": {
    "type": "object",
    "properties": {
      "title":       { "type": "string" },
      "datetime":    { "type": "string" },
      "source":      { "type": "string" },
      "phoneNumber": { "type": "string" },
      "is_priority": { "type": "boolean" }
    },
    "required": ["title","datetime"]
  }
}
```

**Open questions:** `is_priority` not forwarded (top-5 #5).

---

### 7. SCHEDULE_MEDICATION

**Purpose** Expand a medication schedule into individual TIMED calendar events.
**Triggered by** mobile chat.
**Handler location** `hooks/useOrchestrator.ts:1533-1589`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"SCHEDULE_MEDICATION"` | yes | |
| name | string | yes | medication name; default `'Medication'` |
| dose_instruction | string | optional | default empty (e.g. "Take with food") |
| times | string[] HH:MM | optional | default `['08:00','20:00']` (line 1536) |
| on_days | integer | optional | default 5 |
| off_days | integer | optional | default 3; set 0 for continuous daily |
| start_date | YYYY-MM-DD | optional | default today (line 1540) |
| duration_days | integer | optional | default 30 |

**Tool definition:**
```json
{
  "name": "schedule_medication",
  "description": "Expand med schedule into per-dose calendar events. Defaults: times=[08:00,20:00], on=5, off=3, duration=30.",
  "input_schema": {
    "type": "object",
    "properties": {
      "name":             { "type": "string" },
      "dose_instruction": { "type": "string" },
      "times":            { "type": "array", "items": { "type": "string" } },
      "on_days":          { "type": "integer" },
      "off_days":         { "type": "integer" },
      "start_date":       { "type": "string" },
      "duration_days":    { "type": "integer" }
    },
    "required": ["name"]
  }
}
```

**Open questions:** the handler defaults silently. Should the schema force Claude to commit to numbers? Probably yes — silent defaulting hid `duration_days` bugs in the past (Sonnet→Haiku regression noted in extract-actions:130-138).

---

### 8. DRAFT_MESSAGE

**Purpose** Draft a message to send (email/sms/whatsapp); fires through confirm-flow.
**Triggered by** mobile chat / voice chat.
**Handler location** `hooks/useOrchestrator.ts:1824-1826` (queued); confirmable-flow at line 2329-2403.

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"DRAFT_MESSAGE"` | yes | |
| to | string | yes | name OR phone OR email; orchestrator resolves (line 2333) |
| subject | string | conditionally required | required when channel=email; ignored otherwise |
| body | string | yes | message body |
| channel | enum | optional | `email \| sms \| whatsapp`; default `email` (line 2332) |

**Channel constraint:**
- channel = `email` → subject required, recipient must resolve to email
- channel = `sms` | `whatsapp` → subject ignored, recipient must resolve to phone

**Tool definition (using `oneOf` for channel-conditional `subject`):**
```json
{
  "name": "draft_message",
  "description": "Draft a message for confirm-then-send. Subject is required for email channel only.",
  "input_schema": {
    "type": "object",
    "properties": {
      "to":      { "type": "string" },
      "subject": { "type": "string" },
      "body":    { "type": "string" },
      "channel": { "type": "string", "enum": ["email","sms","whatsapp"] }
    },
    "required": ["to","body","channel"]
  }
}
```

**Open questions:**
- Should we encode the email→subject-required constraint via `oneOf`? Anthropic supports it. Trade-off: stricter schema vs. simpler tool surface.
- `to` as freeform (current) vs. structured object (top-5 #2).

---

### 9. REMEMBER

**Purpose** Save a knowledge fragment to the user's memory.
**Triggered by** mobile chat / voice chat.
**Handler location** `hooks/useOrchestrator.ts:1336-1349` (calls `ingestNote` Edge Function).

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"REMEMBER"` | yes | |
| text | string | yes | fragment to remember |
| is_priority | boolean | optional | RULE 16 — DOCUMENTED but not forwarded (gap, top-5 #5) |

**Tool definition:**
```json
{
  "name": "remember",
  "description": "Save a personal fact or preference to user memory. Emit at most ONCE per turn for the same fact.",
  "input_schema": {
    "type": "object",
    "properties": { "text": {"type":"string"}, "is_priority":{"type":"boolean"} },
    "required": ["text"]
  }
}
```

**Open questions:**
- DATE-FACT FANOUT (prompt line 378) means REMEMBER often co-emits with CREATE_EVENT — Phase 2 schema doesn't model this; handled at the prompt level.
- Backwards-compat: does any caller pass `note` instead of `text`? The dedupe-loop at line 1303 only checks `text`. Confirm none do.

---

### 10. DELETE_MEMORY

**Purpose** Remove knowledge fragments matching a keyword.
**Triggered by** mobile chat.
**Handler location** `hooks/useOrchestrator.ts:1656-1662`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"DELETE_MEMORY"` | yes | |
| keyword | string | yes | substring match on fragment content |
| query | string | optional | BACKWARD-COMPAT alias — handler reads `keyword ?? query` (line 1657) |

**Tool definition:**
```json
{
  "name": "delete_memory",
  "description": "Remove memory fragments matching a keyword.",
  "input_schema": {
    "type": "object",
    "properties": { "keyword": {"type":"string"} },
    "required": ["keyword"]
  }
}
```

**Open questions:** drop the `query` shim in Phase 2 since strict tool-use will not allow Claude to emit arbitrary aliases. If any test/script emits `query`, update or delete it.

---

### 11. ADD_CONTACT

**Purpose** Save a contact (writes to local contacts table + people.googleapis person).
**Triggered by** mobile chat.
**Handler location** `hooks/useOrchestrator.ts:1828-1831`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"ADD_CONTACT"` | yes | |
| name | string | yes | |
| email | string | conditionally required | at-least-one-of email/phone per prompt RULE 4; handler tolerates both empty |
| phone | string | conditionally required | |
| relationship | string | optional | freeform (e.g. "wife", "son") |

**Tool definition:**
```json
{
  "name": "add_contact",
  "description": "Save a contact. At least one of email or phone must be present (per prompt RULE 4).",
  "input_schema": {
    "type": "object",
    "properties": {
      "name":         { "type": "string" },
      "email":        { "type": "string" },
      "phone":        { "type": "string" },
      "relationship": { "type": "string" }
    },
    "required": ["name"]
  }
}
```

**Open questions:** schema can't easily express "at least one of email/phone" — leave for handler validation. `relationship` enum vs freeform — leave freeform; downstream rules don't depend on a closed set.

---

### 12. LIST_CREATE

**Purpose** Create a new list (Drive doc + DB row).
**Triggered by** mobile chat.
**Handler location** `hooks/useOrchestrator.ts:1591-1604`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"LIST_CREATE"` | yes | |
| name | string | yes | list name; default `'My List'` |
| category | enum | optional | `shopping \| health \| tasks \| personal \| other`; default `'other'` |

**Tool definition:**
```json
{
  "name": "list_create",
  "description": "Create a new list. Categories: shopping, health, tasks, personal, other.",
  "input_schema": {
    "type": "object",
    "properties": {
      "name":     { "type": "string" },
      "category": { "type": "string", "enum": ["shopping","health","tasks","personal","other"] }
    },
    "required": ["name"]
  }
}
```

**Open questions:** is the category enum strict? Handler accepts any string (no validation). The prompt at line 478 documents the 5-value enum. Phase 2 should make this strict.

---

### 13. LIST_ADD

**Purpose** Add items to a named list.
**Triggered by** mobile chat.
**Handler location** `hooks/useOrchestrator.ts:1606-1621`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"LIST_ADD"` | yes | |
| listName | string | yes | name of existing list |
| items | string[] | yes | non-empty (handler skips if empty, line 1609) |

**Tool definition:**
```json
{
  "name": "list_add",
  "description": "Add one or more items to an existing list.",
  "input_schema": {
    "type": "object",
    "properties": {
      "listName": { "type": "string" },
      "items":    { "type": "array", "items": {"type":"string"}, "minItems": 1 }
    },
    "required": ["listName","items"]
  }
}
```

**Open questions:** none.

---

### 14. LIST_REMOVE

**Purpose** Remove items from a named list.
**Triggered by** mobile chat.
**Handler location** `hooks/useOrchestrator.ts:1623-1638`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"LIST_REMOVE"` | yes | |
| listName | string | yes | |
| items | string[] | yes | non-empty |

**Tool definition:**
```json
{
  "name": "list_remove",
  "description": "Remove items from an existing list.",
  "input_schema": {
    "type": "object",
    "properties": {
      "listName": { "type": "string" },
      "items":    { "type": "array", "items": {"type":"string"}, "minItems": 1 }
    },
    "required": ["listName","items"]
  }
}
```

**Open questions:** none.

---

### 15. LIST_READ

**Purpose** Read a list's contents back to the user.
**Triggered by** mobile chat / voice chat.
**Handler location** `hooks/useOrchestrator.ts:1640-1654`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"LIST_READ"` | yes | |
| listName | string | yes | |

**Tool definition:**
```json
{
  "name": "list_read",
  "description": "Read items from an existing list aloud.",
  "input_schema": {
    "type": "object",
    "properties": { "listName": {"type":"string"} },
    "required": ["listName"]
  }
}
```

**Open questions:** none.

---

### 16. SAVE_TO_DRIVE

**Purpose** Save a free-text note to the user's MyNaavi/Notes/ Drive folder.
**Triggered by** mobile chat.
**Handler location** `hooks/useOrchestrator.ts:1322-1334`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"SAVE_TO_DRIVE"` | yes | |
| title | string | yes | default `'Naavi Note'` |
| content | string | yes | full note body |

**Tool definition:**
```json
{
  "name": "save_to_drive",
  "description": "Save a text note to MyNaavi/Notes/.",
  "input_schema": {
    "type": "object",
    "properties": { "title": {"type":"string"}, "content": {"type":"string"} },
    "required": ["title","content"]
  }
}
```

**Open questions:** none. (Note: prompt RULE 18 takes priority over RULE 9 when phrase is "record" — Claude must NOT emit SAVE_TO_DRIVE in those cases. That's enforced by prompt, not schema.)

---

### 17. DRIVE_SEARCH

**Purpose** Search Drive (text-only against MyNaavi tree).
**Triggered by** mobile chat.
**Handler location** `hooks/useOrchestrator.ts:1425-1431`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"DRIVE_SEARCH"` | yes | |
| query | string | yes | search term |

**Tool definition:**
```json
{
  "name": "drive_search",
  "description": "Search the user's Drive (MyNaavi tree).",
  "input_schema": {
    "type": "object",
    "properties": { "query": {"type":"string"} },
    "required": ["query"]
  }
}
```

**Open questions:** none.

---

### 18. GLOBAL_SEARCH

**Purpose** Cross-source search across knowledge, rules, sent_messages, contacts, lists, calendar, gmail, email_actions, drive, reminders.
**Triggered by** mobile chat.
**Handler location** `hooks/useOrchestrator.ts:1433-1456`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"GLOBAL_SEARCH"` | yes | |
| query | string | yes | search keyword/phrase |

**Tool definition:**
```json
{
  "name": "global_search",
  "description": "Search across all of user's stored data (knowledge, rules, contacts, lists, calendar, gmail, drive, reminders).",
  "input_schema": {
    "type": "object",
    "properties": { "query": {"type":"string"} },
    "required": ["query"]
  }
}
```

**Open questions:** is there a min-length guard? Handler trims and skips empty (line 1437). Add `minLength: 1` to schema.

---

### 19. FETCH_TRAVEL_TIME

**Purpose** Get travel time + leave-by for a destination.
**Triggered by** mobile chat.
**Handler location** `hooks/useOrchestrator.ts:1383-1423`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"FETCH_TRAVEL_TIME"` | yes | |
| destination | string | yes | address |
| eventStartISO | ISO 8601 | optional | when set, orchestrator computes leave-by; empty allowed |
| departureISO | ISO 8601 | optional | overrides "leave now" — used by some test paths (line 1386) |

**Tool definition:**
```json
{
  "name": "fetch_travel_time",
  "description": "Compute travel time and leave-by time. Provide eventStartISO when departure must be tied to a meeting.",
  "input_schema": {
    "type": "object",
    "properties": {
      "destination":   { "type": "string" },
      "eventStartISO": { "type": "string" },
      "departureISO":  { "type": "string" }
    },
    "required": ["destination"]
  }
}
```

**Open questions:**
- `departureISO` undocumented in prompt but accepted by handler — should it stay?
- Verified-address rule (lines 1388-1415): the orchestrator runs resolve-place verification BEFORE rendering. Schema can't enforce; depends on the handler. (Top-5 #4 of the bigger picture: address verification is server-side, not schema-side.)

---

### 20. SPEND_SUMMARY

**Purpose** Aggregate vendor invoice totals over a period.
**Triggered by** mobile chat.
**Handler location** `hooks/useOrchestrator.ts:1458-1519`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"SPEND_SUMMARY"` | yes | |
| vendor | string | yes | vendor name as user said it |
| period_label | enum | yes | strict whitelist per prompt RULE 19a (line 820): `last month \| this month \| last year \| this year \| today \| yesterday \| past week \| all time`; default `'last month'` per handler |

**Tool definition:**
```json
{
  "name": "spend_summary",
  "description": "Sum vendor invoices over a period and return one number per currency.",
  "input_schema": {
    "type": "object",
    "properties": {
      "vendor":       { "type": "string" },
      "period_label": { "type": "string", "enum": ["last month","this month","last year","this year","today","yesterday","past week","all time"] }
    },
    "required": ["vendor","period_label"]
  }
}
```

**Open questions:** is the enum strict at the handler? It does `.toLowerCase().trim()` then forwards; Edge Function must validate. Confirm `naavi-spend-summary` accepts only the 8 values.

---

### 21. UPDATE_MORNING_CALL

**Purpose** Set/change/disable the user's daily briefing call (voice).
**Triggered by** voice chat ONLY (mobile prompt path doesn't dispatch it; voice server has the handler).
**Handler location** `naavi-voice-server/src/index.js:2204-2252`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"UPDATE_MORNING_CALL"` | yes | |
| time | HH:MM 24h | optional | only one of time/enabled is required to be present |
| enabled | boolean | optional | |

**Tool definition:**
```json
{
  "name": "update_morning_call",
  "description": "Set/change/disable the daily briefing call. Provide time (HH:MM 24h) and/or enabled.",
  "input_schema": {
    "type": "object",
    "properties": {
      "time":    { "type": "string", "pattern": "^[0-2][0-9]:[0-5][0-9]$" },
      "enabled": { "type": "boolean" }
    }
  }
}
```

**Open questions:** Mobile prompt also documents this action (line 522) but useOrchestrator doesn't handle it. It would silently no-op on the mobile surface. Phase 2: should mobile gain this handler, or should the prompt drop it for the mobile channel?

---

### 22. START_CALL_RECORDING

**Purpose** Start dual-channel Twilio call recording.
**Triggered by** voice chat ONLY.
**Handler location** `naavi-voice-server/src/index.js:5469-5477`

**Fields:**
| field | type | required | notes |
|---|---|---|---|
| type | `"START_CALL_RECORDING"` | yes | no other fields — empty payload |

**Tool definition:**
```json
{
  "name": "start_call_recording",
  "description": "Start audio recording the current Twilio call. Voice channel only. No parameters.",
  "input_schema": { "type": "object", "properties": {} }
}
```

**Open questions:** prompt explicitly says mobile channel must NOT emit this (line 877: "do NOT emit an action"). Schema-wise, do we hide this tool entirely from the mobile call's tool array, or expose it everywhere and rely on the prompt to gate? Hiding per-channel is cleaner.

---

# Group A — UNDOCUMENTED but handler-present

These three appear in `useOrchestrator.ts` but are NOT in the current shared prompt. They may be dead code from earlier sessions.

### LOG_CONCERN (orchestrator line 1862)
- Fields: `category`, `note`, `severity` — all string.
- Handler writes a topic record. **Open question:** still in use? Prompt no longer emits.

### UPDATE_PROFILE (orchestrator line 1864)
- Fields: `key`, `value` — both string.
- Handler writes a topic with `category: 'preference'`. **Open question:** still in use?

### SET_EMAIL_ALERT (orchestrator line 1866)
- Fields: `fromName`, `fromEmail`, `subjectKeyword`, `phoneNumber`, `label`.
- Handler writes to `action_rules` with trigger_type='email'. Duplicates SET_ACTION_RULE (top-5 #3).

Phase 2 should DECIDE: keep them as separate tools (means prompt must restore documentation) or remove from handler.

---

# Group B — Background Extractors (4)

These are NOT chat actions; they are Edge Functions that make their OWN Claude call and parse the JSON. Each has its own prompt and output schema. Phase 2 migration of these is independent of mobile chat.

---

### 23. extract-email-actions

**Purpose** Classify a Gmail message: actionable yes/no, sender type, document type, plus action fields.
**Triggered by** email pipeline (sync-gmail per tier-1 message).
**Handler location** `supabase/functions/extract-email-actions/index.ts:148-217` (prompt) and 234-326 (parse + persist).

**Output JSON shape (parsed at line 236; type at lines 30-42):**
| field | type | required | notes |
|---|---|---|---|
| is_actionable | boolean | yes | discriminator |
| sender_type | enum | yes | `personal \| institutional \| ambient` |
| document_type | enum or null | yes | `invoice \| warranty \| receipt \| contract \| medical \| statement \| tax \| ticket \| notice \| calendar \| other \| null` (11 + null) |
| reference | string or null | yes | invoice/policy/case/order/claim ID |
| expiry_date | ISO 8601 or null | yes | doc expiry (NOT due date) |

**When `is_actionable=true`, ALSO:**
| field | type | required | notes |
|---|---|---|---|
| action_type | enum | yes | `pay \| confirm \| review \| respond \| appointment \| renewal \| delivery \| info` |
| title | string | yes | ≤120 chars (handler clamps) |
| vendor | string | yes | ≤120 chars |
| amount_cents | integer or null | yes | document total |
| currency | string or null | yes | ≤8 chars (e.g. CAD) |
| due_date | ISO 8601 or null | yes | act-by date |
| urgency | enum | yes | `today \| this_week \| soon \| info` |
| summary | string | yes | ≤300 chars (handler clamps) |

**Tool definition (extractor — separate Claude call, single tool):**
```json
{
  "name": "classify_email",
  "description": "Classify whether email contains an actionable item; emit sender + document type independently.",
  "input_schema": {
    "type": "object",
    "properties": {
      "is_actionable":  { "type": "boolean" },
      "sender_type":    { "type": "string", "enum": ["personal","institutional","ambient"] },
      "document_type":  { "type": ["string","null"], "enum": ["invoice","warranty","receipt","contract","medical","statement","tax","ticket","notice","calendar","other",null] },
      "reference":      { "type": ["string","null"] },
      "expiry_date":    { "type": ["string","null"] },
      "action_type":    { "type": "string", "enum": ["pay","confirm","review","respond","appointment","renewal","delivery","info"] },
      "title":          { "type": "string" },
      "vendor":         { "type": "string" },
      "amount_cents":   { "type": ["integer","null"] },
      "currency":       { "type": ["string","null"] },
      "due_date":       { "type": ["string","null"] },
      "urgency":        { "type": "string", "enum": ["today","this_week","soon","info"] },
      "summary":        { "type": "string" }
    },
    "required": ["is_actionable","sender_type","document_type","reference","expiry_date"]
  }
}
```

**Open questions:**
- TypeScript type at line 39 lists 10 doc-type values (no `calendar`); the prompt at line 164-165 lists 11 (includes `calendar`); the validation array at line 294 has all 11. The TS type is stale.
- Schema can't easily express "action_type/title/vendor/etc. required only when is_actionable=true" — Anthropic supports `oneOf` discriminated unions on `is_actionable`. Phase 2 should structure as such.
- Prompt uses banned word "senior" (lines 148, 401). Per CLAUDE.md positioning, this needs to be retroactively rephrased.

---

### 24. extract-document-text

**Purpose** Classify an attachment / OCR text into structured doc facts.
**Triggered by** OCR pipeline (after harvest-attachment).
**Handler location** `supabase/functions/extract-document-text/index.ts:402-435` (PDF prompt), 146-171 (OCR-text prompt). Both produce same shape.

**Output JSON shape (parsed at line 186 / 456; persisted at 602-607):**
| field | type | required | notes |
|---|---|---|---|
| summary | string | yes | ≤300 chars |
| document_type | enum | yes | 11 values: `invoice \| warranty \| receipt \| contract \| medical \| statement \| tax \| ticket \| notice \| calendar \| other` |
| amount_cents | integer or null | yes | document total |
| currency | string or null | yes | ≤8 chars |
| date | ISO 8601 or null | yes | document issue date |
| reference | string or null | yes | primary identifier |
| expiry | ISO 8601 or null | yes | document expiry (NOT date) |

**Tool definition:**
```json
{
  "name": "classify_document",
  "description": "Extract structured facts from a document (PDF text layer or OCR'd image).",
  "input_schema": {
    "type": "object",
    "properties": {
      "summary":       { "type": "string" },
      "document_type": { "type": "string", "enum": ["invoice","warranty","receipt","contract","medical","statement","tax","ticket","notice","calendar","other"] },
      "amount_cents":  { "type": ["integer","null"] },
      "currency":      { "type": ["string","null"] },
      "date":          { "type": ["string","null"] },
      "reference":     { "type": ["string","null"] },
      "expiry":        { "type": ["string","null"] }
    },
    "required": ["summary","document_type","amount_cents","currency","date","reference","expiry"]
  }
}
```

**Open questions:**
- Prompt uses banned word "senior" (line 146, 402) — fix retroactively.
- The "OCR text unusable" / "Scanned document — text not readable" sentinel summaries (lines 164, 417) trigger Vision OCR fallback. With structured outputs, we'd want a discriminator field instead. Could add `text_layer_readable: boolean` or use null summary as the signal.

---

### 25. extract-actions (call recording)

**Purpose** Extract structured action items from a labeled conversation transcript.
**Triggered by** recording pipeline (after upload-conversation transcribes).
**Handler location** `supabase/functions/extract-actions/index.ts:76-127` (prompt); 156-162 (parse).

**Output: JSON ARRAY of objects (not a single object). Type at lines 16-33.**

**Each item:**
| field | type | required | notes |
|---|---|---|---|
| type | enum | yes | `appointment \| prescription \| follow_up \| task \| test \| call \| email \| meeting \| reminder` |
| title | string | yes | ≤8 words |
| description | string | yes | what to do |
| timing | string | yes | human-readable phrase |
| suggested_by | string | yes | speaker name; "Unknown" if unclear |
| calendar_title | string | optional | pre-filled cal event title |
| email_draft | string | optional | ONLY when transcript explicitly mentions email |
| start_date | YYYY-MM-DD | optional | resolvable from transcript |
| start_time | HH:MM | optional | 24h |
| duration_days | integer | conditional | prescription only |
| dose_times | string[] HH:MM | conditional | prescription only |

**Tool definition (a single tool that emits an ARRAY result):**
```json
{
  "name": "extract_visit_actions",
  "description": "Extract action items from a labeled conversation transcript. Returns an array; empty array allowed.",
  "input_schema": {
    "type": "object",
    "properties": {
      "actions": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "type":           { "type": "string", "enum": ["appointment","prescription","follow_up","task","test","call","email","meeting","reminder"] },
            "title":          { "type": "string" },
            "description":    { "type": "string" },
            "timing":         { "type": "string" },
            "suggested_by":   { "type": "string" },
            "calendar_title": { "type": "string" },
            "email_draft":    { "type": "string" },
            "start_date":     { "type": "string" },
            "start_time":     { "type": "string" },
            "duration_days":  { "type": "integer" },
            "dose_times":     { "type": "array", "items": {"type":"string"} }
          },
          "required": ["type","title","description","timing","suggested_by"]
        }
      }
    },
    "required": ["actions"]
  }
}
```

**Open questions:** the current call returns a bare JSON array (not wrapped in `actions`). Structured Outputs requires a top-level object — Phase 2 must wrap, then handler unwraps `parsed.actions`. Coordinate the rename.

---

### 26. ingest-note

**Purpose** Extract structured knowledge fragments from a note/transcript, embed, and store.
**Triggered by** REMEMBER action handoff + Drive Notes pipeline.
**Handler location** `supabase/functions/ingest-note/index.ts:22-29` (prompt); 80 (parse).

**Output: JSON ARRAY of fragments.**

**Each item:**
| field | type | required | notes |
|---|---|---|---|
| type | enum | yes | `life_story \| important_date \| preference \| relationship \| place \| routine \| concern` |
| content | string | yes | first-person, user's own words preserved |
| classification | enum | yes | `PUBLIC \| PERSONAL \| SENSITIVE \| MEDICAL \| FINANCIAL` |
| confidence | number 0.0–1.0 | yes | |

**Tool definition:**
```json
{
  "name": "extract_fragments",
  "description": "Extract knowledge fragments from a note/transcript.",
  "input_schema": {
    "type": "object",
    "properties": {
      "fragments": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "type":            { "type": "string", "enum": ["life_story","important_date","preference","relationship","place","routine","concern"] },
            "content":         { "type": "string" },
            "classification":  { "type": "string", "enum": ["PUBLIC","PERSONAL","SENSITIVE","MEDICAL","FINANCIAL"] },
            "confidence":      { "type": "number", "minimum": 0, "maximum": 1 }
          },
          "required": ["type","content","classification","confidence"]
        }
      }
    },
    "required": ["fragments"]
  }
}
```

**Open questions:** same array-wrapping issue as #25. Today the function expects a bare JSON array; Phase 2 must wrap.

---

# Architectural surprises found while reading

1. **`useOrchestrator.ts:1657`** — DELETE_MEMORY accepts BOTH `keyword` and `query` as field names: `String(action.keyword ?? action.query ?? '')`. Backward-compat shim for an older prompt version. Strict tool-use schemas would reject this — Phase 2 needs to clean it up first or whitelist both.

2. **`useOrchestrator.ts:1824-1831`** — DRAFT_MESSAGE and ADD_CONTACT share the same `if (action.type === 'DRAFT_MESSAGE' || action.type === 'ADD_CONTACT')` branch (line 1824) AND ADD_CONTACT also has its own block 4 lines later (line 1828). Both run for ADD_CONTACT, meaning ADD_CONTACT actions are ALSO pushed onto `turnDrafts[]` (line 1825). This may produce a draft card UI for contact-saves — needs verification.

3. **`useOrchestrator.ts:1860-1862`** — push notification scheduling for SET_REMINDER uses `setTimeout` keyed off `delayMs < 24*60*60*1000`. If the app is backgrounded or killed before the timeout fires, the local push is silently lost. The fan-out via SMS/email still happens (via `check-reminders` cron), but the in-app native notification doesn't.

4. **`useOrchestrator.ts:1862-1866`** — three undocumented action types (LOG_CONCERN, UPDATE_PROFILE, SET_EMAIL_ALERT) silently route through the orchestrator but are not in the current shared prompt. Either dead code or undocumented feature.

5. **Prompt `is_priority` rule (line 748)** — declared in RULE 16 across CREATE_EVENT, SET_REMINDER, REMEMBER. The mobile orchestrator never reads `action.is_priority`. So Naavi-mobile silently drops the priority flag. The Edge Functions that COULD use it (`create-calendar-event`, `check-reminders`) accept it but never see it from the mobile path. Voice path may be different — confirm before Phase 2.

6. **Voice/mobile schema drift** — UPDATE_MORNING_CALL and START_CALL_RECORDING are voice-only handlers, but the SHARED prompt (used by both surfaces) documents them. The mobile prompt copy at RULE 18 says "do NOT emit an action" for the recording phrasings — but only when `channel === 'app'`. Tool-use migration should dispatch DIFFERENT tool arrays per channel rather than rely on prompt to filter.

7. **Two extractors return bare JSON arrays** (extract-actions, ingest-note) — Anthropic Structured Outputs requires a top-level OBJECT. Phase 2 must wrap, parse `result.actions` / `result.fragments`, and update the consumers.

8. **TypeScript type drift** in `extract-email-actions/index.ts:39` — declares 10 document_type values but the prompt and runtime validator allow 11 (the TS type is missing `calendar`). Phase 2 should regenerate types from the schema to prevent this drift forever.
