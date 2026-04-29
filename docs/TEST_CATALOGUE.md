# Naavi Auto-Tester — Test Catalogue

**Purpose:** Server-side regression tests that simulate Robert's interactions and verify Naavi's backend behavior — without needing the phone in hand.

**Scope:** Backend only. UI rendering, voice / TTS quality, mic recording, and notification delivery are NOT covered (those still need manual on-phone tests).

**Test isolation:** All tests run against a dedicated test user (`naavi-tester@anthropic-staging.com`, user_id provisioned at suite start, all rows deleted at suite end).

**Naming convention:** `{category}.{specific-behavior}` — e.g. `location.alert-defaults-to-one-time`.

---

## Category 1 — Smoke (5 tests)

Verifies every Edge Function is reachable and returns a 200 to a minimal valid request.

| # | Test ID | Edge Function | What it does |
|---|---|---|---|
| 1.1 | `smoke.naavi-chat` | `naavi-chat` | Sends "hello" — expects 200 with non-empty `rawText`. |
| 1.2 | `smoke.lookup-contact` | `lookup-contact` | Sends `{ name: "test" }` — expects 200, may return empty contact. |
| 1.3 | `smoke.resolve-place` | `resolve-place` | Sends `{ place_name: "home", user_id: testUserId }` — expects 200. |
| 1.4 | `smoke.text-to-speech` | `text-to-speech` | Sends `{ text: "ok" }` — expects 200 with non-empty audio buffer. |
| 1.5 | `smoke.global-search` | `global-search` | Sends `{ query: "test", user_id: testUserId }` — expects 200. |

**Failure mode tested:** Any 5xx, timeout, or empty-body response.

---

## Category 2 — Naavi-chat behavior (6 tests)

Verifies Claude returns the right action types for canonical phrases.

| # | Test ID | Input message | Expected behavior |
|---|---|---|---|
| 2.1 | `chat.location-default-one-time` | "Alert me when I arrive home" | Returns `SET_ACTION_RULE` with `trigger_type='location'`, `one_shot=true`. |
| 2.2 | `chat.location-explicit-recurring` | "Alert me every time I arrive at home" | Returns `SET_ACTION_RULE` with `one_shot=false`. |
| 2.3 | `chat.email-draft-not-sent` | "Email Hussein about dinner" | Returns `DRAFT_MESSAGE` action, NOT a `SEND_*` action. |
| 2.4 | `chat.calendar-create` | "Schedule lunch with Mike tomorrow at noon" | Returns `CREATE_CALENDAR_EVENT` action. |
| 2.5 | `chat.remember` | "Remember my Costco card is 1234" | Returns `REMEMBER` action. |
| 2.6 | `chat.list-add` | "Add eggs to my groceries list" | Returns `MANAGE_LIST` action with `op='add'`. |

**Failure mode tested:** Wrong action type, missing required fields, or hallucinated extra actions.

---

## Category 3 — Action rules (5 tests)

Verifies rule creation, dedup, listing, deletion, and one_shot toggling.

| # | Test ID | What it does | Expected |
|---|---|---|---|
| 3.1 | `rules.location-insert` | Insert a location rule via `action_rules` table directly. | Row exists with `one_shot=true`. |
| 3.2 | `rules.location-toggle-recurring` | Update `one_shot=false` on an existing rule (LocationRuleCard path). | Row updated, `one_shot=false`. |
| 3.3 | `rules.dedup-on-trigger-ref` | Insert same rule_id + trigger_ref into `action_rule_log` twice. | Second insert blocked by UNIQUE constraint. |
| 3.4 | `rules.list-via-manage-rules` | Call `manage-rules` with `op='list'`. | Returns array including the test rule. |
| 3.5 | `rules.delete-via-manage-rules` | Call `manage-rules` with `op='delete'`. | Row removed from `action_rules`. |

**Failure mode tested:** Insert silently downgrading one_shot, dedup not firing, RLS blocking owner.

---

## Category 4 — Contact lookup (4 tests)

Verifies Google People API multi-match flow and timeout fallback.

| # | Test ID | What it does | Expected |
|---|---|---|---|
| 4.1 | `contacts.single-match` | Lookup name with 1 match in test contacts. | Returns `{ contact: {…}, contacts: [{…}] }`. |
| 4.2 | `contacts.multi-match` | Lookup a common first name (e.g. "John"). | Returns `contacts: [more than 1]`. |
| 4.3 | `contacts.no-match` | Lookup gibberish name "Zzzzz". | Returns `contact: null, contacts: []`. |
| 4.4 | `contacts.timeout-falls-through` | Inject artificial delay (>15s); verify timeout fires. | Caller receives `error: 'timeout'`, no hang. |

**Failure mode tested:** Hang on Google People API stall (the V57.4 bug).

---

## Category 5 — Location resolution (5 tests)

Verifies the `resolve-place` Edge Function chain.

