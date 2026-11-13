-- AI trader: trade in stablecoins (Solana: buys with USDC, sells back into USDC). Off by default. (Applied.)
alter table public.ai_trader_settings add column if not exists stable_on boolean not null default false;
