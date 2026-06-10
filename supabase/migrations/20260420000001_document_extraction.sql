-- Extraction fields on documents — populated by extract-document-text
-- (Claude Haiku reads the PDF text layer and returns structured facts).
-- Phase 1 of A3: PDFs only, no OCR. Phase 2 (future) adds Google Vision OCR.
--
-- Why on documents and not email_actions:
--   - email_actions represents the email-level action (bill to pay,
--     appointment to confirm). Its vendor/date/amount come from the email
--     BODY.
--   - The PDF attachment often has its OWN amount, date, reference that
--     differs from the body (especially for multi-invoice emails, or
--     where the body is a cover letter).
--   - Keeping them separate lets Global Search rank both sources.

alter table public.documents
  add column if not exists extracted_at timestamptz,
  add column if not exists extracted_summary text,
  add column if not exists extracted_amount_cents integer,
  add column if not exists extracted_currency text,
  add column if not exists extracted_date timestamptz,
  add column if not exists extracted_reference text,
  add column if not exists extracted_expiry timestamptz,
  add column if not exists extraction_error text;

-- Index for future queries like "find documents expiring in the next 30 days"
create index if not exists documents_extracted_expiry_idx
  on public.documents (user_id, extracted_expiry)
  where extracted_expiry is not null;
