-- Per-chat buy size: $ to spend on each call from this Telegram channel / group (null or 0 = the normal size).
-- Run after ai-trader-copy.sql / ai-trader-tg-account.sql.
alter table public.ai_trader_sources add column if not exists usd numeric check (usd is null or (usd >= 0 and usd <= 100000));
