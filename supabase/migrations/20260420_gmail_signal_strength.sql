-- Signal strength within tier-1 Gmail — sub-ranks tier-1 emails by how
-- confident we are they matter. Separate from is_tier1 (binary) because
-- Gmail's IMPORTANT / CATEGORY_PERSONAL labels can misfire on non-contact
-- senders (LinkedIn notifications, newsletters flagged IMPORTANT, etc.).
--
--   strong  — sender email is in the user's contacts (Robert's choice)
--   ambient — Gmail labelled it IMPORTANT or CATEGORY_PERSONAL, sender
--             not in contacts (Gmail's ML judgement only)
--   NULL    — not tier-1 (is_tier1 = false)
--
-- Consumers:
--   - Gmail adapter in Global Search boosts strong hits by +0.1.
--   - Future morning-brief refinements can prefer strong over ambient.

alter table public.gmail_messages
  add column if not exists signal_strength text check (signal_strength in ('strong', 'ambient'));

-- Partial index: only strong tier-1 rows are hot-read by the adapter
-- (ambient rows still searchable, just not separately indexed).
create index if not exists gmail_messages_strong_idx
  on public.gmail_messages (user_id, signal_strength)
  where signal_strength = 'strong';
