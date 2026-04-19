-- Naavi tier-1 classification for Gmail messages. Separate from Gmail's own
-- IMPORTANT label — this is our curation (sender in contacts OR Gmail
-- IMPORTANT/PERSONAL AND not marketing). Feeds into email_actions (morning
-- brief) and the Gmail adapter for Global Search.

alter table public.gmail_messages
  add column if not exists is_tier1 boolean default false;

-- Partial index: we only ever filter for is_tier1 = true; false is the
-- default/majority, no need to index.
create index if not exists gmail_messages_tier1_idx
  on public.gmail_messages (user_id, is_tier1) where is_tier1 = true;
