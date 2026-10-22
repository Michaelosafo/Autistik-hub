-- =====================================================================
-- AUTISTIK Hub: every account needs 2-step verification. Safe to run more than once.
-- Run this AFTER the website update that adds the Account security page is live.
-- Supabase → SQL Editor → New query → paste all of this → Run.
--
-- The website already sends members to /security until they've added an authenticator app and typed its code.
-- This makes the database say the same thing, so nobody can get around the page by calling the database directly:
--   1. A signed-in account can't post, edit, delete or change anything until it has entered its 6-digit code
--      in this session (Supabase calls that "aal2").
--   2. An account's private things (its linked wallet, alerts, pins, passes, reports) can't be read without it either.
-- Visitors who aren't signed in see exactly what they saw before. The website's server and the admin tools aren't affected.
-- =====================================================================

set client_min_messages = warning;

-- True when this session has passed 2-step verification.
create or replace function public.has_2fa() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;
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
-- Removes their authenticator so they can sign in with email + password and add a new one:
--   delete from auth.mfa_factors where user_id = (select id from auth.users where email = lower('member@example.com'));

-- ---------- To undo this file ----------
--   do $$ declare r record; begin
--     for r in select tablename, policyname from pg_policies where schemaname = 'public' and policyname like '2-step:%' loop
--       execute format('drop policy %I on public.%I', r.policyname, r.tablename);
--     end loop; end $$;
