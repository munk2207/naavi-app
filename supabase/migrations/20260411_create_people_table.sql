-- People table — structured contacts saved via ADD_CONTACT action
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  relationship text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS: users can only see/modify their own contacts
alter table public.people enable row level security;

create policy "Users can read own people"
  on public.people for select
  using (auth.uid() = user_id);

create policy "Users can insert own people"
  on public.people for insert
  with check (auth.uid() = user_id);

create policy "Users can update own people"
  on public.people for update
  using (auth.uid() = user_id);

create policy "Users can delete own people"
  on public.people for delete
  using (auth.uid() = user_id);
