-- AI trader (admin only, testing): an automated trader that finds coins, buys, and sells on stop-loss / take-profit.
-- "paper" mode trades pretend BNB at real prices; "live" mode trades a dedicated wallet whose key is only in Vercel
-- (AI_TRADER_KEY). Only admins can read or change any of this; the engine uses the service role.

create table if not exists public.ai_trader_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  mode text not null default 'paper' check (mode in ('paper', 'live')),
  chain text not null default 'bsc' check (chain in ('bsc')),
  paper_cash numeric not null default 1,           -- pretend BNB available in paper mode
  paper_start numeric not null default 1,
  per_trade numeric not null default 0.05 check (per_trade > 0),   -- BNB per buy
  max_positions int not null default 3 check (max_positions between 1 and 20),
  min_liquidity numeric not null default 30000,    -- USD
  max_tax numeric not null default 10,             -- % buy or sell tax
  min_age_hours numeric not null default 1,
  stop_loss numeric not null default 20 check (stop_loss between 1 and 90),     -- % below entry
  take_profit numeric not null default 50 check (take_profit between 1 and 2000), -- % above entry
  trail numeric not null default 15 check (trail between 0 and 90),      -- % below the high once in profit (0 = off)
  max_hold_hours numeric not null default 48 check (max_hold_hours > 0),
  daily_loss_limit numeric not null default 0.2,   -- BNB lost in 24h before it pauses itself
  use_ai boolean not null default true,            -- let Claude pick among the safe candidates
  last_run timestamptz not null default 'epoch',
  last_note text,
  updated_at timestamptz not null default now()
);
insert into public.ai_trader_settings (id) values (1) on conflict do nothing;

create table if not exists public.ai_trader_positions (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('paper', 'live')),
  chain text not null,
  token text not null,
  symbol text, name text, logo text,
  status text not null default 'open' check (status in ('open', 'closing', 'closed')),
  spent numeric not null,                 -- BNB in
  qty numeric not null,                   -- tokens held
  amount_raw text,                        -- live: exact token units held
  decimals int not null default 18,
  entry_usd numeric not null,             -- token price when bought
  high_usd numeric not null,
  last_usd numeric,
  stop_loss numeric not null, take_profit numeric not null, trail numeric not null,
  why text,                               -- why it bought
  buy_tx text, sell_tx text,
  received numeric,                       -- BNB out
  pnl numeric, pnl_pct numeric,
  close_reason text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists ai_trader_positions_open on public.ai_trader_positions (status, opened_at desc);
create unique index if not exists ai_trader_one_open_per_token on public.ai_trader_positions (mode, chain, lower(token)) where status <> 'closed';

create table if not exists public.ai_trader_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,
  text text not null
);
create index if not exists ai_trader_log_at on public.ai_trader_log (at desc);

alter table public.ai_trader_settings enable row level security;
alter table public.ai_trader_positions enable row level security;
alter table public.ai_trader_log enable row level security;
drop policy if exists "ai trader admin settings" on public.ai_trader_settings;
create policy "ai trader admin settings" on public.ai_trader_settings for select using (public.is_admin());
drop policy if exists "ai trader admin positions" on public.ai_trader_positions;
create policy "ai trader admin positions" on public.ai_trader_positions for select using (public.is_admin());
drop policy if exists "ai trader admin log" on public.ai_trader_log;
create policy "ai trader admin log" on public.ai_trader_log for select using (public.is_admin());

-- One run at a time (the schedule calls every 5 minutes).
create or replace function public.ai_trader_lease(p_seconds integer) returns boolean language sql security definer set search_path to 'public' as $$
  update public.ai_trader_settings set last_run = now() where id = 1 and last_run < now() - make_interval(secs => p_seconds) returning true;
$$;
revoke all on function public.ai_trader_lease(integer) from public, anon, authenticated;
grant execute on function public.ai_trader_lease(integer) to service_role;
