-- T4 Pass 4 — access policies, compared by effect rather than by name.
--
-- The measurement said 35 differences. Most are not differences at all, and
-- three findings only appear once you compare what a policy DOES:
--
--   1. Postgres uses the USING expression as the write check when WITH CHECK is
--      omitted. So staging's contacts / push_subscriptions / knowledge_fragments
--      policies behave identically to production's despite reading differently.
--      No action.
--
--   2. Several production policies are redundant. A SELECT policy sitting beside
--      an ALL policy with the same expression grants nothing extra — policies are
--      permissive and OR together. knowledge_fragments and reminders both have
--      this shape. Staging lacking them is not a gap. No action.
--
--   3. One policy differs only in capitalisation of its NAME
--      ("Users can read own tokens" vs "users can read own tokens"). Not a
--      functional difference, and renaming it would be churn. No action.
--
-- What IS real, and is what this migration does:
--
--   calendar_events, gmail_messages — staging granted ALL where production
--   grants SELECT only, so on staging a signed-in user could write rows the
--   product never intends them to write. Every client access to both tables is
--   a .select (lib/calendar.ts x5, lib/gmail.ts x2, lib/contacts.ts x1);
--   writes go through Edge Functions, which run as service_role and bypass
--   policies entirely. Tightening staging therefore matches production and
--   breaks nothing.
--
--   user_tokens — production lets a user delete their own token; staging had no
--   DELETE policy at all. Added.
--
--   tickets — production's two staff policies were missing on staging, so
--   support tickets could not be read or worked there.
--
-- ── Deliberately NOT copied: the Epic policies ─────────────────────────────
-- Production has `using = true` on epic_conditions, epic_medications,
-- epic_appointments and epic_observations — any authenticated user can read
-- every user's rows. Staging correctly scopes them to auth.uid(). Copying
-- production here would import the weaker rule into staging, so parity is the
-- wrong instinct: staging is right and production is not.
--
-- Epic was discussed and trialled around April/May 2026 and postponed; the
-- Edge Functions that would populate those tables are empty folders, nothing in
-- the codebase inserts into them, and the rows on production are leftovers from
-- that trial. The client also gates all three medical reads behind
-- isEpicConnected(), which IS scoped per user, so the loose policy was never
-- reachable in the app. Left for whenever Epic is actually picked up rather
-- than changed on production at the end of a parity pass.

BEGIN;

-- ── calendar_events: read-only for clients, as on production ──────────────
DROP POLICY IF EXISTS "Users can manage their own calendar events" ON public.calendar_events;
DROP POLICY IF EXISTS "Users can read own events" ON public.calendar_events;
CREATE POLICY "Users can read own events" ON public.calendar_events
  FOR SELECT USING (auth.uid() = user_id);

-- ── gmail_messages: read-only for clients, as on production ───────────────
DROP POLICY IF EXISTS "Users can manage their own gmail messages" ON public.gmail_messages;
DROP POLICY IF EXISTS "Users can read own messages" ON public.gmail_messages;
CREATE POLICY "Users can read own messages" ON public.gmail_messages
  FOR SELECT USING (auth.uid() = user_id);

-- ── user_tokens: a user may delete their own token ────────────────────────
DROP POLICY IF EXISTS "Users can delete own tokens" ON public.user_tokens;
CREATE POLICY "Users can delete own tokens" ON public.user_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- ── tickets: staff can read and work tickets ──────────────────────────────
DROP POLICY IF EXISTS "tickets_staff_select" ON public.tickets;
DROP POLICY IF EXISTS "tickets_staff_update" ON public.tickets;
CREATE POLICY "tickets_staff_select" ON public.tickets
  FOR SELECT USING ((auth.jwt() ->> 'email'::text) = ANY (ARRAY['mynaavi2207@gmail.com'::text, 'wael@mynaavi.com'::text]));
CREATE POLICY "tickets_staff_update" ON public.tickets
  FOR UPDATE USING ((auth.jwt() ->> 'email'::text) = ANY (ARRAY['mynaavi2207@gmail.com'::text, 'wael@mynaavi.com'::text]));

COMMIT;
