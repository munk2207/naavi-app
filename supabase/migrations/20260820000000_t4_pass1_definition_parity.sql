-- T4 Pass 1 (2026-08-20) — definition parity between staging and production.
--
-- WHY THIS EXISTS. Staging and production were found to differ in 184 ways at
-- definition level. 42 of those are columns that exist in BOTH environments and
-- are defined differently — a category an earlier name-level comparison reported
-- as matching. This migration handles those 42.
--
-- THE DIRECTION THAT MATTERED. Production enforces NOT NULL where staging does
-- not, including user_id on six tables. Staging was therefore MORE PERMISSIVE
-- than production: a row with no owner inserts happily on staging and is
-- rejected by production. A test could pass on staging and fail in production —
-- the inverse of what a staging environment is for. CLAUDE.md's DATA INTEGRITY
-- section makes NOT NULL "Layer 1, the layer that cannot be bypassed by any code
-- path"; staging could not exercise Layer 1 on those tables at all.
--
-- WHY PRODUCTION IS TREATED AS CORRECT. The migration files declare, for every
-- one of these tables, `user_id uuid REFERENCES auth.users(id) ON DELETE
-- CASCADE` — with no NOT NULL. So staging matches the files exactly; it is
-- faithful, not broken. Production was tightened afterwards and the files never
-- captured it. Production is ahead of its own documentation, and this migration
-- is the documentation catching up.
--
-- APPLIED TO BOTH ENVIRONMENTS, deliberately. An earlier draft said "staging
-- only"; the Phase 2 review corrected it. A staging-only migration makes the
-- MIGRATION HISTORY diverge — staging carrying a migration production has never
-- seen — which is a new parity problem created by the work meant to end parity
-- problems. On production every statement below restates a definition that
-- already holds, verified column-by-column against a production catalogue
-- fingerprint before this file was written. Not "IF NOT EXISTS"; actual
-- definition equivalence.
--
-- NOT IN THIS FILE: 12 columns where STAGING is stricter than production
-- (timestamps and booleans with defaults, nullable in production). Making
-- staging "match" there would mean REMOVING constraints from staging, which is
-- what a mechanical parity script would do and is the wrong direction. Tracked
-- as holding-list item T5, which BLOCKS T4 completion — deferred, not accepted.
--
-- Governance: T4 Phase 3, approved with the T5 dependency as a mandatory change.
-- Authorized scope is this file only.

BEGIN;

-- ── Preflight guards ──────────────────────────────────────────────────────
--
-- SET NOT NULL fails outright if any existing row holds NULL. Failing is the
-- SAFE outcome — it stops rather than mangles — but a migration that dies
-- halfway leaves the schema part-applied. So every column is checked FIRST,
-- before any ALTER runs, and the whole thing aborts with the table named and
-- the offenders counted.
--
-- A count, never row data (Phase 3 ruling). Rows without an owner are a DATA
-- question for Wael — they are never deleted, reassigned, or defaulted by a
-- migration. If one of these fires, stop and investigate separately.
--
-- Verified 2026-08-20 before writing: all 19 currently have zero NULLs on
-- staging. These guards exist for the environment we have NOT checked and for
-- every future re-application.

DO $$
DECLARE
  r record;
  n bigint;
  targets text[][] := ARRAY[
    ARRAY['contacts','name'],                    ARRAY['contacts','user_id'],
    ARRAY['naavi_notes','title'],                ARRAY['naavi_notes','user_id'],
    ARRAY['reminders','datetime'],
    ARRAY['calendar_events','title'],            ARRAY['calendar_events','user_id'],
    ARRAY['calendar_events','google_event_id'],
    ARRAY['gmail_messages','user_id'],           ARRAY['gmail_messages','gmail_message_id'],
    ARRAY['push_subscriptions','auth'],          ARRAY['push_subscriptions','p256dh'],
    ARRAY['push_subscriptions','user_id'],       ARRAY['push_subscriptions','endpoint'],
    ARRAY['knowledge_fragments','type'],         ARRAY['knowledge_fragments','content'],
    ARRAY['knowledge_fragments','user_id'],      ARRAY['knowledge_fragments','source'],
    ARRAY['knowledge_fragments','classification']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(targets, 1) LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL',
                   targets[i][1], targets[i][2])
      INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        'T4 Pass 1 aborted: %.% has % row(s) with NULL. Decide what those rows '
        'belong to before tightening — do not delete or reassign them blindly.',
        targets[i][1], targets[i][2], n;
    END IF;
  END LOOP;
