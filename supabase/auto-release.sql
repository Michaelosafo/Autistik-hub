-- AUTISTIK Hub: automatic release of due locks and locked liquidity. Safe to run more than once.
-- A keeper checks every 5 minutes and sends due tokens/liquidity straight to their owners' wallets.
create table if not exists public.release_keeper_state (id int primary key default 1 check (id = 1), last_run timestamptz not null default 'epoch');
insert into public.release_keeper_state (id) values (1) on conflict do nothing;
alter table public.release_keeper_state enable row level security;
create or replace function public.release_keeper_lease(p_seconds integer) returns boolean
language sql security definer set search_path = public as $$
  update public.release_keeper_state set last_run = now() where id = 1 and last_run < now() - make_interval(secs => p_seconds) returning true;
$$;
revoke all on function public.release_keeper_lease(integer) from public, anon, authenticated;
grant execute on function public.release_keeper_lease(integer) to service_role;
create extension if not exists pg_cron;
select cron.schedule('autistik-release', '*/5 * * * *', $$ select net.http_get('https://autistik.io/api/lockers/cron') $$);
