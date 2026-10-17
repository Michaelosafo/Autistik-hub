-- =====================================================================
-- AUTISTIK Hub: Analytics. Safe to run more than once. Run after hardening.sql.
-- Supabase → SQL Editor → New query → paste all of this → Run.
--   Every token launched here or scanned on the Analytics page keeps a record of its top 40 wallets and its dev
--   wallet. Every 10 minutes the site re-checks their balances; when one sells (or moves tokens out) it's saved as
--   an event, and members watching that token get a notification.
--   Everything here is public blockchain data, so anyone can read it. Only the server writes it.
-- =====================================================================

create table if not exists public.tracked_tokens (
  chain text not null check (chain in ('bsc', 'ethereum')),
  token text not null check (token ~ '^0x[0-9a-fA-F]{40}$'),
  name text, symbol text,
  decimals int not null default 18,
  total_supply numeric,
  dev text check (dev is null or dev ~ '^0x[0-9a-fA-F]{40}$'),
  dev_source text,                 -- launchpad | creator | owner
  security jsonb,                  -- honeypot, taxes, mintable ... (from GoPlus)
  holder_source text,              -- moralis (top 40) | goplus (top 10)
  added_by uuid references auth.users on delete set null,
  added_at timestamptz not null default now(),
  snapshot_at timestamptz,         -- when the top-40 list was last refreshed
  checked_at timestamptz,          -- when balances were last re-checked
  viewed_at timestamptz not null default now(),
  primary key (chain, token)
);

create table if not exists public.token_holders (
  chain text not null,
  token text not null,
  wallet text not null check (wallet ~ '^0x[0-9a-fA-F]{40}$'),
  rank int,
  balance numeric not null default 0,
  pct numeric,
  peak_balance numeric not null default 0,
  is_contract boolean not null default false,
  label text,
  is_dev boolean not null default false,
  in_top boolean not null default true,
  first_seen_at timestamptz not null default now(),
  acquired_at timestamptz,
  last_change_at timestamptz,
  primary key (chain, token, wallet),
  foreign key (chain, token) references public.tracked_tokens on delete cascade
);

create table if not exists public.holder_events (
  id bigserial primary key,
  chain text not null,
  token text not null,
  wallet text not null,
  kind text not null check (kind in ('sell', 'exit', 'buy')),
  amount numeric not null,
  pct_of_holding numeric,
  balance_after numeric,
  is_dev boolean not null default false,
  held_since timestamptz,
  created_at timestamptz not null default now(),
  foreign key (chain, token) references public.tracked_tokens on delete cascade
);
create index if not exists holder_events_recent on public.holder_events (created_at desc);
create index if not exists holder_events_token on public.holder_events (chain, token, created_at desc);

