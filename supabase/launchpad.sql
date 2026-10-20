-- =====================================================================
-- AUTISTIK Launch Pad: public list of tokens launched through the Hub.
-- Already set up the Hub? Paste just this file into Supabase → SQL Editor → Run.
-- (schema.sql includes it for fresh projects.)
-- =====================================================================

create table if not exists public.launches (
  id uuid primary key default gen_random_uuid(),
  chain text not null check (chain in ('bsc','ethereum','base','arbitrum','robinhood','solana')),
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
-- Liquidity choice: 'burn' (forever), '6m' or '1y' (locked in the Launch Pad contract until lp_unlock_at).
alter table public.launches add column if not exists lp_lock text not null default 'burn' check (lp_lock in ('burn','6m','1y'));
alter table public.launches add column if not exists lp_unlock_at timestamptz;
-- Where a token came from: 'launchpad' (launched here) or 'listed' (launched elsewhere, paid to be listed and trend).
alter table public.launches add column if not exists source text not null default 'launchpad' check (source in ('launchpad','listed'));

-- Every chain the Launch Pad supports (projects set up before Base, Arbitrum and Solana: this widens the old list).
alter table public.launches drop constraint if exists launches_chain_check;
alter table public.launches add constraint launches_chain_check check (chain in ('bsc','ethereum','base','arbitrum','robinhood','solana'));

alter table public.launches enable row level security;
-- Anyone can see launches. Only the server writes them, after checking the transaction on-chain.
drop policy if exists "launches public" on public.launches;
create policy "launches public" on public.launches for select using (true);

-- ---------- Watchlist: members star tokens; everyone sees how many people watch each one ----------
create table if not exists public.launch_watchers (
  user_id uuid not null references auth.users on delete cascade,
  chain text not null,
  token text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, chain, token)
);
alter table public.launch_watchers enable row level security;
drop policy if exists "see own watchlist" on public.launch_watchers;
drop policy if exists "watch" on public.launch_watchers;
drop policy if exists "unwatch" on public.launch_watchers;
create policy "see own watchlist" on public.launch_watchers for select to authenticated using (user_id = auth.uid());
create policy "watch" on public.launch_watchers for insert to authenticated with check (user_id = auth.uid());
create policy "unwatch" on public.launch_watchers for delete to authenticated using (user_id = auth.uid());

-- Counts only, never who is watching.
create or replace view public.launch_watch_counts as
  select chain, token, count(*)::int as watchers from public.launch_watchers group by chain, token;
grant select on public.launch_watch_counts to anon, authenticated;

-- ---------- Paid trending: one row per payment, checked on-chain by the server ----------
-- plan 100 = paid in BNB to the treasury wallet (see app/api/trending/pay). Older plans 0/1 were USDT via the contract.
create table if not exists public.launch_promotions (
  id uuid primary key default gen_random_uuid(),
  chain text not null,
  token text not null,
  plan int not null,
  price numeric not null,
  payer text not null,
  tx_hash text not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists launch_promotions_ends_at on public.launch_promotions (ends_at desc);
alter table public.launch_promotions enable row level security;
drop policy if exists "promotions public" on public.launch_promotions;
create policy "promotions public" on public.launch_promotions for select using (true);
