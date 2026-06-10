-- F1d step 2 — hosted replies (token-keyed content store)
--
-- When the user mutes Naavi mid-reply on a phone call ("no sound" / "quiet" /
-- "shh") and then confirms "yes" to "Want me to text the rest to your phone?",
-- the voice-server saves the full response content here under a random token.
-- The SMS the user receives carries a `mynaavi.com/r/<token>` hot link that
-- renders the content via the get-hosted-reply Edge Function. Token IS the
-- auth — anyone with the link can read. Trade-off accepted per F1d spec:
-- security-vs-friction tilted toward friction-free reading.
--
-- TTL: 30 days. Stale rows are not auto-deleted by a cron yet (could be added
-- later); the read endpoint filters by expires_at so users never see expired
-- content even if rows linger.

CREATE TABLE IF NOT EXISTS hosted_replies (
  token       text         PRIMARY KEY,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question    text         NOT NULL,
  content     text         NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  expires_at  timestamptz  NOT NULL DEFAULT (now() + interval '30 days'),
  CONSTRAINT hosted_replies_token_len        CHECK (length(token) >= 16 AND length(token) <= 64),
  CONSTRAINT hosted_replies_content_nonempty CHECK (length(content) > 0),
  CONSTRAINT hosted_replies_expires_future   CHECK (expires_at > created_at)
);

-- Read-path index: get-hosted-reply does `WHERE token = $1 AND expires_at > now()`.
-- Token is the PK so lookup is O(1); the partial index keeps the read fast even
-- as old rows accumulate.
CREATE INDEX IF NOT EXISTS idx_hosted_replies_expires_at
  ON hosted_replies (expires_at);

-- RLS: service-role only. Clients never touch this table directly — they go
-- through the get-hosted-reply / save-hosted-reply Edge Functions. The token
-- itself is the access credential.
ALTER TABLE hosted_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY hosted_replies_service_role_all
  ON hosted_replies
  FOR ALL
  USING (auth.role() = 'service_role');
