-- Launch Pad v3 (BNB Chain, Ethereum, Robinhood Chain…): every new token's address ends in "AAAAA".
-- The address depends only on a salt (CREATE2), so the server finds salts ahead of time
-- (app/api/launchpad/grind-evm, every 5 minutes, keeps 10 ready per Launch Pad) and each launch takes one; the Hub
-- signs the salt into the creator's permit so only that creator can use it.

-- Which version each chain's Launch Pad is (2 = before addresses ending in "aaaaa", 3 = with them).
alter table public.launchpad_contracts add column if not exists version integer not null default 2;

-- The Launch Pad each token was launched from, so older tokens keep working (liquidity release, promotion,
-- source verification) after a chain moves to a newer Launch Pad.
alter table public.launches add column if not exists pad text;
update public.launches l set pad = c.address
  from public.launchpad_contracts c
  where l.pad is null and l.source = 'launchpad' and l.chain <> 'solana' and c.chain = l.chain and c.address !~* '^0x0{40}$';

create table if not exists public.evm_vanity_salts (
  salt text primary key,
  chain text not null,
  pad text not null,
  token text not null,
  created_at timestamptz not null default now()
);
create index if not exists evm_vanity_salts_pad on public.evm_vanity_salts (chain, pad);
alter table public.evm_vanity_salts enable row level security;
revoke all on public.evm_vanity_salts from public, anon, authenticated;

-- Takes one ready salt for a Launch Pad (each is handed out once, even when two launches start at the same moment).
create or replace function public.take_vanity_salt(p_chain text, p_pad text) returns table (salt text, token text) language sql security definer set search_path to 'public' as $$
  delete from public.evm_vanity_salts v
  where v.salt = (select s.salt from public.evm_vanity_salts s where s.chain = p_chain and s.pad = p_pad order by s.created_at limit 1 for update skip locked)
  returning v.salt, v.token;
$$;
revoke all on function public.take_vanity_salt(text, text) from public, anon, authenticated;
grant execute on function public.take_vanity_salt(text, text) to service_role;

-- The search runs at most once every 4 minutes however often the URL is called.
create table if not exists public.evm_vanity_state (id int primary key default 1 check (id = 1), last_run timestamptz not null default 'epoch');
insert into public.evm_vanity_state (id) values (1) on conflict do nothing;
alter table public.evm_vanity_state enable row level security;
revoke all on public.evm_vanity_state from public, anon, authenticated;
create or replace function public.evm_vanity_lease(p_seconds integer) returns boolean language sql security definer set search_path to 'public' as $$
  update public.evm_vanity_state set last_run = now() where id = 1 and last_run < now() - make_interval(secs => p_seconds) returning true;
$$;
revoke all on function public.evm_vanity_lease(integer) from public, anon, authenticated;
grant execute on function public.evm_vanity_lease(integer) to service_role;

select cron.schedule('autistik-evm-vanity', '*/5 * * * *', $$ select net.http_get('https://autistik.io/api/launchpad/grind-evm') $$);
