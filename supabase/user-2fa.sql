-- =====================================================================
-- AUTISTIK Hub: 2-step verification for members who turn it on. Safe to run more than once.
-- Supabase → SQL Editor → New query → paste all of this → Run.
--
-- 2-step verification (a code from an authenticator app) is optional. Members who turn it on must type the code
-- at every sign-in; the website asks for it on /security. This makes the database say the same thing, so a stolen
-- password can't be used to get around the page by calling the database directly:
--   1. An account with 2-step verification can't post, edit, delete or change anything until it has entered its
--      6-digit code in this session (Supabase calls that "aal2").
--   2. Nor can it read its private things (linked wallet, alerts, pins, passes, reports) without the code.
-- Accounts without 2-step verification, and visitors who aren't signed in, work exactly as before.
-- The website's server and the admin tools aren't affected (admin already always needs the code).
-- =====================================================================

set client_min_messages = warning;

-- True when this session may act: the account has no authenticator app, or it typed the code this session.
create or replace function public.has_2fa() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;
revoke all on function public.has_2fa() from public;
grant execute on function public.has_2fa() to anon, authenticated;

do $$
declare
  t text;
  -- Tables holding an account's own private things: reading them needs the code too.
  private_tables text[] := array['wallets', 'notifications', 'token_pins', 'pro_passes', 'ai_passes', 'fund_interest',
                                 'practitioner_applications', 'reports', 'push_subscriptions', 'momentum_alerts'];
begin
  -- Every table that signed-in members can change today.
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists "2-step: add" on public.%I', t);
    execute format('drop policy if exists "2-step: change" on public.%I', t);
    execute format('drop policy if exists "2-step: remove" on public.%I', t);
    execute format('drop policy if exists "2-step: read" on public.%I', t);
    -- "as restrictive": these sit on top of the existing rules, they never grant anything new.
    execute format('create policy "2-step: add" on public.%I as restrictive for insert to authenticated with check ((select public.has_2fa()))', t);
    execute format('create policy "2-step: change" on public.%I as restrictive for update to authenticated using ((select public.has_2fa())) with check ((select public.has_2fa()))', t);
    execute format('create policy "2-step: remove" on public.%I as restrictive for delete to authenticated using ((select public.has_2fa()))', t);
    if t = any(private_tables) then
      execute format('create policy "2-step: read" on public.%I as restrictive for select to authenticated using ((select public.has_2fa()))', t);
    end if;
  end loop;
end $$;

-- ---------- Check it worked ----------
-- Lists the new rules (4 per private table, 3 per other table).
select tablename, policyname, cmd from pg_policies where schemaname = 'public' and policyname like '2-step:%' order by 1, 2;

-- ---------- If a member loses their phone (run on its own, only after checking it's really them) ----------
-- Removes their authenticator so they can sign in with email + password (and add a new one if they like):
--   delete from auth.mfa_factors where user_id = (select id from auth.users where email = lower('member@example.com'));

-- ---------- To undo this file ----------
--   do $$ declare r record; begin
--     for r in select tablename, policyname from pg_policies where schemaname = 'public' and policyname like '2-step:%' loop
--       execute format('drop policy %I on public.%I', r.policyname, r.tablename);
--     end loop; end $$;
