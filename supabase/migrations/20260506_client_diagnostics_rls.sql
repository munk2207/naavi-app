-- V57.11.6 — RLS hotfix for client_diagnostics. Wael 2026-05-06: Supabase
-- Security Advisor flagged the table as "RLS Disabled in Public" + "Sensitive
-- Columns Exposed" because diagnostic payloads can contain user message
-- excerpts (textHead, textTail), session IDs, and other state.
--
-- Without RLS, anyone holding the public anon key could SELECT all rows
-- across all users. The table is reachable through the auto-generated REST
-- API even though we never intended that path — Supabase's default behavior
-- exposes any table that doesn't explicitly opt out via RLS.
--
-- Fix:
--   1. Enable RLS on the table.
--   2. SELECT policy — users can read only their own rows (user_id = auth.uid())
--      OR rows with NULL user_id (legacy / pre-auth diagnostic events).
--   3. NO public INSERT policy — writes go through the `remote-log` Edge
--      Function which uses the service role key (bypasses RLS).
--   4. service_role retains full access (default behavior, no policy needed).
--
-- After this migration:
--   - Mobile app continues writing via remote-log → still works (service role)
--   - Diagnostic scripts using SUPABASE_SERVICE_ROLE_KEY → still work
--   - Public anon key SELECT attempts → blocked except for the user's own rows
--   - Other users cannot read each other's diagnostic data

ALTER TABLE client_diagnostics ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own rows (matched by user_id), plus any
-- row with NULL user_id (pre-auth diagnostic events from app cold-start).
CREATE POLICY client_diagnostics_select_own
  ON client_diagnostics
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Anonymous (public anon key) gets no access at all. The remote-log Edge
-- Function uses service_role internally, which bypasses RLS, so writes
-- continue to flow regardless of the caller's auth state.
-- (No policy for anon = anon cannot read or write.)

-- Optional: explicit deny for anon would be:
--   CREATE POLICY client_diagnostics_anon_deny ON client_diagnostics
--     FOR ALL TO anon USING (false);
-- but the absence of a permissive policy already produces the same result.
