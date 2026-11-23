-- Server wallets per deploy page: 'bsc' = BnbRage (team), 'ethereum' = EthRise, 'robinhood' = WanaRobinhood,
-- 'solana' = LobbySol (owner only). Existing rows stay BnbRage.
alter table public.rage_team_wallets add column if not exists grp text not null default 'bsc';
alter table public.rage_team_cas add column if not exists grp text not null default 'bsc';
alter table public.rage_team_log add column if not exists grp text not null default 'bsc';

alter table public.rage_team_wallets drop constraint if exists rage_team_wallets_pkey;
alter table public.rage_team_wallets add primary key (grp, slot);
alter table public.rage_team_cas drop constraint if exists rage_team_cas_pkey;
alter table public.rage_team_cas add primary key (grp, address);
create index if not exists rage_team_log_grp_id on public.rage_team_log (grp, id desc);
