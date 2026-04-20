-- Document-type metadata on email_actions — A1 from the Gmail/attachment
-- roadmap (extract-email-actions already classifies sender_type; this adds
-- document classification so future searches can hit "find my warranty" and
-- attachment harvesting (A2) has somewhere canonical to land.
--
-- Why extend email_actions rather than add a new documents table:
--   - Some emails are both actionable AND retention-worthy (a bill is an
--     invoice to pay + a receipt to keep).
--   - One adapter, one search surface, one UI card — less cross-table work.
--   - Reversible later if shapes diverge.
--
-- Columns:
--   document_type — what the email/attachment is about (invoice, warranty…)
--   reference     — free-text identifier Claude extracts (invoice number,
--                   policy number, case id) — short text so we can search it.
--   expiry_date   — when the document stops being relevant (warranty end,
--                   policy expiry). Separate from due_date (which is when
--                   an action must be taken).

alter table public.email_actions
  add column if not exists document_type text
    check (document_type in ('invoice','warranty','receipt','contract','medical','statement','tax','ticket','notice','other')),
  add column if not exists reference text,
  add column if not exists expiry_date timestamptz;

-- Partial index on expiry_date — we'll want to surface upcoming expirations
-- ("Your insurance expires in 18 days") without scanning the whole table.
create index if not exists email_actions_expiry_idx
  on public.email_actions (user_id, expiry_date)
  where expiry_date is not null and dismissed = false;
