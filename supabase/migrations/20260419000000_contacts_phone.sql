-- Add phone column to contacts so Global Search can match on phone numbers
-- (e.g. "find what I know about 613-555-1234"). Existing rows get NULL.
-- pg_trgm GIN index makes ILIKE queries fast even on large contact lists.

alter table public.contacts
  add column if not exists phone text;

create extension if not exists pg_trgm;

create index if not exists contacts_phone_trgm_idx
  on public.contacts using gin (phone gin_trgm_ops);
