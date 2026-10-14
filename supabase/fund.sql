-- =====================================================================
-- AUTISTIK Fund: "register your interest" list.
-- Already set up the Hub? Paste just this file into Supabase → SQL Editor → Run.
-- (schema.sql includes it for fresh projects.)
-- =====================================================================
create table if not exists public.fund_interest (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  country text not null,
  phone text,
  message text,
  for_someone_else boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.fund_interest enable row level security;
-- Personal details: only admins can read or delete them. The website saves new entries with the server key.
drop policy if exists "admins read fund interest" on public.fund_interest;
drop policy if exists "admins delete fund interest" on public.fund_interest;
create policy "admins read fund interest" on public.fund_interest for select to authenticated using (public.is_admin());
create policy "admins delete fund interest" on public.fund_interest for delete to authenticated using (public.is_admin());
