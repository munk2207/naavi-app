-- 2026-05-20 (Wael) — F6a Phase 1: mini AI-triage support system.
-- Foundation seeded by the B4j incident the same day (Hussein reported
-- empty "work todo" alert via informal channel; Wael relayed; Claude
-- investigated; Wael approved; Claude sent scoped reply).
--
-- Phase 1 = storage + manual flow. Auto-triage (Phase 2), admin UI
-- (Phase 3), and pattern detection (Phase 4) deferred until Phase 1
-- proves the data model.
--
-- Two entry points write to the same table:
--   1. External — `ingest-ticket` Edge Function called by Formspree
--      webhook on every form submission from /report, /contact,
--      mobile bug report. source_channel column captures which.
--   2. Internal — Wael (or team) creates a ticket manually via Claude
--      command when a user reports via SMS / verbal / voice / etc.
--      source_channel = 'internal-relay'.
--
-- Status lifecycle: new → investigating → drafted → approved → sent →
-- closed. Plus 'cancelled' as a terminal state for abandoned tickets.
-- Approval gates outbound per the CLAUDE.md "no unverified claims in
-- outbound" rule (2026-05-20).

-- ────────────────────────────────────────────────────────────────────
-- 1. Sequence for human-friendly ticket numbers.
--    Starts at 1000 so the first ticket is #1000 (avoids two-digit
--    ambiguity when grepping logs).
-- ────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS tickets_number_seq START 1000;

-- ────────────────────────────────────────────────────────────────────
-- 2. tickets table.
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number          INTEGER UNIQUE NOT NULL DEFAULT nextval('tickets_number_seq'),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Entry point classification — drives investigation playbook.
  source_channel         TEXT NOT NULL
                         CHECK (source_channel IN (
                           'formspree-report',     -- /report form on website (Formspree mpqkkdep)
                           'formspree-contact',    -- /contact form on website (Formspree xgorryye)
                           'formspree-invitation', -- /start invitation form (Formspree xvzdkjod)
                           'mobile-report',        -- mobile /report screen (Formspree mpqkkdep)
                           'mobile-contact',       -- mobile /contact screen (Formspree xgorryye)
                           'internal-relay',       -- Wael creates manually via Claude
                           'voice-call'            -- future: caller reports via Twilio voice
                         )),

  -- Reporter identity (best-effort; not all sources resolve a user_id).
  user_id                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reporter_email         TEXT,                -- captured from form OR resolved from user_id
  reporter_phone         TEXT,                -- best-effort, for SMS-channel replies
  reporter_name          TEXT,

  -- Content.
  subject                TEXT NOT NULL,
  body                   TEXT NOT NULL,
  severity               TEXT
                         CHECK (severity IN (
                           'urgent', 'important', 'annoying', 'suggestion', 'question'
                         )),

  -- Lifecycle.
  status                 TEXT NOT NULL DEFAULT 'new'
                         CHECK (status IN (
                           'new', 'investigating', 'drafted', 'approved',
                           'sent', 'closed', 'cancelled'
                         )),

  -- Cross-link to holding-list inventory (B / F / T / I IDs).
  -- Multiple tickets can link to the same holding-list item (pattern detection).
  linked_holding_id      TEXT,

  -- Draft response gate — populated during investigation phase.
  draft_response         TEXT,
  draft_response_channel TEXT
                         CHECK (draft_response_channel IN ('sms', 'email', 'whatsapp', 'voice')),

  -- Approval gate — must be set before outbound fires.
  approved_by            TEXT,
  approved_at            TIMESTAMPTZ,

  -- Outbound tracking.
  sent_at                TIMESTAMPTZ,
  sent_message_sid       TEXT,    -- Twilio SID for SMS/voice, email message id for email

  -- Append-only audit trail. Every state transition logs here as a
  -- jsonb object: { at: timestamptz, actor: 'wael' | 'naavi' | 'system',
  -- from_status: text, to_status: text, note: text }.
  audit_trail            JSONB NOT NULL DEFAULT '[]'::jsonb,

  CONSTRAINT tickets_subject_not_empty CHECK (length(btrim(subject)) > 0),
  CONSTRAINT tickets_body_not_empty    CHECK (length(btrim(body)) > 0)
);

-- ────────────────────────────────────────────────────────────────────
-- 3. Indexes — optimized for the most common queries.
-- ────────────────────────────────────────────────────────────────────
-- Open tickets only (status not in terminal states). Most queries hit
-- this set ("show me open tickets", "any new ones?").
CREATE INDEX IF NOT EXISTS idx_tickets_status_open
  ON tickets(status, created_at DESC)
  WHERE status NOT IN ('sent', 'closed', 'cancelled');

-- User-side lookup (future: user sees their own tickets via /support
-- page or via SMS).
CREATE INDEX IF NOT EXISTS idx_tickets_user_id
  ON tickets(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Recency view (admin dashboard / pattern detection).
CREATE INDEX IF NOT EXISTS idx_tickets_created
  ON tickets(created_at DESC);

-- Cross-link to holding list for pattern detection — "show me all
-- tickets that linked to B4j over the last 7 days".
CREATE INDEX IF NOT EXISTS idx_tickets_linked_holding
  ON tickets(linked_holding_id, created_at DESC)
  WHERE linked_holding_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────
-- 4. updated_at trigger — refreshed on every UPDATE.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tickets_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_updated_at_trigger ON tickets;
CREATE TRIGGER tickets_updated_at_trigger
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION tickets_set_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- 5. RLS — Edge Functions (service_role) own all writes. Users can
--    SELECT their own tickets (future self-status feature).
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- Service role: full access. Used by ingest-ticket + future
-- triage-ticket / admin Edge Functions.
DROP POLICY IF EXISTS tickets_service_role_all ON tickets;
CREATE POLICY tickets_service_role_all ON tickets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: SELECT their own tickets only. Lets a future
-- /support page or "show me my tickets" mobile screen work without
-- exposing other users' reports.
DROP POLICY IF EXISTS tickets_user_select_own ON tickets;
CREATE POLICY tickets_user_select_own ON tickets
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────────
-- 6. Documentation comments — visible in pg_dump / Supabase Studio.
-- ────────────────────────────────────────────────────────────────────
COMMENT ON TABLE tickets IS
  '2026-05-20 (F6a Phase 1) — mini AI-triage support system. Tickets from form submissions OR internal-relay creation, with status lifecycle gated by human approval before outbound. See docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md F6a for design.';
COMMENT ON COLUMN tickets.source_channel IS
  'Entry point classification — drives investigation playbook and which Formspree project the ticket came from.';
COMMENT ON COLUMN tickets.linked_holding_id IS
  'Cross-link to holding-list ID (B / F / T / I). Multiple tickets can link to the same item — surfaces pattern detection in Phase 4.';
COMMENT ON COLUMN tickets.audit_trail IS
  'Append-only jsonb array of state transitions. Each entry: { at, actor, from_status, to_status, note }.';
