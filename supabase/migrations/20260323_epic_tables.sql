-- Epic FHIR Integration Tables
-- Phase 9 — March 2026
--
-- Run this in Supabase Dashboard → SQL Editor
--
-- Tables:
--   epic_tokens       — OAuth tokens per user (one row per user)
--   epic_medications  — MedicationRequest resources
--   epic_appointments — Appointment resources
--   epic_observations — Observation resources (vitals + labs)
--   epic_conditions   — Condition resources (diagnoses)

-- ── epic_tokens ───────────────────────────────────────────────────────────────

create table if not exists public.epic_tokens (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  access_token   text        not null,
  refresh_token  text,
  expires_at     timestamptz not null,
  patient_id     text,
  scope          text        default '',
  updated_at     timestamptz not null default now(),

  constraint epic_tokens_user_id_unique unique (user_id)
);

alter table public.epic_tokens enable row level security;

create policy "Users can read own Epic tokens"
  on public.epic_tokens for select
  using (auth.uid() = user_id);

-- Edge Functions use service role key — no RLS policy needed for writes

-- ── epic_medications ──────────────────────────────────────────────────────────

create table if not exists public.epic_medications (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  fhir_id     text        not null,
  name        text        not null,
  dosage      text        default '',
  start_date  date,
  status      text        default 'active',
  raw         jsonb,
  updated_at  timestamptz not null default now(),

  constraint epic_medications_user_fhir_unique unique (user_id, fhir_id)
);

alter table public.epic_medications enable row level security;

create policy "Users can read own Epic medications"
  on public.epic_medications for select
  using (auth.uid() = user_id);

-- ── epic_appointments ─────────────────────────────────────────────────────────

create table if not exists public.epic_appointments (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  fhir_id     text        not null,
  title       text        not null,
  start_iso   timestamptz,
  location    text        default '',
  status      text        default 'booked',
  raw         jsonb,
  updated_at  timestamptz not null default now(),

  constraint epic_appointments_user_fhir_unique unique (user_id, fhir_id)
);

alter table public.epic_appointments enable row level security;

create policy "Users can read own Epic appointments"
  on public.epic_appointments for select
  using (auth.uid() = user_id);

-- ── epic_observations ─────────────────────────────────────────────────────────

create table if not exists public.epic_observations (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  fhir_id     text        not null,
  code        text        not null,
  value       text        default '',
  date        date,
  category    text        default 'unknown',
  raw         jsonb,
  updated_at  timestamptz not null default now(),

  constraint epic_observations_user_fhir_unique unique (user_id, fhir_id)
);

alter table public.epic_observations enable row level security;

create policy "Users can read own Epic observations"
  on public.epic_observations for select
  using (auth.uid() = user_id);

-- ── epic_conditions ───────────────────────────────────────────────────────────

create table if not exists public.epic_conditions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  fhir_id     text        not null,
  name        text        not null,
  onset_date  date,
  status      text        default 'active',
  raw         jsonb,
  updated_at  timestamptz not null default now(),

  constraint epic_conditions_user_fhir_unique unique (user_id, fhir_id)
);

alter table public.epic_conditions enable row level security;

create policy "Users can read own Epic conditions"
  on public.epic_conditions for select
  using (auth.uid() = user_id);
