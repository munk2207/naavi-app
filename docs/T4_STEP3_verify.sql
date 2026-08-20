-- T4 — FINAL PROOF. READ-ONLY.
--
-- The values below are how these 30 columns looked in PRODUCTION BEFORE
-- tonight, taken from the fingerprint run earlier. This compares them to how
-- they look NOW.
--
-- ZERO ROWS = production did not change. That is the result we want.
-- Any row returned = something changed, and it names exactly what.

WITH expected(tbl,col,want_nullable,want_default) AS (VALUES
  ('contacts','name','NO',NULL),
  ('contacts','user_id','NO',NULL),
  ('naavi_notes','title','NO',NULL),
  ('naavi_notes','user_id','NO',NULL),
  ('reminders','datetime','NO',NULL),
  ('calendar_events','title','NO','''''::text'),
  ('calendar_events','user_id','NO',NULL),
  ('calendar_events','google_event_id','NO',NULL),
  ('gmail_messages','user_id','NO',NULL),
  ('gmail_messages','gmail_message_id','NO',NULL),
  ('push_subscriptions','auth','NO',NULL),
  ('push_subscriptions','p256dh','NO',NULL),
  ('push_subscriptions','user_id','NO',NULL),
  ('push_subscriptions','endpoint','NO',NULL),
  ('knowledge_fragments','type','NO',NULL),
  ('knowledge_fragments','content','NO',NULL),
  ('knowledge_fragments','user_id','NO',NULL),
  ('knowledge_fragments','source','NO','''notes''::text'),
  ('knowledge_fragments','classification','NO','''PERSONAL''::text'),
  ('reminders','user_id','YES','auth.uid()'),
  ('gmail_messages','labels','YES','''{}''::text[]'),
  ('gmail_messages','snippet','YES','''''::text'),
  ('gmail_messages','subject','YES','''''::text'),
  ('gmail_messages','body_text','YES','''''::text'),
  ('gmail_messages','sender_name','YES','''''::text'),
  ('gmail_messages','sender_email','YES','''''::text'),
  ('calendar_events','attendees','YES','''[]''::jsonb'),
  ('calendar_events','description','YES','''''::text'),
  ('knowledge_fragments','confidence','YES','1.0'),
  ('user_settings','morning_call_phone','YES',NULL)
)
SELECT e.tbl||'.'||e.col AS column_that_changed,
       e.want_nullable AS was_nullable, c.is_nullable AS now_nullable,
       coalesce(e.want_default,'(none)') AS was_default,
       coalesce(c.column_default,'(none)') AS now_default
FROM expected e
JOIN information_schema.columns c
  ON c.table_schema='public' AND c.table_name=e.tbl AND c.column_name=e.col
WHERE c.is_nullable IS DISTINCT FROM e.want_nullable
   OR c.column_default IS DISTINCT FROM e.want_default;
