-- Email actions — structured data extracted from tier-1 emails by Claude.
-- One row per email (rows created only when an action was detected).
-- Morning brief reads from here, not from raw gmail_messages.

create table if not exists public.email_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gmail_message_id text not null,
  action_type text,
  title text,
  vendor text,
  amount_cents integer,
  currency text,
  due_date timestamptz,
  urgency text,
  summary text,
  extracted_at timestamptz default now(),
  dismissed boolean default false,
  created_at timestamptz default now(),
  unique (user_id, gmail_message_id)
);

create index if not exists email_actions_user_due_idx
  on public.email_actions (user_id, due_date) where dismissed = false;

alter table public.email_actions enable row level security;

create policy "Users see own email actions"
  on public.email_actions for select
  using (auth.uid() = user_id);

create policy "Service role manages email actions"
  on public.email_actions for all
  using (auth.jwt() ->> 'role' = 'service_role');
