-- Insider (admin): calls from X, Telegram, Reddit and DexScreener, caller scores, and paper or live buys
-- from the owner's sniper wallets. Service role only. Run once in the Supabase SQL editor.
-- Schedule (same helper as the futures cron, which sends CRON_SECRET):
-- select cron.schedule('autistik-insider', '* * * * *', $$ select private.cron_call('https://autistik.io/api/insider/cron', 55000) $$);

create table if not exists public.insider_settings (
  id int primary key default 1 check (id = 1),
  killed boolean not null default false,
  dry_run boolean not null default true,
  tg_offset bigint not null default 0,
  last_run timestamptz,
  last_note text,
  updated_at timestamptz not null default now()
);
insert into public.insider_settings (id) values (1) on conflict do nothing;

create table if not exists public.insider_sources (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('x', 'telegram', 'reddit', 'dex')),
  handle text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, handle)
);

create table if not exists public.insider_rules (
  id bigint generated always as identity primary key,
  caller text,
  source_id bigint references public.insider_sources (id) on delete cascade,
  min_score numeric not null default 60,
  chains text[] not null default array['bsc','ethereum','base','arbitrum','solana'],
  max_buy_usd numeric not null default 25,
  wallets int[] not null default array[1],
  max_per_hour int not null default 4,
  min_liq_usd numeric not null default 15000,
  max_tax_pct numeric not null default 10,
  max_age_min numeric not null default 180,
  tp_multiple numeric not null default 2,
  sl_pct numeric not null default 40,
  max_hold_min numeric not null default 360,
  partial_pct numeric,
  enabled boolean not null default true
);
insert into public.insider_rules (caller, min_score, enabled)
select null, 60, true
where not exists (select 1 from public.insider_rules where caller is null and source_id is null);

create table if not exists public.insider_calls (
  id bigint generated always as identity primary key,
  source_kind text not null,
  who text not null,
  chain text not null,
  token text not null,
  symbol text,
  pool text,
  url text,
  posted_at timestamptz not null,
  price_usd numeric,
  liq_usd numeric,
  pool_at timestamptz,
  max_1h numeric,
  max_6h numeric,
  max_24h numeric,
  multiple numeric,
  hit_2x boolean,
  early_min numeric,
  peaks jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_kind, who, chain, token, posted_at)
);
create index if not exists insider_calls_who on public.insider_calls (who, posted_at desc);

create table if not exists public.insider_positions (
  id bigint generated always as identity primary key,
  call_id bigint,
  chain text not null,
  token text not null,
  symbol text,
  wallet_slot int,
  wallet text,
  mode text not null check (mode in ('paper', 'live')),
  entry_usd numeric not null,
  size_usd numeric not null,
  remaining_pct numeric not null default 100,
  tx text,
  exit_tx text,
  status text not null default 'open',
  exit_usd numeric,
  pnl_usd numeric,
  reason text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  tp_multiple numeric not null default 2,
  sl_pct numeric not null default 40,
  max_hold_min numeric not null default 360,
  partial_pct numeric,
  took_partial boolean not null default false
);
create index if not exists insider_positions_open on public.insider_positions (status, opened_at desc);

create table if not exists public.insider_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  text text not null
);

alter table public.insider_settings enable row level security;
alter table public.insider_sources enable row level security;
alter table public.insider_rules enable row level security;
alter table public.insider_calls enable row level security;
alter table public.insider_positions enable row level security;
alter table public.insider_log enable row level security;
