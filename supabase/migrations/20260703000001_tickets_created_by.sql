-- B8b — track which staffer manually created a ticket, separate from
-- source_channel (which describes how the customer originally contacted
-- support, not who entered the ticket record).
--
-- NULL = ticket was created automatically by the system (web form,
-- mobile app, or the real live voice-call "I need help" flow).
-- Non-NULL = the staff member's email who manually logged the ticket.
--
-- Used by send-ticket-reply to decide the reply channel: if created_by
-- is set, always reply by email (a staffer typing this in after the fact
-- has no live-call urgency, and email is already required to create any
-- ticket). Only real system-created voice-call tickets should ever get
-- an SMS reply.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS created_by text;