END $$;

-- ── Bucket A — 19 columns where production is stricter ────────────────────
-- Six of these are user_id. That is the multi-user safety boundary (CLAUDE.md
-- Rule 10): a row without a user_id belongs to nobody.

ALTER TABLE public.contacts            ALTER COLUMN name               SET NOT NULL;
ALTER TABLE public.contacts            ALTER COLUMN user_id            SET NOT NULL;
ALTER TABLE public.naavi_notes         ALTER COLUMN title              SET NOT NULL;
ALTER TABLE public.naavi_notes         ALTER COLUMN user_id            SET NOT NULL;
ALTER TABLE public.reminders           ALTER COLUMN datetime           SET NOT NULL;
ALTER TABLE public.calendar_events     ALTER COLUMN title              SET NOT NULL;
ALTER TABLE public.calendar_events     ALTER COLUMN user_id            SET NOT NULL;
ALTER TABLE public.calendar_events     ALTER COLUMN google_event_id    SET NOT NULL;
ALTER TABLE public.gmail_messages      ALTER COLUMN user_id            SET NOT NULL;
ALTER TABLE public.gmail_messages      ALTER COLUMN gmail_message_id   SET NOT NULL;
ALTER TABLE public.push_subscriptions  ALTER COLUMN auth               SET NOT NULL;
ALTER TABLE public.push_subscriptions  ALTER COLUMN p256dh             SET NOT NULL;
ALTER TABLE public.push_subscriptions  ALTER COLUMN user_id            SET NOT NULL;
ALTER TABLE public.push_subscriptions  ALTER COLUMN endpoint           SET NOT NULL;
ALTER TABLE public.knowledge_fragments ALTER COLUMN type               SET NOT NULL;
ALTER TABLE public.knowledge_fragments ALTER COLUMN content            SET NOT NULL;
ALTER TABLE public.knowledge_fragments ALTER COLUMN user_id            SET NOT NULL;
ALTER TABLE public.knowledge_fragments ALTER COLUMN source             SET NOT NULL;
ALTER TABLE public.knowledge_fragments ALTER COLUMN classification     SET NOT NULL;

-- ── Bucket C — 10 defaults production holds and staging lacks ─────────────
-- Each value below was read from the production catalogue, not chosen.

ALTER TABLE public.reminders           ALTER COLUMN user_id        SET DEFAULT auth.uid();
ALTER TABLE public.gmail_messages      ALTER COLUMN labels         SET DEFAULT '{}'::text[];
ALTER TABLE public.gmail_messages      ALTER COLUMN snippet        SET DEFAULT ''::text;
ALTER TABLE public.gmail_messages      ALTER COLUMN subject        SET DEFAULT ''::text;
ALTER TABLE public.gmail_messages      ALTER COLUMN body_text      SET DEFAULT ''::text;
ALTER TABLE public.gmail_messages      ALTER COLUMN sender_name    SET DEFAULT ''::text;
ALTER TABLE public.gmail_messages      ALTER COLUMN sender_email   SET DEFAULT ''::text;
ALTER TABLE public.calendar_events     ALTER COLUMN attendees      SET DEFAULT '[]'::jsonb;
ALTER TABLE public.calendar_events     ALTER COLUMN description    SET DEFAULT ''::text;
ALTER TABLE public.knowledge_fragments ALTER COLUMN confidence     SET DEFAULT 1.0;

-- Three Bucket A columns also carry a default in production.
ALTER TABLE public.calendar_events     ALTER COLUMN title          SET DEFAULT ''::text;
ALTER TABLE public.knowledge_fragments ALTER COLUMN source         SET DEFAULT 'notes'::text;
ALTER TABLE public.knowledge_fragments ALTER COLUMN classification SET DEFAULT 'PERSONAL'::text;

-- ── Debris — remove a real phone number from the schema ───────────────────
--
-- user_settings.morning_call_phone carried a DEFAULT of '+16137697957' on
-- staging — a live number that receives real calls and texts. Any row created
-- without an explicit phone silently inherited it. Production has no default.
--
-- The T2 outbound allowlist would have caught most sends, but that guard is a
-- second line of defence, not a reason to leave a real number in a column
-- default. Flagged as high priority at the T4 Phase 1 review.
--
-- No-op on production: verified to have no default there.

ALTER TABLE public.user_settings ALTER COLUMN morning_call_phone DROP DEFAULT;

COMMIT;
