-- AI Futures: its own Solana wallet (key kept in Vault) + automatic funding. Applied as migration "ai_futures_solana_wallet".
alter table public.ai_futures_settings add column if not exists auto_fund boolean not null default true;
alter table public.ai_futures_settings add column if not exists fund_at timestamptz;
-- public.ai_futures_sol_key_get(p_id integer) returns text            -- reads Vault secret 'ai_futures_sol_key_' || p_id
-- public.ai_futures_sol_key_set(p_id integer, p_key text, p_replace boolean default false)
--   key must be a 64-byte JSON array; replaces an existing key only when p_replace. Both: service role only.
