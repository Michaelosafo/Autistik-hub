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

-- ---------- pinned tokens: buy / take-profit / sell / wait alerts, and phone push ----------
create table if not exists public.token_pins (
  user_id uuid not null references auth.users on delete cascade,
  chain text not null, token text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, chain, token),
  foreign key (chain, token) references public.tracked_tokens on delete cascade
);
create index if not exists token_pins_token on public.token_pins (chain, token);
create table if not exists public.token_signals (
  chain text not null, token text not null,
  horizon text not null check (horizon in ('short','long')),
  state text not null check (state in ('buy','take_profit','sell','wait','avoid')),
  reason text,
  changed_at timestamptz not null default now(),
  notified_at timestamptz,
  primary key (chain, token, horizon),
  foreign key (chain, token) references public.tracked_tokens on delete cascade
);
create table if not exists public.push_subscriptions (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) < 1000),
  p256dh text not null check (length(p256dh) < 200),
  auth text not null check (length(auth) < 100),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.token_pins enable row level security;
alter table public.token_signals enable row level security;
alter table public.push_subscriptions enable row level security;
drop policy if exists "own pins" on public.token_pins;
create policy "own pins" on public.token_pins for select to authenticated using (user_id = auth.uid());
drop policy if exists "signals public" on public.token_signals;
create policy "signals public" on public.token_signals for select to anon, authenticated using (true);
-- Pins and devices are only written by the server (after sign-in checks); members can read their own pins.
revoke all on public.token_pins, public.token_signals, public.push_subscriptions from anon, authenticated;
grant select on public.token_pins to authenticated;
grant select on public.token_signals to anon, authenticated;
revoke all on sequence public.push_subscriptions_id_seq from anon, authenticated;

-- ---------- buy / sell zones for pinned tokens ----------
alter table public.token_signals drop constraint if exists token_signals_horizon_check;
alter table public.token_signals add constraint token_signals_horizon_check check (horizon in ('short','long','zone'));
alter table public.token_signals add column if not exists detail jsonb;  -- price, buy range, sell range, strength

-- ---------- AUTISTIK Pro (paid in $AUTISTIK) and the signal track record ----------
create table if not exists public.pro_passes (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  tx_hash text not null unique check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  payer text not null,
  amount numeric not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists pro_passes_user on public.pro_passes (user_id, ends_at desc);
alter table public.pro_passes enable row level security;
drop policy if exists "own pro" on public.pro_passes;
create policy "own pro" on public.pro_passes for select to authenticated using (user_id = auth.uid());
grant select on public.pro_passes to authenticated;

-- Every buy/sell zone change with its price; graded with the price 24 hours later.
create table if not exists public.signal_history (
  id bigserial primary key,
  chain text not null, token text not null,
  kind text not null check (kind in ('buy','sell','falling','middle','breakout','avoid')),
  price numeric not null,
  at timestamptz not null default now(),
  outcome_price numeric,
  outcome_at timestamptz,
  foreign key (chain, token) references public.tracked_tokens on delete cascade
);
create index if not exists signal_history_token on public.signal_history (chain, token, at desc);
create index if not exists signal_history_open on public.signal_history (at) where outcome_price is null;
alter table public.signal_history enable row level security;
drop policy if exists "history public" on public.signal_history;
create policy "history public" on public.signal_history for select to anon, authenticated using (true);
grant select on public.signal_history to anon, authenticated;

-- ---------- site activity (admin only): visits and what members do ----------
-- Visits store the page, a random visitor id (cookie), country and device type. No IP addresses.
create table if not exists public.page_views (
  id bigserial primary key,
  at timestamptz not null default now(),
  path text not null check (length(path) <= 300),
  visitor text not null check (length(visitor) <= 64),
  user_id uuid references auth.users on delete set null,
  country text check (country is null or length(country) <= 8),
  device text check (device in ('phone','tablet','computer')),
  referrer text check (referrer is null or length(referrer) <= 200)
);
create index if not exists page_views_at on public.page_views (at desc);
alter table public.page_views enable row level security;  -- no policies: only the server reads or writes it
create table if not exists public.activity_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references auth.users on delete set null,
  kind text not null check (length(kind) <= 30),
  label text check (label is null or length(label) <= 200),
  link text check (link is null or link ~ '^/[A-Za-z0-9/_-]*$')
);
create index if not exists activity_log_at on public.activity_log (at desc);
alter table public.activity_log enable row level security;  -- no policies: only the server reads or writes it

-- The numbers for Admin → Site activity, counted in the database so they stay right at any size.
create or replace function public.site_stats() returns jsonb
language sql security definer set search_path = public as $$
  with v as (select * from page_views where at > now() - interval '14 days'),
  w as (select * from v where at > now() - interval '7 days'),
  t as (select * from v where at > now() - interval '1 day'),
  g as (select regexp_replace(regexp_replace(regexp_replace(path, '^/analytics/[a-z]+/[A-Za-z0-9]+$', '/analytics/(a token)'), '^/launchpad/[a-z]+/[A-Za-z0-9]+$', '/launchpad/(a token)'), '^/members/.+$', '/members/(a member)') p from w)
  select jsonb_build_object(
    'today_views', (select count(*) from t),
    'today_people', (select count(distinct visitor) from t),
    'week_views', (select count(*) from w),
    'week_people', (select count(distinct visitor) from w),
    'week_signed', (select count(distinct user_id) from w where user_id is not null),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'views', c, 'people', p) order by d), '[]') from (
       select gs::date::text d, (select count(*) from v where at::date = gs::date) c, (select count(distinct visitor) from v where at::date = gs::date) p
       from generate_series((now() - interval '13 days')::date, now()::date, interval '1 day') gs) x),
    'pages', (select coalesce(jsonb_agg(jsonb_build_array(p, c)), '[]') from (select p, count(*) c from g group by p order by c desc limit 10) x),
    'countries', (select coalesce(jsonb_agg(jsonb_build_array(country, c)), '[]') from (select country, count(*) c from w where country is not null group by country order by c desc limit 8) x),
    'devices', (select coalesce(jsonb_agg(jsonb_build_array(device, c)), '[]') from (select device, count(*) c from w where device is not null group by device order by c desc) x),
    'referrers', (select coalesce(jsonb_agg(jsonb_build_array(referrer, c)), '[]') from (select referrer, count(*) c from w where referrer is not null group by referrer order by c desc limit 6) x)
  );
$$;
revoke all on function public.site_stats() from public, anon, authenticated;

-- The token's logo (from DexScreener), saved when it's scanned.
alter table public.tracked_tokens add column if not exists image_url text check (image_url is null or (image_url ~ '^https://' and length(image_url) < 600));
