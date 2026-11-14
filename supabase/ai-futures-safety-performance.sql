-- AI Futures: never-get-liquidated guard and per-trade impact. (Applied.)
alter table public.ai_futures_settings add column if not exists no_liq boolean not null default true;
alter table public.ai_futures_positions add column if not exists risk_usd numeric;
alter table public.ai_futures_positions add column if not exists equity_at_open numeric;
