-- AUTISTIK Susu reminders: plans members opened on BNB Chain (contracts/AutistikSusu.sol). The money lives in the
-- contract; this only remembers whom to remind (app/api/susu, hourly).
create table if not exists public.susu_plans (
  id bigint primary key,                 -- the plan's id in the Susu contract
  user_id uuid not null references auth.users(id) on delete cascade,
  owner text not null,
  token text not null,
  daily numeric not null,
  total_days integer not null,
  start_at timestamptz not null,
  withdrawn boolean not null default false,
  reminded_on date,
  ready_notified boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists susu_plans_active on public.susu_plans (withdrawn);
alter table public.susu_plans enable row level security;
revoke all on public.susu_plans from public, anon, authenticated;
grant all on public.susu_plans to service_role;

create table if not exists public.susu_state (id int primary key default 1 check (id = 1), last_run timestamptz not null default 'epoch');
insert into public.susu_state (id) values (1) on conflict do nothing;
alter table public.susu_state enable row level security;
revoke all on public.susu_state from public, anon, authenticated;
create or replace function public.susu_lease(p_seconds integer) returns boolean language sql security definer set search_path to 'public' as $$
  update public.susu_state set last_run = now() where id = 1 and last_run < now() - make_interval(secs => p_seconds) returning true;
$$;
revoke all on function public.susu_lease(integer) from public, anon, authenticated;
grant execute on function public.susu_lease(integer) to service_role;

select cron.schedule('autistik-susu', '7 * * * *', $$ select net.http_get('https://autistik.io/api/susu') $$);
