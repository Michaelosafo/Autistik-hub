-- =====================================================================
-- AUTISTIK Hub database
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run once on a fresh project.
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
create table public.profiles (
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------- app settings (current airdrop round) ----------
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  round_name text not null default 'Round 1',
  round_started_at timestamptz not null default now(),
  qualify_points int not null default 50
);
insert into public.app_settings (id) values (1) on conflict do nothing;

-- ---------- groups & channels ----------
create table public.group_members (
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id text not null check (group_id in ('lounge','calm','spark','learn')),
  joined_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel ~ '^(lounge|calm|spark|learn)\.[a-z]+$'),
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 2 and 1500),
  content_note text check (content_note is null or char_length(content_note) <= 80),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index posts_channel_created on public.posts (channel, created_at desc);

create table public.hearts (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.reports (
  post_id uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (post_id, reporter_id)
);

-- ---------- live sessions ----------
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  host text,
  kind text not null default 'Talk show' check (kind in ('Talk show','Q&A','Support circle','Workshop')),
  starts_at timestamptz not null,
  join_link text check (join_link is null or join_link ~ '^https://'),
  description text,
  created_at timestamptz not null default now()
);

create table public.rsvps (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

-- ---------- practitioners ----------
create table public.practitioner_applications (
  user_id uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  full_name text not null,
  role text not null,
  country text,
  verify_link text not null,
  topic text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

create table public.practitioners (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  full_name text not null,
  role text not null,
  verified_at timestamptz not null default now()
);

-- ---------- wallets (written only by the server after signature check) ----------
create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  address text not null unique check (address ~* '^0x[0-9a-f]{40}$'),
  verified_at timestamptz not null default now()
);

-- ---------- AI usage counter (server only) ----------
create table public.ai_usage (
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
create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "edit own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (alias, color) on public.profiles to authenticated;

create policy "settings readable" on public.app_settings for select using (true);
create policy "admins edit settings" on public.app_settings for update to authenticated using (public.is_admin());

create policy "memberships readable" on public.group_members for select to authenticated using (true);
create policy "join group" on public.group_members for insert to authenticated with check (user_id = auth.uid());
create policy "leave group" on public.group_members for delete to authenticated using (user_id = auth.uid());

create policy "read posts" on public.posts for select to authenticated using (not hidden or public.is_admin() or author_id = auth.uid());
create policy "post in joined groups" on public.posts for insert to authenticated with check (
  author_id = auth.uid()
  and exists (select 1 from public.profiles where id = auth.uid() and confirmed_adult)
  and exists (select 1 from public.group_members gm where gm.user_id = auth.uid() and gm.group_id = split_part(channel,'.',1))
);
create policy "delete own or admin" on public.posts for delete to authenticated using (author_id = auth.uid() or public.is_admin());
create policy "admins moderate" on public.posts for update to authenticated using (public.is_admin());

create policy "read hearts" on public.hearts for select to authenticated using (true);
create policy "give heart" on public.hearts for insert to authenticated with check (user_id = auth.uid());
create policy "remove heart" on public.hearts for delete to authenticated using (user_id = auth.uid());

create policy "file report" on public.reports for insert to authenticated with check (reporter_id = auth.uid());
create policy "admins read reports" on public.reports for select to authenticated using (public.is_admin() or reporter_id = auth.uid());
create policy "admins clear reports" on public.reports for delete to authenticated using (public.is_admin());

create policy "sessions public" on public.sessions for select using (true);
create policy "admins add sessions" on public.sessions for insert to authenticated with check (public.is_admin());
create policy "admins edit sessions" on public.sessions for update to authenticated using (public.is_admin());
create policy "admins remove sessions" on public.sessions for delete to authenticated using (public.is_admin());

create policy "read rsvps" on public.rsvps for select to authenticated using (true);
create policy "save seat" on public.rsvps for insert to authenticated with check (user_id = auth.uid());
create policy "free seat" on public.rsvps for delete to authenticated using (user_id = auth.uid());

create policy "own application" on public.practitioner_applications for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "apply" on public.practitioner_applications for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
create policy "admins review" on public.practitioner_applications for update to authenticated using (public.is_admin());

create policy "practitioners public" on public.practitioners for select using (true);
create policy "admins verify" on public.practitioners for insert to authenticated with check (public.is_admin());
create policy "admins unverify" on public.practitioners for delete to authenticated using (public.is_admin());

create policy "own wallet or admin" on public.wallets for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "unlink own wallet" on public.wallets for delete to authenticated using (user_id = auth.uid());
-- no insert/update policy: only the server (service role) writes wallets after verifying a signature.

-- ai_usage: no policies → only the server can touch it.

revoke all on public.member_points from anon;
grant select on public.member_points to authenticated;

-- ---------- realtime for the community feed ----------
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.hearts;

-- =====================================================================
-- After you sign up on your own site, make yourself an admin:
--   update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'you@example.com');
-- =====================================================================
