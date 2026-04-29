# Naavi Auto-Tester

Server-side regression tests. Runs from this PC, not the phone.

## Setup (once)

1. Create `tests/.env` (or use the project root `.env`) with:

   ```
   SUPABASE_URL=https://hhgyppbxgmjrwdpdubcx.supabase.co
   SUPABASE_ANON_KEY=…publishable key…
   SUPABASE_SERVICE_ROLE_KEY=…service role key…
   TEST_USER_ID=…uuid of a real auth.users row dedicated to testing…
   ```

   - The **service-role key** is the dangerous one — keep it out of git. `.env` is already in `.gitignore`.
   - The **test user** must exist in `auth.users`. For first run we recommend creating a dedicated `naavi-tester@…` Google account, signing into the mobile app once, then copying its `user_id` from `auth.users`.

2. Connect Google Calendar for the test user (one-time, via the mobile app's normal OAuth flow). Without this, calendar tests fail with 401.

## Run

```bash
npm run test:auto                       # full suite
npm run test:auto -- --grep location    # only tests in the location category (or matching id)
npm run test:auto -- --bail             # stop on first failure
npm run test:auto -- --json             # machine-readable output instead of summary
```

## What runs (initial 8)

1. `smoke.naavi-chat` — verifies the chat Edge Function returns 200.
2. `chat.location-default-one-time` — verifies V57.4 prompt v41 default.
3. `rules.insert-and-list` — verifies action_rules + manage-rules op=list.
4. `contacts.no-match-returns-empty` — verifies lookup-contact times out cleanly.
5. `location.home-via-settings` — verifies `home` keyword resolves via user_settings.
6. `calendar.create-event` — verifies create-calendar-event returns htmlLink.
7. `memory.ingest-then-search` — verifies ingest → embed → search round-trip.
8. `email.draft-only-no-auto-send` — **CRITICAL** — verifies Naavi never auto-sends.

## Reports

Each run writes:
- `tests/results/{ISO-timestamp}.md`   — human-readable
- `tests/results/{ISO-timestamp}.json` — machine-readable
- `tests/results/latest.md`             — always points at the most recent run

## Adding new tests

1. Pick a category file in `tests/catalogue/` (or create a new one).
2. Add a `TestCase` to its exported array.
3. Import the array into `tests/runner.ts`.
4. Run.

## Cleanup

The suite calls `teardownSuite` at start AND end, deleting test-user rows from
~10 owned tables. Manual cleanup shouldn't be necessary, but if a run hangs you
can delete by hand from Supabase Studio.
