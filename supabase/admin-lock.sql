-- =====================================================================
-- AUTISTIK Hub: lock the admin area to the owner. Safe to run more than once.
-- Supabase → SQL Editor → New query → paste all of this → put your email on the line marked ← at the bottom → Run.
--
--   1. Only emails on a private owner list can ever be admin. The list lives in a "private" schema the
--      website can't read or change, and a database rule refuses is_admin = true for anyone else,
--      even if someone gets hold of the service key or a bug tries to set it.
--   2. Admin powers need the owner's confirmed email AND a 6-digit code from an authenticator app
--      (2-step verification) in the current session. A stolen password alone isn't enough.
--   3. Internal functions can no longer be called from the website API.
-- =====================================================================

-- ---------- 1. Private owner list ----------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.admin_emails (
  email text primary key check (email = lower(btrim(email))),
  added_at timestamptz not null default now()
);
revoke all on private.admin_emails from public, anon, authenticated;

-- Nobody outside the owner list can be flagged as admin, whoever tries.
create or replace function private.admin_flag_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_admin and not exists (
    select 1 from auth.users u join private.admin_emails a on a.email = lower(u.email) where u.id = new.id
  ) then
    raise exception 'Only the Hub owner''s email can be an admin.' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function private.admin_flag_guard() from public, anon, authenticated;
drop trigger if exists admin_flag_guard on public.profiles;
create trigger admin_flag_guard before insert or update of is_admin on public.profiles
  for each row execute function private.admin_flag_guard();

-- ---------- 2. Who counts as admin ----------
-- The owner: admin flag + email on the owner list + email confirmed.
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    join auth.users u on u.id = p.id
    join private.admin_emails a on a.email = lower(u.email)
    where p.id = auth.uid() and p.is_admin and u.email_confirmed_at is not null
  );
$$;

-- Admin powers (used by every admin rule in the database): the owner, signed in with 2-step verification.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_owner() and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

revoke all on function public.is_owner() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------- 3. Internal functions: database use only ----------
-- These only run from triggers; nobody should call them through the website API.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.member_insert_guard() from public, anon, authenticated;
revoke all on function public.profile_guard() from public, anon, authenticated;
revoke all on function public.log_admin_action() from public, anon, authenticated;
alter function public.random_alias() set search_path = public;
alter function public.random_color() set search_path = public;

-- ---------- Owner email ----------
-- Put the owner's sign-in email on the line marked ← and run. To hand the Hub over later, run it again with the
-- new owner's email, then delete the old one: delete from private.admin_emails where email = 'old@example.com';
do $$
declare owner text := lower(btrim('you@example.com'));  -- ← your sign-in email
begin
  if owner <> 'you@example.com' then
    insert into private.admin_emails (email) values (owner) on conflict do nothing;
  end if;
  -- Anyone flagged admin who isn't on the list loses the flag (skipped while the list is still empty).
  if exists (select 1 from private.admin_emails) then
    update public.profiles p set is_admin = false
    where p.is_admin and not exists (
      select 1 from auth.users u join private.admin_emails a on a.email = lower(u.email) where u.id = p.id
    );
  end if;
end $$;
