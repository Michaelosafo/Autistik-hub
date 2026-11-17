-- Lobby (BNB Chain sniper, lib/lobby.ts). Applied as migration lobby_sniper. Server-only: RLS on, no policies.
-- The Lobby wallet key lives in Vault through ai_futures_key_set / ai_futures_key_get with id 700000 + trader id.
-- Schedule: select cron.schedule('autistik-lobby', '* * * * *', $$ select private.cron_call('https://autistik.io/api/lobby/cron', 58000) $$);
create table if not exists public.lobby_snipes (
  id bigint generated always as identity primary key,
  trader_id integer not null, token text not null, symbol text, name text, decimals integer not null default 18,
  buy_bnb numeric not null, take_x numeric not null default 2, stop_pct numeric, max_slip numeric not null default 25,
  speed text not null default 'faster', min_liq_bnb numeric not null default 0.5, max_sell_tax numeric not null default 30,
  status text not null default 'watching' check (status in ('watching','buying','holding','selling','sold','failed','cancelled')),
  pool text, quote text, attempts integer not null default 0, sell_fails integer not null default 0, simulate boolean not null default false,
  liq_block bigint, buy_block bigint, slip_used numeric, gas_gwei numeric, tokens_raw text, spent_bnb numeric, out_bnb numeric,
  buy_tax numeric, sell_tax numeric, honeypot boolean, last_x numeric, peak_x numeric, buy_tx text, sell_tx text,
  note text, log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), bought_at timestamptz, sold_at timestamptz
);
create index if not exists lobby_snipes_trader_status on public.lobby_snipes (trader_id, status);
create index if not exists lobby_snipes_status on public.lobby_snipes (status);
alter table public.lobby_snipes enable row level security;
create table if not exists public.lobby_runners (trader_id integer primary key, until timestamptz);
alter table public.lobby_runners enable row level security;
