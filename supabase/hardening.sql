-- =====================================================================
-- AUTISTIK Hub: extra database hardening. Safe to run more than once. Run it LAST, after the other files.
-- Supabase → SQL Editor → New query → paste all of this → Run.
--   1. Visitors and members get only the exact table permissions the site uses. Row Level Security already
--      limits which rows they can touch; this also takes away every other kind of access, as a second lock.
--   2. Tables the server keeps for itself (AI counters, rate limits, ...) can't be reached from the browser at all.
--   3. A practitioner's "proof" link must be a normal https:// link (no hidden scripts).
--   4. Airdrop points: posts need at least 20 characters, and hearts only count from accounts at least 7 days
--      old, so points can't be farmed quickly with throwaway accounts.
-- =====================================================================

-- ---------- 1 & 2. Exact permissions ----------
do $$
declare t text;
begin
  -- Start from nothing on every table and view in public ...
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p') loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ... then give back only what the site needs. (The server uses its own key and isn't affected.)
do $$
declare g record;
begin
  for g in select * from (values
    -- table, privileges for anon (visitors), privileges for authenticated (signed-in members)
    ('app_settings',              'select', 'select, update'),
    ('group_members',             '',       'select, insert, delete'),
    ('posts',                     '',       'select, insert, update, delete'),
    ('hearts',                    '',       'select, insert, delete'),
    ('reports',                   '',       'select, insert, delete'),
    ('sessions',                  'select', 'select, insert, update, delete'),
    ('rsvps',                     '',       'select, insert, delete'),
    ('practitioner_applications', '',       'select, insert, update'),
    ('practitioners',             'select', 'select, insert, delete'),
    ('profiles',                  '',       'select'),
    ('wallets',                   '',       'select, delete'),
    ('ai_passes',                 '',       'select'),
    ('fund_interest',             '',       'select, delete'),
    ('launches',                  'select', 'select'),
    ('launch_watchers',           '',       'select, insert, delete'),
    ('launch_promotions',         'select', 'select'),
    ('member_points',             '',       'select'),
    ('launch_watch_counts',       'select', 'select'),
    ('admin_log',                 '',       'select')
  ) as v(tbl, anon_privs, auth_privs) loop
    continue when to_regclass('public.' || g.tbl) is null;
    if g.anon_privs <> '' then execute format('grant %s on public.%I to anon', g.anon_privs, g.tbl); end if;
    if g.auth_privs <> '' then execute format('grant %s on public.%I to authenticated', g.auth_privs, g.tbl); end if;
  end loop;
end $$;
-- Members can only change their own name and colour (never the admin or adult flags).
grant update (alias, color) on public.profiles to authenticated;

-- New tables start with no browser access; each file grants what its tables need.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------- 3. Practitioner proof links ----------
alter table public.practitioner_applications drop constraint if exists verify_link_https;
alter table public.practitioner_applications add constraint verify_link_https
  check (verify_link ~ '^https://[^\s"<>]{3,200}$');

-- ---------- 4. Airdrop points that can't be farmed ----------
create or replace view public.member_points as
with s as (select round_started_at from public.app_settings where id = 1),
p as (
  select author_id, count(*) n from public.posts, s
  where not hidden and created_at >= s.round_started_at and char_length(btrim(body)) >= 20
  group by author_id
),
h as (
  select po.author_id, count(*) n from public.hearts he
  join public.posts po on po.id = he.post_id
  join public.profiles giver on giver.id = he.user_id, s
  where he.user_id <> po.author_id and not po.hidden and he.created_at >= s.round_started_at
    and giver.created_at < now() - interval '7 days'
  group by po.author_id
),
r as (
  select rv.user_id, count(*) n from public.rsvps rv
  join public.sessions se on se.id = rv.session_id, s
  where se.starts_at >= s.round_started_at group by rv.user_id
)
select pr.id as user_id, pr.alias,
  coalesce(p.n,0)::int as posts,
  coalesce(r.n,0)::int as sessions,
  coalesce(h.n,0)::int as support,
  (least(coalesce(p.n,0),10)*5 + coalesce(r.n,0)*10 + least(coalesce(h.n,0),50))::int as points
from public.profiles pr
left join p on p.author_id = pr.id
left join h on h.author_id = pr.id
left join r on r.user_id = pr.id;
revoke all on public.member_points from anon, authenticated;
grant select on public.member_points to authenticated;
