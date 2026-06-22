-- user_tokens: stores Google OAuth refresh tokens server-side so Edge Functions
-- can call Google APIs (Drive, Calendar, Gmail) on behalf of the user without
-- requiring the user to be online. Created manually in production (never migrated);
-- this migration codifies the schema for staging and future environments.

CREATE TABLE IF NOT EXISTS public.user_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    text NOT NULL,
  refresh_token text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

-- RLS: only service role can read/write (Edge Functions run as service role)
ALTER TABLE public.user_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only"
  ON public.user_tokens
  FOR ALL
  USING (auth.role() = 'service_role');
