-- =====================================================================
-- AUTISTIK Hub: Admin → Everything happening. Safe to run more than once.
-- Supabase → SQL Editor → New query → paste all of this → Run.
--
--   1. Swaps and liquidity in the activity log keep their chain and transaction, so the admin page can link to them.
--   2. admin_accounts(): sign-ups, last sign-ins and who has turned on their authenticator app, for the admin page.
--   3. admin_cron_health(): when each scheduled job last ran and whether it worked.
-- Both functions can only be called by the website's server (service key), never from a browser.
-- The admin page works without this file, it just shows less.
-- =====================================================================

-- ---------- 1. Chain and transaction on activity rows ----------
alter table public.activity_log add column if not exists chain text check (chain is null or chain ~ '^[a-z]{2,12}$');
alter table public.activity_log add column if not exists tx text check (tx is null or tx ~ '^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,90})$');
create index if not exists activity_log_kind_at on public.activity_log (kind, at desc);

-- ---------- 2. Accounts ----------
create or replace function public.admin_accounts(p_limit int default 500) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total', (select count(*) from auth.users),
    'confirmed', (select count(*) from auth.users where email_confirmed_at is not null),
    'joined_1d', (select count(*) from auth.users where created_at > now() - interval '1 day'),
    'joined_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'signed_1d', (select count(*) from auth.users where last_sign_in_at > now() - interval '1 day'),
    'signed_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'with_2fa', (select count(distinct user_id) from auth.mfa_factors where status = 'verified'),
    'rows', (select coalesce(jsonb_agg(r order by r.sort desc), '[]') from (
      select u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null as confirmed,
             (select min(f.updated_at) from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as mfa_at,
             p.alias, greatest(u.created_at, coalesce(u.last_sign_in_at, u.created_at)) as sort
      from auth.users u left join public.profiles p on p.id = u.id
      order by greatest(u.created_at, coalesce(u.last_sign_in_at, u.created_at)) desc
      limit greatest(1, least(p_limit, 2000))
    ) r)
  );
$$;
revoke all on function public.admin_accounts(int) from public, anon, authenticated;
grant execute on function public.admin_accounts(int) to service_role;

-- ---------- 3. Scheduled jobs ----------
create or replace function public.admin_cron_health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
    'last_at', d.start_time, 'last_status', d.status, 'last_error', left(d.return_message, 200),
    'fails_24h', (select count(*) from cron.job_run_details x where x.jobid = j.jobid and x.status = 'failed' and x.start_time > now() - interval '1 day')
  ) order by j.jobname), '[]')
  from cron.job j
  left join lateral (select start_time, status, return_message from cron.job_run_details r where r.jobid = j.jobid order by start_time desc limit 1) d on true;
$$;
revoke all on function public.admin_cron_health() from public, anon, authenticated;
grant execute on function public.admin_cron_health() to service_role;

-- ---------- Check it worked ----------
select (public.admin_accounts(1)) ->> 'total' as members, jsonb_array_length(public.admin_cron_health()) as scheduled_jobs;
