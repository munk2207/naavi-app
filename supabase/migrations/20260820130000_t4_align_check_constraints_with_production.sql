-- T4 — two CHECK constraints on staging accept fewer values than production.
--
-- Found 2026-08-20 by comparing the two environments at definition level. Both
-- constraints exist in both places with the same name, so a name-level
-- comparison called them identical. They are not: production accepts values
-- staging rejects, and an INSERT that succeeds in production fails in staging.
--
--   email_actions.document_type — production accepts 'calendar', staging does
--   not. CLAUDE.md documents eleven document types including 'calendar' (a
--   recurring schedule listing many dated events — a school year, a sports
--   season). The attachment pipeline classifies one, tries to store it, and the
--   insert is rejected. It happens inside a fire-and-forget call, so nothing
--   surfaces the failure.
--
--   tickets.source_channel — production accepts 'web-report', 'web-contact' and
--   'web-invitation'; staging rejects all three. A ticket raised from the
--   website cannot be stored on staging.
--
-- Both lists are set to production's exactly, so this is a no-op if it is ever
-- applied to production. Nothing is dropped from either list — staging gains
-- values, loses none, and no existing row can be invalidated.

BEGIN;

ALTER TABLE public.email_actions
  DROP CONSTRAINT IF EXISTS email_actions_document_type_check;

ALTER TABLE public.email_actions
  ADD CONSTRAINT email_actions_document_type_check
  CHECK (document_type = ANY (ARRAY[
    'invoice'::text,
    'warranty'::text,
    'receipt'::text,
    'contract'::text,
    'medical'::text,
    'statement'::text,
    'tax'::text,
    'ticket'::text,
    'notice'::text,
    'calendar'::text,
    'other'::text
  ]));

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_source_channel_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_source_channel_check
  CHECK (source_channel = ANY (ARRAY[
    'formspree-report'::text,
    'formspree-contact'::text,
    'formspree-invitation'::text,
    'web-report'::text,
    'web-contact'::text,
    'web-invitation'::text,
    'mobile-report'::text,
    'mobile-contact'::text,
    'internal-relay'::text,
    'voice-call'::text
  ]));

COMMIT;
