-- Documents base table — ensures it exists before 20260420000001_document_extraction.sql
-- which tries to ALTER it. On production the table already exists (created manually),
-- so this is a no-op there. On staging it creates it before the ALTER runs.
-- The full CREATE TABLE is in 20260420000002_documents.sql (which uses IF NOT EXISTS).

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
