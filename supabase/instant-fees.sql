-- Automatic payout of Instant coins' trading fees (app/api/launchpad/instant-fees, lib/instant-keeper.ts).
create table if not exists public.instant_keeper_state (id int primary key, last_run timestamptz not null default 'epoch');
insert into public.instant_keeper_state (id) values (1) on conflict do nothing;
alter table public.instant_keeper_state enable row level security;
create or replace function public.instant_keeper_lease(p_seconds integer) returns boolean
language sql security definer set search_path = public as $$
  update public.instant_keeper_state set last_run = now() where id = 1 and last_run < now() - make_interval(secs => p_seconds) returning true;
$$;
revoke all on function public.instant_keeper_lease(integer) from public, anon, authenticated;
grant execute on function public.instant_keeper_lease(integer) to service_role;
select cron.schedule('autistik-instant-fees', '*/30 * * * *', $$ select net.http_get('https://autistik.io/api/launchpad/instant-fees') $$);
