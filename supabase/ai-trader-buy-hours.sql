-- AI trader: buy hours. Run once in Supabase SQL Editor.
-- The times of day each admin's trader may buy, in that admin's own time zone. Off by default (buys any time).
-- Selling (stop-loss, take profit, trailing stop) is never limited by these hours.
alter table public.ai_trader_settings add column if not exists buy_hours_on boolean not null default false;
alter table public.ai_trader_settings add column if not exists buy_from text not null default '00:00';
alter table public.ai_trader_settings add column if not exists buy_to text not null default '23:59';
alter table public.ai_trader_settings add column if not exists buy_tz text not null default 'UTC';
