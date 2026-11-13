-- AI trader: live buys that weren't confirmed in time (already applied to the Autistik-hub project).
-- The trader re-checks the wallet each minute: if the coins arrived after all, it records them as a normal trade so
-- stop-loss / take profit manage them (no coins left unwatched).
create table if not exists public.ai_trader_pending (
  id bigserial primary key,
  trader_id int not null default 1,
  chain text not null,
  token text not null,
  symbol text, name text, logo text,
  wallet int not null default 1,
  entry_usd numeric, entry_mcap numeric,
  spent_native numeric, native text,
  sl numeric not null, tp numeric not null,
  why text, strategy text not null default 'copy',
  source_group text, source_who text,
  created_at timestamptz not null default now(),
  unique (trader_id, chain, token, wallet)
);
alter table public.ai_trader_pending enable row level security;
