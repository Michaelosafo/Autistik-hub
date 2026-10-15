-- Safe to run more than once: it only adds what is missing.
-- =====================================================================
-- AUTISTIK Hub database
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run on a fresh project, and safe to run again later.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- helpers ----------
create or replace function public.random_alias() returns text
language sql volatile as $$
  select (array['Quiet','Bright','Steady','Curious','Gentle','Brave','Calm','Clever','Kind','Patient','Cosmic','Sunny'])[1 + floor(random()*12)::int]
      || ' ' ||
         (array['Otter','Comet','Fern','Owl','River','Lantern','Fox','Pebble','Heron','Maple','Nova','Tide'])[1 + floor(random()*12)::int];
$$;

create or replace function public.random_color() returns text
language sql volatile as $$
  select (array['#D9472F','#0B857A','#6141D4','#B97F00','#2F6FB5','#B5306A','#3F7F2F','#8A4F2A'])[1 + floor(random()*8)::int];
$$;

-- ---------- profiles (public Hub identity; never the real name) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  alias text not null default public.random_alias() check (char_length(alias) between 2 and 40),
  color text not null default public.random_color(),
  is_admin boolean not null default false,
  confirmed_adult boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, confirmed_adult)
  values (new.id, coalesce((new.raw_user_meta_data->>'confirmed_adult')::boolean, false))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts made before this script ran get their profile now.
insert into public.profiles (id, confirmed_adult)
select u.id, coalesce((u.raw_user_meta_data->>'confirmed_adult')::boolean, false) from auth.users u
on conflict (id) do nothing;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------- app settings (current airdrop round) ----------
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  round_name text not null default 'Round 1',
  round_started_at timestamptz not null default now(),
  qualify_points int not null default 50
);
insert into public.app_settings (id) values (1) on conflict do nothing;

-- ---------- groups & channels ----------
create table if not exists public.group_members (
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id text not null check (group_id in ('lounge','calm','spark','learn')),
  joined_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel ~ '^(lounge|calm|spark|learn)\.[a-z]+$'),
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 2 and 1500),
  content_note text check (content_note is null or char_length(content_note) <= 80),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists posts_channel_created on public.posts (channel, created_at desc);

