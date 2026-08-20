-- Restore the two staging policies removed earlier today.
--
-- In Pass 4 I dropped staging's "manage own" policies on calendar_events and
-- gmail_messages and replaced them with production's narrower read-only ones,
-- on the reasoning that the client only reads those tables and writes go
-- through Edge Functions as service_role. The reasoning holds; the action does
-- not. Wael's instruction, 2026-08-20: do not delete anything from any
-- platform. Where the two environments differ, the answer is to promote, not
-- to remove.
--
-- Nothing is dropped here. The read-only policies added in Pass 4 stay exactly
-- where they are — RLS policies are PERMISSIVE and OR together, so a SELECT
-- policy sitting beside an ALL policy with the same expression grants nothing
-- extra and takes nothing away. Production has that same redundant shape on
-- several tables already.
--
-- Net effect: staging is back to the capability it had this morning, and it
-- also now carries production's policy by name. Nothing lost either way.
--
-- The DROP ... IF EXISTS lines below are drop-then-recreate of the SAME policy,
-- so the migration can be re-run safely. They remove nothing that is not
-- immediately recreated on the next line.

BEGIN;

DROP POLICY IF EXISTS "Users can manage their own calendar events" ON public.calendar_events;
CREATE POLICY "Users can manage their own calendar events" ON public.calendar_events
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own gmail messages" ON public.gmail_messages;
CREATE POLICY "Users can manage their own gmail messages" ON public.gmail_messages
  FOR ALL USING (auth.uid() = user_id);

COMMIT;
