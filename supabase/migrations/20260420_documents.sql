-- Documents table — records every attachment Naavi harvests from Gmail into
-- the user's own Google Drive. Phase 1 stores metadata only; Phase 2 (A3)
-- will read text-layer PDFs via Claude; Phase 3 (OCR) will OCR scanned ones.
--
-- Each row links an email (gmail_message_id) and optionally its extracted
-- email_action (email_action_id) to the Drive file so retrieval can surface
-- "your brake warranty PDF from Nov 2025" without scanning email bodies.
--
-- Ownership: drive_file_id is created with `drive.file` scope under the
-- user's own MyNaavi/Documents/<document_type>/ folder. Naavi never stores
-- the binary — just the Drive pointer + metadata.

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gmail_message_id text,
  email_action_id uuid references public.email_actions(id) on delete set null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  document_type text,
  drive_file_id text,
  drive_web_view_link text,
  source text default 'gmail_attachment',
  created_at timestamptz default now(),
  unique (user_id, drive_file_id)
);

create index if not exists documents_user_created_idx
  on public.documents (user_id, created_at desc);

create index if not exists documents_user_doctype_idx
  on public.documents (user_id, document_type)
  where document_type is not null;

alter table public.documents enable row level security;

create policy "Users see own documents"
  on public.documents for select
  using (auth.uid() = user_id);

create policy "Service role manages documents"
  on public.documents for all
  using (auth.jwt() ->> 'role' = 'service_role');
