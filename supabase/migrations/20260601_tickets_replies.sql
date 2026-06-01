-- Ticket replies thread — 2026-06-01
--
-- Stores the full conversation between customer and staff as an append-only
-- JSONB array. Each entry: { at, from_email, from_name, direction, body, message_id }
-- direction: 'inbound' (customer) | 'outbound' (staff)
--
-- assigned_to: staff email currently handling the ticket.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS replies     JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assigned_to TEXT;
