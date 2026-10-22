-- =====================================================================
-- AUTISTIK Hub: security add-ons. Safe to run more than once.
-- Supabase → SQL Editor → New query → paste all of this → Run.
--   1. Rate limits (stops people hammering the site's forms and payment checks)
--   2. Members can't fake post times or flood the feed
--   3. Admin log: every admin action is recorded
-- =====================================================================

-- ---------- 1. Rate limits (only the server uses these) ----------
create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits int not null
);
alter table public.rate_limits enable row level security;
-- No policies: only the server can touch it.

-- Counts one hit for `p_key`. Returns true while there have been at most `p_limit` hits in the last `p_window` seconds.
create or replace function public.hit_rate_limit(p_key text, p_limit int, p_window int) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int; fresh boolean;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window) then now() else r.window_start end
  returning hits into n;
  -- Tidy up old rows now and then.
  if random() < 0.01 then delete from public.rate_limits where window_start < now() - interval '1 day'; end if;
  return n <= p_limit;
end; $$;
revoke all on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;

-- ---------- 2. Members can't fake times, and can't flood the feed ----------
-- Times are always set by the database for things members create (so nobody can pin a post to the top
-- by dating it in the future). Admin tools and the server are not affected.
create or replace function public.member_insert_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'group_members' then
    new.joined_at := now();
    return new;
  end if;
  new.created_at := now();
  if tg_table_name = 'posts' then
    if not public.is_admin() then new.hidden := false; end if;
    if (select count(*) from public.posts where author_id = auth.uid() and created_at > now() - interval '1 minute') >= 5 then
      raise exception 'Slow down a little: you can post 5 times a minute.' using errcode = 'P0001';
    end if;
    if (select count(*) from public.posts where author_id = auth.uid() and created_at > now() - interval '1 day') >= 100 then
      raise exception 'You''ve reached today''s limit of 100 posts. Come back tomorrow.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists member_insert_guard on public.posts;
create trigger member_insert_guard before insert on public.posts for each row execute function public.member_insert_guard();
drop trigger if exists member_insert_guard on public.hearts;
create trigger member_insert_guard before insert on public.hearts for each row execute function public.member_insert_guard();
drop trigger if exists member_insert_guard on public.reports;
create trigger member_insert_guard before insert on public.reports for each row execute function public.member_insert_guard();
drop trigger if exists member_insert_guard on public.rsvps;
create trigger member_insert_guard before insert on public.rsvps for each row execute function public.member_insert_guard();
drop trigger if exists member_insert_guard on public.group_members;
create trigger member_insert_guard before insert on public.group_members for each row execute function public.member_insert_guard();

-- Members can only report a post once, and can't report their own.
drop policy if exists "file report" on public.reports;
create policy "file report" on public.reports for insert to authenticated with check (
  reporter_id = auth.uid() and not exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
);

-- Fund list: admins can delete entries (some setups were missing this rule).
drop policy if exists "admins delete fund interest" on public.fund_interest;
create policy "admins delete fund interest" on public.fund_interest for delete to authenticated using (public.is_admin());

-- Hub names: unique, no pretending to be the team, and colours must be plain colours (a colour is used in page styles,
-- so anything else could be used to load outside images and track people).
alter table public.profiles add column if not exists is_team boolean not null default false;
alter table public.profiles add column if not exists team_title text check (team_title is null or char_length(team_title) between 2 and 30);
create or replace function public.profile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  new.alias := btrim(regexp_replace(new.alias, '\s+', ' ', 'g'));
  if new.color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Pick one of the colours shown.' using errcode = 'P0001';
  end if;
  -- Only the admin decides who is on the team (set_team below).
  if not public.is_admin() then
    new.is_team := old.is_team;
    new.team_title := old.team_title;
  end if;
  -- Team words are only for team accounts, so a team name can't be faked.
  if not public.is_admin() and not old.is_team and new.alias ~* '(admin|moderator|\ymod\y|official|autistik|support team|hub team|\yteam\y|\ystaff\y|\ydev\y|founder)' then
    raise exception 'That name is reserved for the Hub team. Please pick another.' using errcode = 'P0001';
  end if;
  if new.alias is distinct from old.alias and exists (select 1 from public.profiles p where lower(p.alias) = lower(new.alias) and p.id <> new.id) then
    raise exception 'Another member already has that name. Please pick another.' using errcode = 'P0001';
  end if;
  return new;
end; $$;
drop trigger if exists profile_guard on public.profiles;
create trigger profile_guard before update on public.profiles for each row execute function public.profile_guard();

-- ---------- 3. Admin log ----------
create table if not exists public.admin_log (
  id bigserial primary key,
  admin_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_table text not null,
  target_id text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_log_created on public.admin_log (created_at desc);
alter table public.admin_log enable row level security;
drop policy if exists "admins read log" on public.admin_log;
create policy "admins read log" on public.admin_log for select to authenticated using (public.is_admin());
-- No insert/update/delete policies: entries are written by the database itself and can't be edited or removed from the site.

create or replace function public.log_admin_action() returns trigger
language plpgsql security definer set search_path = public as $$
declare rec jsonb; info jsonb;
begin
  if auth.uid() is null or not public.is_admin() then return null; end if;
  rec := to_jsonb(coalesce(new, old));
  -- An admin's own everyday actions (deleting their own post or report) aren't admin actions.
  if rec->>'author_id' = auth.uid()::text or rec->>'reporter_id' = auth.uid()::text then return null; end if;
  info := case tg_table_name
    when 'posts' then jsonb_build_object('hidden', rec->'hidden', 'channel', rec->'channel', 'excerpt', left(rec->>'body', 120))
    when 'fund_interest' then jsonb_build_object('country', rec->'country') -- no personal details in the log
    when 'reports' then jsonb_build_object('post_id', rec->'post_id')
    else rec
  end;
  insert into public.admin_log (admin_id, action, target_table, target_id, details)
  values (auth.uid(), lower(tg_op), tg_table_name, coalesce(rec->>'id', rec->>'user_id', rec->>'post_id'), info);
  return null;
end; $$;

drop trigger if exists log_admin on public.posts;
create trigger log_admin after update or delete on public.posts for each row execute function public.log_admin_action();
drop trigger if exists log_admin on public.reports;
create trigger log_admin after delete on public.reports for each row execute function public.log_admin_action();
drop trigger if exists log_admin on public.sessions;
create trigger log_admin after insert or update or delete on public.sessions for each row execute function public.log_admin_action();
drop trigger if exists log_admin on public.app_settings;
create trigger log_admin after update on public.app_settings for each row execute function public.log_admin_action();
drop trigger if exists log_admin on public.practitioners;
create trigger log_admin after insert or delete on public.practitioners for each row execute function public.log_admin_action();
drop trigger if exists log_admin on public.practitioner_applications;
create trigger log_admin after update on public.practitioner_applications for each row execute function public.log_admin_action();
drop trigger if exists log_admin on public.fund_interest;
create trigger log_admin after delete on public.fund_interest for each row execute function public.log_admin_action();
