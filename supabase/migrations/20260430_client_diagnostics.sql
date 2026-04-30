-- client_diagnostics — temporary diagnostic table for the V57.9.x 90-second
-- chat-hang investigation. The mobile app fires fire-and-forget POSTs to the
-- `remote-log` Edge Function at every step of the chat send pipeline. Each
-- row records: which step ran, ms elapsed since the user tapped Send, and
-- optional small payload (error message, response size, etc.).
--
-- Once the hang is diagnosed and fixed, this table can be truncated or
-- dropped. The instrumentation in the orchestrator is intentionally cheap
-- enough to leave in place for future regressions.
--
-- No RLS — writes go through the `remote-log` Edge Function with the service
-- role key. The function does basic shape validation (session_id + step
-- required) but does not require auth, so the phone can log even when its
-- JWT refresh is stuck (which is the whole point).

CREATE TABLE IF NOT EXISTS client_diagnostics (
  id              BIGSERIAL    PRIMARY KEY,
  user_id         UUID         NULL,
  session_id      TEXT         NOT NULL,
  step            TEXT         NOT NULL,
  ms_since_start  INTEGER      NULL,
  payload         JSONB        NULL,
  build_version   TEXT         NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_diagnostics_session_idx
  ON client_diagnostics (session_id, created_at);

CREATE INDEX IF NOT EXISTS client_diagnostics_user_created_idx
  ON client_diagnostics (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS client_diagnostics_created_idx
  ON client_diagnostics (created_at DESC);
