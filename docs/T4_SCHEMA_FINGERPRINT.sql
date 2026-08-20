-- T4 — environment fingerprint. READ-ONLY. Returns one JSON value.
--
-- Run in the Supabase SQL editor for BOTH projects and save each result.
-- Nothing is written, created, altered or dropped: every statement below is a
-- SELECT against catalogue views.
--
-- Definition-level, not name-level: types, defaults, nullability, index and
-- constraint definitions, RLS policy expressions, function bodies and cron
-- schedules are all included, because an object can exist in both environments
-- and still differ (Phase 0 review, 2026-08-20).
--
-- ⚠️ Save the OUTPUT to a DIFFERENT file. On 2026-08-20 the production result
-- was saved over this query — recoverable, but it cost a round trip.

SELECT jsonb_pretty(jsonb_build_object(

  'columns', (
    SELECT jsonb_object_agg(k, v) FROM (
      SELECT c.table_name || '.' || c.column_name AS k,
             jsonb_build_object(
               'type',     c.data_type,
               'nullable', c.is_nullable,
               'default',  c.column_default,
               'maxlen',   c.character_maximum_length
             ) AS v
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ) s
  ),

  'indexes', (
    SELECT jsonb_object_agg(indexname, indexdef)
    FROM pg_indexes WHERE schemaname = 'public'
  ),

  'constraints', (
    SELECT jsonb_object_agg(k, v) FROM (
      SELECT rel.relname || '.' || con.conname AS k,
             pg_get_constraintdef(con.oid) AS v
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = 'public'
    ) s
  ),

  'rls_enabled', (
    SELECT jsonb_object_agg(relname, relrowsecurity)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  ),

  'policies', (
    SELECT jsonb_object_agg(k, v) FROM (
      SELECT tablename || '.' || policyname AS k,
             jsonb_build_object(
               'cmd',        cmd,
               'permissive', permissive,
               'roles',      roles::text,
               'using',      qual,
               'with_check', with_check
             ) AS v
      FROM pg_policies WHERE schemaname = 'public'
    ) s
  ),

  -- pg_get_functiondef() ERRORS on aggregate and window functions
  -- ("avg is an aggregate function", hit on production 2026-08-20). Aggregates
  -- are still part of the schema and must be compared, so they are recorded by
  -- kind + source rather than skipped.
  'functions', (
    SELECT jsonb_object_agg(k, v) FROM (
      SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS k,
             CASE p.prokind
               -- Hash the NORMALISED body, not the raw text. Postgres stores a function
               -- exactly as typed, so one extra space produces a completely different
               -- hash and two identical functions look like a real difference. On
               -- 2026-08-20 try_enter_geofence and tickets_set_updated_at sat in the
               -- differences list all day on the strength of a space after a bracket
               -- and some indentation, and a hash cannot be un-normalised afterwards.
               WHEN 'f' THEN 'f:' || md5(
                 regexp_replace(
                   regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g'),
                   '\s*([(),;])\s*', '\1', 'g'
                 )
               )
               ELSE p.prokind::text || ':' || COALESCE(p.prosrc, '')
             END AS v
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    ) s
  ),

  'triggers', (
    SELECT jsonb_object_agg(k, v) FROM (
      SELECT c.relname || '.' || t.tgname AS k,
             pg_get_triggerdef(t.oid) AS v
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ) s
  ),

  'extensions', (
    -- Version AND schema. An extension's SCHEMA is part of how the database
    -- behaves, not decoration: pgvector lives in `extensions` on staging and
    -- is reachable from `public` on production, so a function pinning
    -- search_path to public alone works on one and cannot find the <=>
    -- operator on the other. That difference was invisible to every
    -- comparison run on 2026-08-20 and only surfaced when a migration copied
    -- production's search_path across and failed.
    SELECT jsonb_object_agg(e.extname, e.extversion || ' @' || n.nspname)
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  ),

  'cron_jobs', (
    SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM (
      SELECT jobname AS k,
             jsonb_build_object('schedule', schedule, 'active', active,
                                -- Redact the service key BEFORE truncating.
                                -- Production's key is a long eyJ… JWT and staging's
                                -- is the short sb_secret_ format, so a plain
                                -- left(command,400) cut production off mid-key and
                                -- threw away the rest of the statement. The two were
                                -- then compared against different amounts of text, and
                                -- four cron jobs reported as drift for having the
                                -- correct key in the correct environment.
                                'command', left(
                                  regexp_replace(
                                    regexp_replace(command, 'eyJ[A-Za-z0-9_.-]{20,}', 'SERVICE_KEY', 'g'),
                                    'sb_secret_[A-Za-z0-9_-]+', 'SERVICE_KEY', 'g'
                                  ), 400)) AS v
      FROM cron.job
    ) s
  )

)) AS fingerprint;
