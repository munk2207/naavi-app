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

## Category 8 — Multi-user safety (40-60 tests, HIGHEST PRIORITY)

**Why this category exists:** On 2026-04-29 we discovered `naavi-chat` was missing CLAUDE.md Rule 4 step (b) — the body `user_id` fallback. Any external caller without a JWT bound to whoever was first in `user_tokens` (Hussein in this project's history). This was a multi-user safety violation present for months. The auto-tester didn't have coverage for this category, so it went undetected.

**Goal:** every Edge Function callable from the mobile app OR the voice server gets a 4-test matrix. Plus suite-level cross-user isolation tests.

### The 4-test matrix per Edge Function

| # | Test name | Setup | Expected outcome | What it catches |
|---|-----------|-------|------------------|-----------------|
| a | `<fn>.jwt-resolves-to-A` | Send a JWT for user A. No body `user_id`. | Operates on A's data only. Returns A's results. | The auth chain works. |
| b | `<fn>.body-userid-resolves-to-A` | No JWT (anon key only). Body has `user_id: A`. | Operates on A's data. (Voice server / external caller path.) | The voice-server / external path works. |
| c | `<fn>.no-auth-no-body-rejects` | Anon key only, no body `user_id`. | Returns 401 (or empty result with `error: 'unauthenticated'`). **MUST NOT** bind to a random user. | The Hussein bug — never bind to "first user in user_tokens". |
| d | `<fn>.jwt-overrides-body-userid` | JWT for user A. Body has `user_id: B` (mismatch / tampering attempt). | Operates on A's data (JWT wins). Body `user_id` ignored or rejected. | Defense against client-side tampering. |

### Functions in scope (priority order)

| # | Function | Priority |
|---|----------|----------|
| 8.1 | `naavi-chat` | Just fixed — verify regression doesn't recur. |
| 8.2 | `manage-rules` | Touches RLS-protected `action_rules` table. |
| 8.3 | `send-sms` | External-facing — fires real WhatsApp / SMS / email to real numbers. Highest blast radius. |
| 8.4 | `lookup-contact` | Reads Google People API — leaks contacts if wrong user. |
| 8.5 | `create-calendar-event` / `delete-calendar-event` | Writes to user's Google Calendar. |
| 8.6 | `ingest-note` / `search-knowledge` | Personal facts; leak risk is highest. |
| 8.7 | `evaluate-rules` | Cron-triggered — must iterate one user at a time and never cross-fire. |
| 8.8 | `global-search` | Aggregates from many tables; must never return another user's data. |
| 8.9 | `manage-list` | List CRUD on `lists` table. |
| 8.10 | `resolve-place` | Reads `user_settings.home_address` etc. |
| 8.11 | `save-to-drive` / `read-drive-file` / `update-drive-file` | Google Drive access — sandboxing per user is critical. |
| 8.12 | `send-email` | Same blast radius as send-sms. |

8.1 × 4 + 8.2 × 4 + ... = **48 tests minimum** for the matrix alone.

### Suite-level cross-user isolation tests (5 extra)

**8.X.1 — Cross-user `action_rules` read** — Create user B (`naavi-tester-2@…`). Seed user A with 1 rule. As user B (JWT for B), call `manage-rules` op=list. **MUST return zero rules.** B must never see A's rule.

**8.X.2 — Cross-user `lists` read** — Same pattern as 8.X.1 but on `lists`.

**8.X.3 — Cross-user `knowledge_fragments` read** — Same pattern. Personal data leak prevention.

**8.X.4 — Cross-user `sent_messages` read** — Same pattern. Verify communication history isolation.

**8.X.5 — Voice-server caller routing** — Simulate the voice server's body shape: `{ user_id: A_uuid, system: ..., messages: ... }` sent with anon key. Verify the resolved `user_id` in the response context matches A, not Hussein, not Wael, not anyone else.

### Practical setup requirements

- **Second test user.** Create `naavi-tester-2@gmail.com`. Sign into the mobile app once with it (so `auth.users` has a row + initial OAuth tokens). Copy the `user_id` into `tests/.env` as `TEST_USER_ID_2`.
- **Test user JWT generation.** For the matrix's "JWT for user A" tests, the test framework needs to mint a JWT for the test user. Options:
  - (a) Use the service-role key + `auth.admin.generateLink({ type: 'magiclink', email: testUserEmail })` to get a short-lived signed-in URL, then exchange.
  - (b) Sign in with email + password if the test users have static passwords.
  - (c) Skip JWT tests for now and only cover (b) and (c) of the matrix — still catches 50% of the risk surface and is simpler.

Recommended: start with (c) — body-user_id and no-auth tests catch the Hussein-class bugs. Add JWT tests later when fixture infrastructure is more mature.

### Generator pattern (recommended implementation)

Instead of writing 48 tests by hand, scaffold a helper that takes a function descriptor and emits the 4-test matrix:

```ts
multiUserMatrix({
  fnName: 'manage-rules',
  body: { op: 'list' },           // request body shape
  validate: (data) => Array.isArray(data?.rules), // success shape
  ownerKey: 'rules[].user_id',     // for cross-user isolation
});
```

The helper produces 4 tests per call. 12 functions × 1 call each = 48 tests with one line of catalogue code per function. Maintenance becomes near-zero.

### When to run

- **Every nightly run** — multi-user safety is a security property, not a behavior — needs constant verification.
- **Before every AAB ship** — block the build if any of these fail.
- **After any change to a `resolveUserId` function or RLS policy** — these are the most fragile surfaces.

---

## Category 9 — Email send protection (3 tests, CRITICAL)

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