| # | Test ID | Input | Expected |
|---|---|---|---|
| 5.1 | `location.home-via-settings` | `place_name='home'` (with home_address set in user_settings). | `source='settings_home'`, lat/lng populated. |
| 5.2 | `location.office-via-settings` | `place_name='office'`. | `source='settings_work'`, lat/lng populated. |
| 5.3 | `location.cached` | Same place asked twice in a row. | First: `source='fresh'`. Second: `source='memory'`. |
| 5.4 | `location.places-fresh-resolve` | `place_name='Costco Merivale'`. | `source='fresh'`, valid coords from Google Places. |
| 5.5 | `location.not-found-3-attempt-cap` | Garbage input "asdfqwerty". | `status='not_found'`. Fourth attempt returns "please call back". |

**Failure mode tested:** Personal-keyword mismatch, missing address fallback, fresh-resolve hang.

---

## Category 6 — Calendar (3 tests)

Verifies calendar event creation and list reads.

| # | Test ID | What it does | Expected |
|---|---|---|---|
| 6.1 | `calendar.create-event` | Call `create-calendar-event` with title + start time. | Event created in test calendar, `htmlLink` returned. |
| 6.2 | `calendar.upcoming-list` | List events for next 7 days. | Returns array, includes the one we just created. |
| 6.3 | `calendar.prescription-expand` | Send "take 2 ibuprofen twice daily for 5 days" via the visit-recorder action shape. | Generates 10 separate events (2 doses × 5 days). |

**Failure mode tested:** Recurrence wrong, single event when multiple expected, OAuth refresh failure.

---

## Category 7 — Memory & search (4 tests)

Verifies note ingestion, search, query expansion.

| # | Test ID | What it does | Expected |
|---|---|---|---|
| 7.1 | `memory.ingest-note` | Call `ingest-note` with "Robert prefers tea over coffee". | Stored, vector embedding populated. |
| 7.2 | `memory.search-exact` | Search "tea". | Returns the ingested fragment. |
| 7.3 | `memory.search-plural` | Search "teas". | Still returns the fragment (V57 query expansion). |
| 7.4 | `memory.global-search-multi-source` | Search "Hussein" — should hit contacts + email actions + knowledge. | Returns results from at least 2 adapters. |

**Failure mode tested:** Embedding pipeline broken, plurals not expanded, single-adapter result.

---

## Category 8 — Email send protection (3 tests, CRITICAL)

Verifies Naavi NEVER auto-sends emails. Drafts only.

| # | Test ID | What it does | Expected |
|---|---|---|---|
| 8.1 | `email.draft-only` | Call `naavi-chat` with "Email Hussein about lunch". | Returns `DRAFT_MESSAGE` (action_type='email'). NO row in `sent_messages`. |
| 8.2 | `email.no-send-action-type` | Run all 6 chat behavior tests above. | None of them return `SEND_EMAIL` directly. |
| 8.3 | `email.action-rule-fan-out-self-only-on-trigger` | Trigger an `action_rules` row with `action_type='email'` to self. | Email fires ONLY when rule fires (e.g. via cron), not at rule creation. |

**Failure mode tested:** Auto-send at draft time (regressing the most critical safety guard).

---

## Run modes

```bash
npm run test:auto              # full suite, ~30 cases
npm run test:auto -- --grep location   # filter by category
npm run test:auto -- --bail            # stop on first failure
npm run test:auto -- --json            # machine-readable output
```

---

## Reporting

After each run, output is written to `tests/results/{ISO-timestamp}.md` and `tests/results/{ISO-timestamp}.json`.

**Summary format:**
```
Naavi Auto-Tester — 2026-04-29 14:32 UTC
─────────────────────────────────────────────────
Total: 30   Passed: 28 ✓   Failed: 2 ✗   Duration: 47s

✗ FAIL  location.alert-defaults-to-one-time
  Expected: action.one_shot === true
  Got:      action.one_shot === false
  Hint:     check PROMPT_VERSION in get-naavi-prompt

✗ FAIL  contacts.multi-match
  Expected: data.contacts.length > 1
  Got:      data.contacts.length === 0
  Hint:     test fixture missing duplicate "John" entries
```

---

## Open design questions

1. **Schedule:** run nightly via GitHub Actions, or only on-demand?
2. **Test user data:** synthetic fixtures or anonymized real-Robert subset?
3. **Failure threshold:** any failure blocks the next AAB build, or only critical-category failures?
4. **Notification:** SMS / email Wael when nightly run fails, or just check report manually?

---

## Future categories (V2)

- **Push notifications** — verify expo-server-sdk delivers (needs separate harness)
- **Twilio voice** — simulated webhook-in / webhook-out (Twilio test mode available)
- **Email harvesting** — `extract-email-actions`, `harvest-attachment`, `extract-document-text` chain
- **Geofencing** — simulate location enter/exit and verify `geofence-event` Edge Function fires correctly