-- "Connected wallets" for the bubble map: wallet a sent this token to wallet b.
create table if not exists public.token_links (
  chain text not null,
  token text not null,
  a text not null,
  b text not null,
  kind text not null,              -- funded (b's first tokens came from a) | moved | transfer
  amount numeric,
  created_at timestamptz not null default now(),
  primary key (chain, token, a, b),
  foreign key (chain, token) references public.tracked_tokens on delete cascade
);

create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  title text not null,
  body text,
  link text check (link is null or link ~ '^/[A-Za-z0-9/_-]*$'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);

-- One row: when the checker last ran, and how many paid API calls were used today.
create table if not exists public.analytics_state (
  id int primary key default 1 check (id = 1),
  last_run timestamptz not null default 'epoch',
  day date not null default current_date,
  api_calls int not null default 0
);
insert into public.analytics_state (id) values (1) on conflict do nothing;

-- ---------- who can see what ----------
alter table public.tracked_tokens enable row level security;
alter table public.token_holders enable row level security;
alter table public.holder_events enable row level security;
alter table public.notifications enable row level security;
alter table public.analytics_state enable row level security;
alter table public.token_links enable row level security;
drop policy if exists "links public" on public.token_links;
create policy "links public" on public.token_links for select to anon, authenticated using (true);

drop policy if exists "tracked public" on public.tracked_tokens;
create policy "tracked public" on public.tracked_tokens for select to anon, authenticated using (true);
drop policy if exists "holders public" on public.token_holders;
create policy "holders public" on public.token_holders for select to anon, authenticated using (true);
drop policy if exists "events public" on public.holder_events;
create policy "events public" on public.holder_events for select to anon, authenticated using (true);
drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "mark own read" on public.notifications;
create policy "mark own read" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.tracked_tokens, public.token_holders, public.holder_events, public.token_links, public.notifications, public.analytics_state from anon, authenticated;
grant select on public.tracked_tokens, public.token_holders, public.holder_events, public.token_links to anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke all on sequence public.holder_events_id_seq, public.notifications_id_seq from anon, authenticated;

-- ---------- server helpers ----------
-- The checker runs at most once every p_seconds, however often it's called.
create or replace function public.analytics_lease(p_seconds int) returns boolean
language sql security definer set search_path = public as $$
  update public.analytics_state set last_run = now()
  where id = 1 and last_run < now() - make_interval(secs => p_seconds)
  returning true;
$$;
-- Paid holder-list calls are capped per day, so the bill can't run away.
create or replace function public.analytics_budget(p_calls int, p_limit int) returns boolean
language sql security definer set search_path = public as $$
  update public.analytics_state
  set api_calls = (case when day = current_date then api_calls else 0 end) + p_calls, day = current_date
  where id = 1 and (case when day = current_date then api_calls else 0 end) + p_calls <= p_limit
  returning true;
$$;
revoke all on function public.analytics_lease(int), public.analytics_budget(int, int) from public, anon, authenticated;

-- ---------- every 10 minutes: re-check the wallets ----------
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.schedule('autistik-analytics', '*/10 * * * *', $$ select net.http_get('https://autistik.io/api/analytics/cron') $$);

-- ---------- live trades: every buy and sell through the token's main pool ----------
alter table public.tracked_tokens add column if not exists pair text, add column if not exists last_block bigint, add column if not exists trades_at timestamptz;
create table if not exists public.token_trades (
  chain text not null, token text not null,
  tx_hash text not null, log_index int not null,
  wallet text not null, side text not null check (side in ('buy', 'sell')),
  amount numeric not null, balance_after numeric, pct_after numeric,
  block bigint, at timestamptz not null default now(),
  primary key (chain, tx_hash, log_index),
  foreign key (chain, token) references public.tracked_tokens on delete cascade
);
create index if not exists token_trades_recent on public.token_trades (chain, token, at desc);
alter table public.token_trades enable row level security;
drop policy if exists "trades public" on public.token_trades;
create policy "trades public" on public.token_trades for select to anon, authenticated using (true);
revoke all on public.token_trades from anon, authenticated;
grant select on public.token_trades to anon, authenticated;

-- ---------- more chains: Base, Robinhood Chain and Solana ----------
alter table public.tracked_tokens drop constraint if exists tracked_tokens_chain_check;
alter table public.tracked_tokens add constraint tracked_tokens_chain_check check (chain in ('bsc','ethereum','base','robinhood','solana'));
alter table public.tracked_tokens drop constraint if exists tracked_tokens_token_check;
alter table public.tracked_tokens add constraint tracked_tokens_token_check check (token ~ '^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$');
alter table public.tracked_tokens drop constraint if exists tracked_tokens_dev_check;
alter table public.tracked_tokens add constraint tracked_tokens_dev_check check (dev is null or dev ~ '^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$');
alter table public.token_holders drop constraint if exists token_holders_wallet_check;
alter table public.token_holders add constraint token_holders_wallet_check check (wallet ~ '^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$');
-- Solana keeps each wallet's tokens in a separate "token account"; remembering it makes balance checks one cheap read.
alter table public.token_holders add column if not exists token_account text check (token_account is null or token_account ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$');

-- ---------- even more chains ----------
alter table public.tracked_tokens drop constraint if exists tracked_tokens_chain_check;
alter table public.tracked_tokens add constraint tracked_tokens_chain_check check (chain in ('bsc','ethereum','base','robinhood','solana','arbitrum','polygon','avalanche','optimism','sonic','berachain','monad','unichain','abstract','linea','blast'));
