-- AI Futures: every transfer in (Solana / Arbitrum → Hyperliquid) and out (withdrawals), with Relay status.
-- Applied as migration "ai_futures_transfers". Service role only (RLS on, no policies).
create table if not exists public.ai_futures_transfers (
  id bigserial primary key, fut_id integer not null default 1, at timestamptz not null default now(),
  dir text not null check (dir in ('in','out')), route text not null, amount_usd numeric, symbol text,
  from_addr text, to_addr text, request_id text, status text not null default 'sending',
  receive_usd numeric, fee_usd numeric, detail text, updated_at timestamptz not null default now()
);
create index if not exists ai_futures_transfers_fut_at on public.ai_futures_transfers (fut_id, at desc);
alter table public.ai_futures_transfers enable row level security;
revoke all on public.ai_futures_transfers from anon, authenticated;
