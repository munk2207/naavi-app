-- 2026-05-21 (Wael) — F6a Phase 2 prep: stable refs to HubSpot ticket + contact.
-- Previously the HubSpot IDs were buried as free text inside audit_trail
-- entries written by ingest-ticket. analyze-ticket (drafter) needs the
-- HubSpot ticket id to post an Internal Note via /crm/v3/objects/notes,
-- and regex-parsing audit_trail text is fragile (breaks if the note
-- wording ever changes).
--
-- This migration adds dedicated columns. ingest-ticket is updated in
-- parallel to populate them at create time. Existing rows backfilled
-- from the audit_trail text in-place.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS hubspot_ticket_id  TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS last_drafted_at    TIMESTAMPTZ;

-- Index for analyze-ticket lookups (and future HubSpot webhook handlers
-- that need to find the Naavi ticket by HubSpot id).
CREATE INDEX IF NOT EXISTS idx_tickets_hubspot_ticket_id
  ON tickets(hubspot_ticket_id)
  WHERE hubspot_ticket_id IS NOT NULL;

-- Backfill from existing audit_trail entries. The note format set by
-- ingest-ticket since 2026-05-20:
--   "HubSpot ticket 197084975045 created (contact 259967850489) — ..."
-- Only updates rows where the columns are still NULL (idempotent).
WITH parsed AS (
  SELECT
    t.id,
    (regexp_matches(entry->>'note', 'HubSpot ticket (\d+) created \(contact (\d+)\)'))[1] AS hs_ticket,
    (regexp_matches(entry->>'note', 'HubSpot ticket (\d+) created \(contact (\d+)\)'))[2] AS hs_contact
  FROM tickets t,
       jsonb_array_elements(t.audit_trail) AS entry
  WHERE entry->>'note' LIKE 'HubSpot ticket %created (contact %)%'
)
UPDATE tickets t
SET hubspot_ticket_id  = p.hs_ticket,
    hubspot_contact_id = p.hs_contact
FROM parsed p
WHERE t.id = p.id
  AND t.hubspot_ticket_id IS NULL;

COMMENT ON COLUMN tickets.hubspot_ticket_id IS
  'HubSpot Service Hub ticket id (12-digit numeric, stored as TEXT). Populated by ingest-ticket after successful HubSpot ticket creation. Used by analyze-ticket to post Internal Notes via /crm/v3/objects/notes.';
COMMENT ON COLUMN tickets.hubspot_contact_id IS
  'HubSpot CRM contact id associated with the ticket (find-or-create by reporter_email). Stable cross-reference for the customer.';
COMMENT ON COLUMN tickets.last_drafted_at IS
  'Timestamp of the most recent analyze-ticket draft note posted to HubSpot. Drives reanalyze-on-reply scheduling (only re-draft when new customer engagement exceeds this timestamp).';
