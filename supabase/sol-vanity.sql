-- Solana Launch Pad: token addresses that end in "tik" (like pump.fun's "pump"). The server finds them ahead of time
-- (app/api/launchpad/solana/grind, every 5 minutes, keeps about 20 ready) and each launch takes one
-- (lib/solana-vanity.ts). Only the mint's 32-byte seed is stored; it's used once to create the token and is then
-- deleted. Server only: no one else can read or write this table.
create table if not exists public.sol_vanity_mints (
  pubkey text primary key,
  seed text not null,
  created_at timestamptz not null default now()
);
alter table public.sol_vanity_mints enable row level security;
revoke all on public.sol_vanity_mints from public, anon, authenticated;

-- Takes one ready address (each is handed out once, even when two launches start at the same moment).
create or replace function public.take_vanity_mint() returns table (pubkey text, seed text) language sql security definer set search_path to 'public' as $$
  delete from public.sol_vanity_mints v
  where v.pubkey = (select pubkey from public.sol_vanity_mints order by created_at limit 1 for update skip locked)
  returning v.pubkey, v.seed;
$$;
revoke all on function public.take_vanity_mint() from public, anon, authenticated;
grant execute on function public.take_vanity_mint() to service_role;

-- The search runs at most once every 4 minutes however often the URL is called.
create table if not exists public.sol_vanity_state (id int primary key default 1 check (id = 1), last_run timestamptz not null default 'epoch');
insert into public.sol_vanity_state (id) values (1) on conflict do nothing;
alter table public.sol_vanity_state enable row level security;
revoke all on public.sol_vanity_state from public, anon, authenticated;
create or replace function public.vanity_lease(p_seconds integer) returns boolean language sql security definer set search_path to 'public' as $$
  update public.sol_vanity_state set last_run = now() where id = 1 and last_run < now() - make_interval(secs => p_seconds) returning true;
$$;
revoke all on function public.vanity_lease(integer) from public, anon, authenticated;
grant execute on function public.vanity_lease(integer) to service_role;

select cron.schedule('autistik-sol-vanity', '*/5 * * * *', $$ select net.http_get('https://autistik.io/api/launchpad/solana/grind') $$);