create table if not exists public.hearts (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.reports (
  post_id uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (post_id, reporter_id)
);

-- ---------- live sessions ----------
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  host text,
  kind text not null default 'Talk show' check (kind in ('Talk show','Q&A','Support circle','Workshop')),
  starts_at timestamptz not null,
  join_link text check (join_link is null or join_link ~ '^https://'),
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.rsvps (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

-- ---------- practitioners ----------
create table if not exists public.practitioner_applications (
  user_id uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  full_name text not null,
  role text not null,
  country text,
  verify_link text not null,
  topic text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.practitioners (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  full_name text not null,
  role text not null,
  verified_at timestamptz not null default now()
);

-- ---------- wallets (written only by the server after signature check) ----------
create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  address text not null unique check (address ~* '^0x[0-9a-f]{40}$'),
  verified_at timestamptz not null default now()
);

-- ---------- AI usage counter (server only) ----------
create table if not exists public.ai_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);

create or replace function public.bump_ai_usage(p_user uuid, p_limit int) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.ai_usage (user_id, day, count) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into n;
  if n > p_limit then return -1; end if;
  return n;
end; $$;
revoke all on function public.bump_ai_usage(uuid, int) from public, anon, authenticated;

-- ---------- points (computed by the database, so nobody can fake them) ----------
create or replace view public.member_points as
with s as (select round_started_at from public.app_settings where id = 1),
p as (
  select author_id, count(*) n from public.posts, s
  where not hidden and created_at >= s.round_started_at group by author_id
),
h as (
  select po.author_id, count(*) n from public.hearts he
  join public.posts po on po.id = he.post_id, s
  where he.user_id <> po.author_id and not po.hidden and he.created_at >= s.round_started_at
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

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.group_members enable row level security;
alter table public.posts enable row level security;
alter table public.hearts enable row level security;
alter table public.reports enable row level security;
alter table public.sessions enable row level security;
alter table public.rsvps enable row level security;
alter table public.practitioner_applications enable row level security;
alter table public.practitioners enable row level security;
alter table public.wallets enable row level security;
alter table public.ai_usage enable row level security;

-- profiles: members see each other's Hub names; you can change your own alias/colour only
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated using (true);
drop policy if exists "edit own profile" on public.profiles;
create policy "edit own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (alias, color) on public.profiles to authenticated;

drop policy if exists "settings readable" on public.app_settings;
create policy "settings readable" on public.app_settings for select using (true);
drop policy if exists "admins edit settings" on public.app_settings;
create policy "admins edit settings" on public.app_settings for update to authenticated using (public.is_admin());

drop policy if exists "memberships readable" on public.group_members;
create policy "memberships readable" on public.group_members for select to authenticated using (true);
drop policy if exists "join group" on public.group_members;
create policy "join group" on public.group_members for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "leave group" on public.group_members;
create policy "leave group" on public.group_members for delete to authenticated using (user_id = auth.uid());

drop policy if exists "read posts" on public.posts;
create policy "read posts" on public.posts for select to authenticated using (not hidden or public.is_admin() or author_id = auth.uid());
drop policy if exists "post in joined groups" on public.posts;
create policy "post in joined groups" on public.posts for insert to authenticated with check (
  author_id = auth.uid()
  and exists (select 1 from public.profiles where id = auth.uid() and confirmed_adult)
  and exists (select 1 from public.group_members gm where gm.user_id = auth.uid() and gm.group_id = split_part(channel,'.',1))
);
drop policy if exists "delete own or admin" on public.posts;
create policy "delete own or admin" on public.posts for delete to authenticated using (author_id = auth.uid() or public.is_admin());
drop policy if exists "admins moderate" on public.posts;
create policy "admins moderate" on public.posts for update to authenticated using (public.is_admin());

drop policy if exists "read hearts" on public.hearts;
create policy "read hearts" on public.hearts for select to authenticated using (true);
drop policy if exists "give heart" on public.hearts;
create policy "give heart" on public.hearts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "remove heart" on public.hearts;
create policy "remove heart" on public.hearts for delete to authenticated using (user_id = auth.uid());

drop policy if exists "file report" on public.reports;
create policy "file report" on public.reports for insert to authenticated with check (reporter_id = auth.uid());
drop policy if exists "admins read reports" on public.reports;
create policy "admins read reports" on public.reports for select to authenticated using (public.is_admin() or reporter_id = auth.uid());
drop policy if exists "admins clear reports" on public.reports;
create policy "admins clear reports" on public.reports for delete to authenticated using (public.is_admin());

drop policy if exists "sessions public" on public.sessions;
create policy "sessions public" on public.sessions for select using (true);
drop policy if exists "admins add sessions" on public.sessions;
create policy "admins add sessions" on public.sessions for insert to authenticated with check (public.is_admin());
drop policy if exists "admins edit sessions" on public.sessions;
create policy "admins edit sessions" on public.sessions for update to authenticated using (public.is_admin());
drop policy if exists "admins remove sessions" on public.sessions;
create policy "admins remove sessions" on public.sessions for delete to authenticated using (public.is_admin());

drop policy if exists "read rsvps" on public.rsvps;
create policy "read rsvps" on public.rsvps for select to authenticated using (true);
drop policy if exists "save seat" on public.rsvps;
create policy "save seat" on public.rsvps for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "free seat" on public.rsvps;
create policy "free seat" on public.rsvps for delete to authenticated using (user_id = auth.uid());

drop policy if exists "own application" on public.practitioner_applications;
create policy "own application" on public.practitioner_applications for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "apply" on public.practitioner_applications;
create policy "apply" on public.practitioner_applications for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
drop policy if exists "admins review" on public.practitioner_applications;
create policy "admins review" on public.practitioner_applications for update to authenticated using (public.is_admin());

drop policy if exists "practitioners public" on public.practitioners;
create policy "practitioners public" on public.practitioners for select using (true);
drop policy if exists "admins verify" on public.practitioners;
create policy "admins verify" on public.practitioners for insert to authenticated with check (public.is_admin());
drop policy if exists "admins unverify" on public.practitioners;
create policy "admins unverify" on public.practitioners for delete to authenticated using (public.is_admin());

drop policy if exists "own wallet or admin" on public.wallets;
create policy "own wallet or admin" on public.wallets for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "unlink own wallet" on public.wallets;
create policy "unlink own wallet" on public.wallets for delete to authenticated using (user_id = auth.uid());
-- no insert/update policy: only the server (service role) writes wallets after verifying a signature.

-- ai_usage: no policies → only the server can touch it.

revoke all on public.member_points from anon;
grant select on public.member_points to authenticated;

-- ---------- realtime for the community feed ----------
do $$ begin
  alter publication supabase_realtime add table public.posts;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.hearts;
exception when duplicate_object then null; end $$;

-- ---------- AUTISTIK Launch Pad (same as supabase/launchpad.sql) ----------

create table if not exists public.launches (
  id uuid primary key default gen_random_uuid(),
  chain text not null check (chain in ('bsc','ethereum','robinhood')),
  token text not null,
  pair text not null,
  creator text not null,
  name text not null,
  symbol text not null,
  supply numeric not null,
  tx_hash text not null unique,
  user_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists launches_created_at on public.launches (created_at desc);
-- Liquidity choice: 'burn' (forever), '6m' or '1y' (locked in the Launch Pad contract until lp_unlock_at).
alter table public.launches add column if not exists lp_lock text not null default 'burn' check (lp_lock in ('burn','6m','1y'));
alter table public.launches add column if not exists lp_unlock_at timestamptz;
-- Where a token came from: 'launchpad' (launched here) or 'listed' (launched elsewhere, paid to be listed and trend).
alter table public.launches add column if not exists source text not null default 'launchpad' check (source in ('launchpad','listed'));

alter table public.launches enable row level security;
-- Anyone can see launches. Only the server writes them, after checking the transaction on-chain.
drop policy if exists "launches public" on public.launches;
create policy "launches public" on public.launches for select using (true);

-- ---------- Watchlist: members star tokens; everyone sees how many people watch each one ----------
create table if not exists public.launch_watchers (
  user_id uuid not null references auth.users on delete cascade,
  chain text not null,
  token text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, chain, token)
);
alter table public.launch_watchers enable row level security;
drop policy if exists "see own watchlist" on public.launch_watchers;
drop policy if exists "watch" on public.launch_watchers;
drop policy if exists "unwatch" on public.launch_watchers;
drop policy if exists "see own watchlist" on public.launch_watchers;
create policy "see own watchlist" on public.launch_watchers for select to authenticated using (user_id = auth.uid());
drop policy if exists "watch" on public.launch_watchers;
create policy "watch" on public.launch_watchers for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "unwatch" on public.launch_watchers;
create policy "unwatch" on public.launch_watchers for delete to authenticated using (user_id = auth.uid());

-- Counts only, never who is watching.
create or replace view public.launch_watch_counts as
  select chain, token, count(*)::int as watchers from public.launch_watchers group by chain, token;
grant select on public.launch_watch_counts to anon, authenticated;

-- ---------- Paid trending: one row per payment, checked on-chain by the server ----------
create table if not exists public.launch_promotions (
  id uuid primary key default gen_random_uuid(),
  chain text not null,
  token text not null,
  plan int not null,
  price numeric not null,
  payer text not null,
  tx_hash text not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists launch_promotions_ends_at on public.launch_promotions (ends_at desc);
alter table public.launch_promotions enable row level security;
drop policy if exists "promotions public" on public.launch_promotions;
create policy "promotions public" on public.launch_promotions for select using (true);

-- =====================================================================
-- After you sign up on your own site, make yourself an admin:
--   update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'you@example.com');
-- =====================================================================

-- =====================================================================
-- AUTISTIK Fund: "register your interest" list.
-- Already set up the Hub? Paste just this file into Supabase → SQL Editor → Run.
-- (schema.sql includes it for fresh projects.)
-- =====================================================================
create table if not exists public.fund_interest (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  country text not null,
  phone text,
  message text,
  for_someone_else boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.fund_interest enable row level security;
-- Personal details: only admins can read or delete them. The website saves new entries with the server key.
drop policy if exists "admins read fund interest" on public.fund_interest;
drop policy if exists "admins delete fund interest" on public.fund_interest;
drop policy if exists "admins read fund interest" on public.fund_interest;
create policy "admins read fund interest" on public.fund_interest for select to authenticated using (public.is_admin());
drop policy if exists "admins delete fund interest" on public.fund_interest;
create policy "admins delete fund interest" on public.fund_interest for delete to authenticated using (public.is_admin());
