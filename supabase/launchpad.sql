-- =====================================================================
-- AUTISTIK Launch Pad: public list of tokens launched through the Hub.
-- Already set up the Hub? Paste just this file into Supabase → SQL Editor → Run.
-- (schema.sql includes it for fresh projects.)
-- =====================================================================

create table if not exists public.launches (
  id uuid primary key default gen_random_uuid(),
  chain text not null check (chain in ('bsc','ethereum','robinhood')),
  token text not null,
  pair text not null,
  creator text not null,
  name text not null,
  symbol text not null,
  supply numeric not null,
  tx_hash text not null unique,
  user_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists launches_created_at on public.launches (created_at desc);

alter table public.launches enable row level security;
-- Anyone can see launches. Only the server writes them, after checking the transaction on-chain.
drop policy if exists "launches public" on public.launches;
create policy "launches public" on public.launches for select using (true);
