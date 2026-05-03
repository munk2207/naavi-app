-- V57.10.5 — extend sent_messages.channel CHECK constraint to allow
-- 'voice' and 'push' values.
--
-- Why: V57.10.2 added voice-call tracking to sent_messages so callVoice()
-- in report-location-event would write a row alongside SMS / WhatsApp /
-- email rows. Insert silently failed because the existing CHECK
-- constraint only permits ('sms', 'whatsapp', 'email'). Discovered
-- 2026-05-03 when querying for voice rows returned zero despite real
-- voice calls firing.
--
-- 'push' is added at the same time so future push-tracking work has a
-- clean schema (currently push notifications are not logged anywhere
-- in sent_messages, but parity is the goal).

ALTER TABLE public.sent_messages
  DROP CONSTRAINT IF EXISTS sent_messages_channel_check;

ALTER TABLE public.sent_messages
  ADD CONSTRAINT sent_messages_channel_check
  CHECK (channel IN ('sms', 'whatsapp', 'email', 'voice', 'push'));
