# Staging migration tracking — known false-positive drift (do NOT run the CLI's suggested repair)

Found and verified 2026-07-01 during F2b staging setup. Read this before touching `supabase db push` on staging if it complains about migration versions `20260430` or `20260615`.

## The symptom

```
npx supabase db push --db-url "postgresql://postgres.xugvnfudofuskxoknhve:...@..." --include-all --yes
```

fails with:

```
Remote migration versions not found in local migrations directory.
Make sure your local git repo is up-to-date. If the error persists, try repairing the migration history table:
supabase migration repair --status reverted 20260430 20260615
```

## ⚠️ Do NOT run that suggested repair command

`supabase migration repair --status reverted 20260430 20260615` would mark these two migrations as **not applied** in the tracking table. They ARE applied — running that command would make a future `db push` try to re-run their `CREATE TABLE` / `CREATE POLICY` statements against objects that already exist, which will fail (Postgres has no `CREATE POLICY IF NOT EXISTS`) or otherwise put the tracking table in a worse state than it's in now.

## What's actually going on (verified, not guessed)

Both `20260430_user_settings_core_columns.sql` and `20260615_geofence_events.sql` use the older bare `YYYYMMDD` filename convention. Each shares its calendar date with sibling migrations that use the newer full `YYYYMMDDHHMMSS` convention (`20260430000000_client_diagnostics.sql`, `20260430000001_...`, `20260430000002_...`; `20260615000001_knowledge_dedup.sql`). The Supabase CLI's local/remote diffing appears to mis-pair the bare-date entry against its same-day siblings instead of matching it to itself — a display/diff artifact, not a real data problem.

Verified directly against staging Postgres (`xugvnfudofuskxoknhve`), 2026-07-01:
- `supabase_migrations.schema_migrations` has `version=20260430, name=user_settings_core_columns` and `version=20260615, name=geofence_events` — both correctly present, names matching the local files exactly.
- The actual schema effects are confirmed present: `user_settings` has all the columns `20260430_user_settings_core_columns.sql` would add; the `geofence_events` table exists exactly as `20260615_geofence_events.sql` defines it.

A third version, `20260621` (`user_tokens`), was a genuine gap — that migration's own comment says the table was "created manually in production, never migrated." It existed on staging (someone had copied the schema over) but was never registered in the tracking table. That one **was** fixed this session: the table/RLS/policy were verified to already match the migration file exactly, so only the tracking row was inserted (no DDL re-run, since `CREATE POLICY` isn't idempotent and the policy already existed under the same name). It no longer appears in `db push` errors.

## Why the files aren't being renamed

Renaming `20260430_user_settings_core_columns.sql` / `20260615_geofence_events.sql` to a full-timestamp format would change their version string. Both are shared with production and already correctly tracked as applied — under their *current* names — in whatever database they've been applied to. A rename would very likely turn a currently-correct match into a genuine mismatch, in an environment (production) this note's author had no credential to verify. Not worth the risk to fix a cosmetic CLI diff quirk.

## What to actually do if you need to add a new staging migration and `db push --include-all` fails

Apply the new migration file directly against staging via a raw Postgres connection (bypassing the CLI's migration-list/diff logic entirely), then register it in the tracking table so future pushes don't try to replay it:

1. Run the migration file's SQL directly against `postgresql://postgres.xugvnfudofuskxoknhve:NaaviStaging2026@aws-1-us-east-1.pooler.supabase.com:6543/postgres` (the connection string CLAUDE.md documents for staging) using any Postgres client (`pg` npm package works fine — `npm install pg` into a scratch directory, no need to add it as a project dependency).
2. Insert a row into `supabase_migrations.schema_migrations` — columns are `version text`, `name text`, `statements text[]` — with the new migration's version/name, `ON CONFLICT (version) DO NOTHING`.
3. This is exactly the pattern used to apply `20260701000001_demo_optouts.sql` to staging this session — see that commit for a working example.

## Production

Not checked. No documented read credential for production Supabase exists in CLAUDE.md the way one does for staging (deliberately — production is treated as read-only/hands-off by default). If the same class of issue ever needs checking there, get an explicit credential/authorization first rather than guessing one.
