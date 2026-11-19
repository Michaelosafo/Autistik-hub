-- Sniper: each wallet's own snipe amount per chain, in that chain's coin.
-- { "1": { "bsc": 0.05, "solana": 0.5 }, "3": { "base": 0.01 } }. Run once in the Supabase SQL editor.
alter table public.ai_futures_settings add column if not exists snipe_amounts jsonb not null default '{}'::jsonb;
