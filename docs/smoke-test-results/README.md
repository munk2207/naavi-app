# Smoke test results

This folder is populated by `scripts/smoke-test.js`.

| File | What it is |
|---|---|
| `latest.log` | Full output of the most recent run. Overwritten each run. |
| `<timestamp>.log` | Timestamped copy of each run for history (gitignored). |
| `history.csv` | One line per run: `timestamp,passed,failed,warned,elapsed_s` — committed to track trends. |

## To run

```bash
cd /c/Users/waela/OneDrive/Desktop/Naavi
node scripts/smoke-test.js
```

Exits `0` on all pass, `1` on any failure (CI-friendly).

## What the test covers

See the docstring at the top of `scripts/smoke-test.js`. Checks ~28 things across web, voice, Supabase, and repo state in ~50 seconds.

## What to do when it fails

The final line of output lists each failure with its section and detail. Read `latest.log` for the full trace of a failed run.
