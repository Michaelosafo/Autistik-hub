-- AUTISTIK Staking: where the contract lives on each chain, and pools the admin hid from the list.
create table if not exists public.staking_contracts (chain text primary key, address text not null, deployed_at timestamptz not null default now());
alter table public.staking_contracts enable row level security;
create policy "staking contracts are public" on public.staking_contracts for select using (true);
create table if not exists public.staking_hidden (chain text not null, pool_id integer not null, hidden_at timestamptz not null default now(), primary key (chain, pool_id));
alter table public.staking_hidden enable row level security;
create policy "hidden pools are public" on public.staking_hidden for select using (true);
revoke insert, update, delete, truncate on public.staking_contracts, public.staking_hidden from anon, authenticated;
