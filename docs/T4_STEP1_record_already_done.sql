-- T4 — STEP 1 of 2.  Run this in the PRODUCTION SQL editor.
--
-- WHAT THIS DOES: ticks 14 items off production's "already done" list.
--
-- WHAT THIS DOES NOT DO: it does not create, change or delete a single table,
-- column, index or setting. It only writes 14 short text labels into a
-- bookkeeping table. Your data and your schema are untouched.
--
-- WHY: each of these 14 migrations describes something production ALREADY HAS
-- — verified column-by-column and function-by-function against production's own
-- catalogue on 2026-08-20. They were written to rebuild that state in OTHER
-- environments (staging, or any new one), and production never needed them.
-- Nobody ever recorded them as done, so production's list is wrong.
--
-- THE RISK OF LEAVING IT WRONG: any routine `supabase db push` sees 14 unticked
-- jobs and tries to RUN them. One of them (the cron job at 20260721000000) used
-- to schedule production to call STAGING every five minutes with a broken
-- password. That file has since been made harmless, but the list should still
-- be right.
--
-- NOT IN THIS LIST, deliberately:
--   20260723000000  — adds a column production genuinely does not have. Needs a
--                     decision, not a tick.
--   20260819000000  — S1 voice-PIN schema. Production promotion needs S1's own
--   20260819010000    gates; withheld on purpose.
--   20260820000000  — the T4 migration itself. It is Step 2, and it really does
--                     run.
--
-- SAFE TO RUN TWICE: ON CONFLICT DO NOTHING means a second run changes nothing.

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES
  ('20260321'),          -- base tables (calendar_events, contacts, gmail_messages, …)
  ('20260322'),          -- reminders base table
  ('20260419000099'),    -- documents base table
  ('20260430'),          -- user_settings core columns (name, phone, email)
  ('20260615000001'),    -- match_knowledge_for_dedup() function
  ('20260621'),          -- user_tokens table
  ('20260701000001'),    -- demo_optouts table
  ('20260703000001'),    -- tickets.created_by column
  ('20260716000000'),    -- action_rules label unique index
  ('20260721000000'),    -- sync-active-email-alerts cron (now guarded, no-op)
  ('20260802000000'),    -- calendar_events.location
  ('20260802000001'),    -- calendar_events.attendees
  ('20260805000000'),    -- user_settings.timezone_confirmed_at
  ('20260810000001')     -- search_knowledge_fragments() + last_retrieved_at
ON CONFLICT (version) DO NOTHING;

-- Confirmation. Should read 81 when this has run (67 before + 14).
SELECT count(*) AS applied_count FROM supabase_migrations.schema_migrations;
