-- BnbRage shared by the owner and every helper admin: one set of wallets and one CA list for everyone.
-- Private keys stay in the Vault (ai_copy_key_set / _get with id 900001, the same functions the sniper uses);
-- these tables only hold the public side. Server (service role) only: RLS on, no policies.
create table if not exists public.rage_team_wallets (
  slot integer primary key check (slot between 1 and 13),
  address text not null,
  label text,
  added_by text,
  created_at timestamptz not null default now()
);
create table if not exists public.rage_team_cas (
  address text primary key,
  name text,
  symbol text,
  added_by text,
  current boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.rage_team_log (
  id bigint generated always as identity primary key,
  who text,
  what text not null,
  tx text,
  created_at timestamptz not null default now()
);
alter table public.rage_team_wallets enable row level security;
alter table public.rage_team_cas enable row level security;
alter table public.rage_team_log enable row level security;
revoke all on public.rage_team_wallets, public.rage_team_cas, public.rage_team_log from anon, authenticated;
