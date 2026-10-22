-- AUTISTIK Hub: meme names, follows, the Live hub and admin airdrops. Safe to run more than once.
-- Supabase → SQL Editor → New query → paste all of this → Run.
--
-- 1. Every new member gets a fun, unique meme name on sign-up (like "Diamond-Hand Whale #4821"). Members can
--    roll a new one from their profile, or type their own. Two members can't have the same name any more.
-- 2. Members follow each other: follower and following counts, and a feed of posts from people you follow.
-- 3. Live hub: the team marks a session "live"; members join it with a linked wallet, so the name, the account
--    and the wallet are tied together.
-- 5. Team accounts carry a gold TEAM badge everywhere their name shows. Only the admin can make someone team.
-- 6. Profiles show what a member has been up to: coins scanned, tokens launched, posts, live sessions, follows.
--    Never wallet balances, swaps or trades.
-- 7. Like X: every member has a display name and a unique @handle. New members can pick a nickname when they
--    sign up (otherwise they get a meme name). Emails are never shown to anyone.
-- 8. Wallet holdings are private. A member can choose to show them to everyone, to followers, or to people they
--    send a private link to. The wallet address itself is never shown, only what it holds.
-- 4. Admin airdrops: the admin page lists the joined members' wallets and keeps a record of every token
--    transfer the owner signs in their own wallet. The database never holds or sees a private key.
-- =====================================================================

set client_min_messages = warning;

-- Team accounts (section 5) are marked on the profile; the name guard below needs these columns.
alter table public.profiles add column if not exists is_team boolean not null default false;
alter table public.profiles add column if not exists team_title text check (team_title is null or char_length(team_title) between 2 and 30);

-- ---------- 1. Meme names ----------
-- Word lists are kept friendly: no slurs, and no words reserved for the team (admin, mod, official, autistik).
create or replace function public.random_alias() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  adj text[] := array['Diamond-Hand','Based','Turbo','Giga','Comfy','Smol','Laser-Eyed','Moon','Wagmi','Hodl',
                      'Galaxy-Brain','Bullish','Sleepy','Rug-Proof','Wen-Lambo','Mega','Cosmic','Frosty','Lucky','Spicy',
                      'Paper-Hand','Degen','Zoomer','Chad','Sneaky','Gm','Rekt-Proof','Pumped','Chill','Ape'];
  noun text[] := array['Whale','Shrimp','Ape','Degen','Frog','Goblin','Wizard','Doge','Hodler','Moonboy',
                       'Gremlin','Penguin','Banana','Rocket','Otter','Llama','Crab','Hamster','Raccoon','Lobster',
                       'Chimp','Bull','Bear','Kitten','Dolphin','Owl','Fox','Yeti','Panda','Gecko'];
  name text;
begin
  for i in 1..25 loop
    name := adj[1 + floor(random() * array_length(adj, 1))::int] || ' '
         || noun[1 + floor(random() * array_length(noun, 1))::int] || ' #'
         || (1000 + floor(random() * 9000)::int)::text;
    if not exists (select 1 from public.profiles where lower(alias) = lower(name)) then return name; end if;
  end loop;
  return name || floor(random() * 10)::text; -- 25 clashes in a row is practically impossible; this keeps it unique anyway
end; $$;
revoke all on function public.random_alias() from public, anon;
grant execute on function public.random_alias() to authenticated;
alter table public.profiles alter column alias set default public.random_alias();

-- Roll a new meme name for yourself (the "New meme name" button on your profile).
create or replace function public.reroll_alias() returns text
language plpgsql volatile security definer set search_path = public as $$
declare name text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'P0001'; end if;
  name := public.random_alias();
  update public.profiles set alias = name where id = auth.uid();
  return name;
end; $$;
revoke all on function public.reroll_alias() from public, anon;
grant execute on function public.reroll_alias() to authenticated;

-- Names are unique: the same rules as before (no pretending to be the team, plain colours only), plus no copying
-- someone else's name. Replaces the version in security.sql.
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
revoke all on function public.profile_guard() from public, anon, authenticated;
create index if not exists profiles_alias_lower on public.profiles (lower(alias));

-- ---------- 2. Follows ----------
create table if not exists public.follows (
  follower_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists follows_followee on public.follows (followee_id);
alter table public.follows enable row level security;
drop policy if exists "read follows" on public.follows;
create policy "read follows" on public.follows for select to authenticated using (true);
drop policy if exists "follow" on public.follows;
create policy "follow" on public.follows for insert to authenticated with check (follower_id = auth.uid());
drop policy if exists "unfollow" on public.follows;
create policy "unfollow" on public.follows for delete to authenticated using (follower_id = auth.uid());

-- Members can't fake follow times, and can't follow-spam.
create or replace function public.follow_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  new.created_at := now();
  if (select count(*) from public.follows where follower_id = auth.uid() and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Slow down a little: you can follow 30 members a minute.' using errcode = 'P0001';
  end if;
  return new;
end; $$;
revoke all on function public.follow_guard() from public, anon, authenticated;
drop trigger if exists follow_guard on public.follows;
create trigger follow_guard before insert on public.follows for each row execute function public.follow_guard();

-- ---------- 3. Live hub ----------
alter table public.sessions add column if not exists is_live boolean not null default false;
alter table public.sessions add column if not exists ended boolean not null default false;

create table if not exists public.session_joins (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index if not exists session_joins_user on public.session_joins (user_id);
alter table public.session_joins enable row level security;
drop policy if exists "read joins" on public.session_joins;
create policy "read joins" on public.session_joins for select to authenticated using (true);
-- You can only join for yourself, with a linked wallet, while the session is live (or about to start).
drop policy if exists "join live" on public.session_joins;
create policy "join live" on public.session_joins for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.wallets w where w.user_id = auth.uid())
  and exists (select 1 from public.sessions s where s.id = session_id and not s.ended
              and (s.is_live or s.starts_at between now() - interval '3 hours' and now() + interval '15 minutes'))
);
drop policy if exists "admins clear joins" on public.session_joins;
create policy "admins clear joins" on public.session_joins for delete to authenticated using (public.is_admin());

create or replace function public.join_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.joined_at := now(); end if;
  return new;
end; $$;
revoke all on function public.join_guard() from public, anon, authenticated;
drop trigger if exists join_guard on public.session_joins;
create trigger join_guard before insert on public.session_joins for each row execute function public.join_guard();

-- The numbers on a profile. "wallet" says only whether a wallet is linked, never which one.
create or replace function public.member_card(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'followers', (select count(*) from public.follows where followee_id = p_id),
    'following', (select count(*) from public.follows where follower_id = p_id),
    'i_follow', exists (select 1 from public.follows where follower_id = auth.uid() and followee_id = p_id),
    'follows_me', exists (select 1 from public.follows where follower_id = p_id and followee_id = auth.uid()),
    'wallet', exists (select 1 from public.wallets where user_id = p_id),
    'lives', (select count(*) from public.session_joins where user_id = p_id)
  ) end;
$$;
revoke all on function public.member_card(uuid) from public, anon;
grant execute on function public.member_card(uuid) to authenticated;

-- ---------- 4. Admin airdrop record ----------
-- One row per transfer the owner signed in their own wallet. Written from the admin page after each transfer.
create table if not exists public.airdrop_sends (
  id bigserial primary key,
  admin_id uuid default auth.uid() references public.profiles(id) on delete set null,
  batch text not null,
  audience text not null,
  session_id uuid references public.sessions(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  wallet text not null check (wallet ~* '^0x[0-9a-f]{40}$'),
  token text not null check (token ~* '^0x[0-9a-f]{40}$'),
  amount numeric not null check (amount > 0),
  tx_hash text check (tx_hash is null or tx_hash ~* '^0x[0-9a-f]{64}$'),
  status text not null default 'sent' check (status in ('sent','failed')),
  created_at timestamptz not null default now()
);
create index if not exists airdrop_sends_created on public.airdrop_sends (created_at desc);
alter table public.airdrop_sends enable row level security;
drop policy if exists "admins read airdrops" on public.airdrop_sends;
create policy "admins read airdrops" on public.airdrop_sends for select to authenticated using (public.is_admin());
drop policy if exists "admins record airdrops" on public.airdrop_sends;
create policy "admins record airdrops" on public.airdrop_sends for insert to authenticated with check (public.is_admin() and admin_id = auth.uid());
-- No update or delete: the record can't be edited from the site.

-- ---------- 5. Team accounts ----------
-- Admin page → Team: make a member team (with a title like "Founder" or "Host"), or take it away.
create or replace function public.set_team(p_id uuid, p_on boolean, p_title text default null, p_alias text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  update public.profiles set
    is_team = p_on,
    team_title = case when p_on then nullif(btrim(coalesce(p_title, '')), '') end,
    alias = coalesce(nullif(btrim(coalesce(p_alias, '')), ''), alias)
  where id = p_id;
  if not found then raise exception 'No member with that id.' using errcode = 'P0001'; end if;
end; $$;
revoke all on function public.set_team(uuid, boolean, text, text) from public, anon;
grant execute on function public.set_team(uuid, boolean, text, text) to authenticated;

-- ---------- 6. Public activity on a profile ----------
-- Read from the site's activity log, but only these kinds. Swaps, liquidity, payments, alerts and anything to do
-- with a wallet's money are never shown.
create or replace function public.member_activity(p_id uuid, p_limit int default 30) returns table (at timestamptz, kind text, label text, link text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null then return; end if;
  return query select * from (
    select a.at, case a.kind when 'search' then 'scan' when 'report' then 'scan' else a.kind end, a.label, a.link
      from public.activity_log a
      where a.user_id = p_id and a.kind in ('search', 'report', 'launch', 'lock', 'pin', 'launchpad', 'locker')
    union all
    select p.created_at, 'post', left(p.body, 140), null from public.posts p where p.author_id = p_id and not p.hidden
    union all
    select j.joined_at, 'live', s.title, '/live' from public.session_joins j join public.sessions s on s.id = j.session_id where j.user_id = p_id
    union all
    select f.created_at, 'follow', pr.alias, '/members/' || pr.id from public.follows f join public.profiles pr on pr.id = f.followee_id where f.follower_id = p_id
  ) x
  order by 1 desc
  limit least(greatest(p_limit, 1), 100);
end; $$;
revoke all on function public.member_activity(uuid, int) from public, anon;
grant execute on function public.member_activity(uuid, int) to authenticated;

-- ---------- 7. @handles and the sign-up nickname ----------
alter table public.profiles add column if not exists handle text;

-- A free handle made from a name: "Diamond-Hand Whale #4821" → diamondhandwhale4821. Lowercase letters, digits
-- and _, 3 to 20 long. Adds a number if it's taken. Team words are kept for team accounts.
create or replace function public.make_handle(p_base text, p_me uuid default null) returns text
language plpgsql volatile security definer set search_path = public as $$
declare base text; h text;
begin
  base := left(regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9_]', '', 'g'), 15);
  if base ~ '(admin|moderator|official|autistik|team|staff|founder)' then base := regexp_replace(base, '(admin|moderator|official|autistik|team|staff|founder)', '', 'g'); end if;
  if char_length(base) < 3 then base := 'member'; end if;
  h := base;
  for i in 1..30 loop
    if not exists (select 1 from public.profiles where handle = h and id is distinct from p_me) then return h; end if;
    h := left(base, 15) || (10 + floor(random() * 99990)::int)::text;
  end loop;
  return left(base, 12) || floor(random() * 1e8)::bigint::text;
end; $$;
revoke all on function public.make_handle(text, uuid) from public, anon, authenticated;

update public.profiles set handle = public.make_handle(alias, id) where handle is null;
create unique index if not exists profiles_handle_key on public.profiles (handle);
do $$ begin
  alter table public.profiles add constraint profiles_handle_format check (handle ~ '^[a-z0-9_]{3,20}$');
exception when duplicate_object then null; end $$;

-- Fill the handle on new profiles.
create or replace function public.profile_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.handle is null then new.handle := public.make_handle(new.alias, new.id); end if;
  return new;
end; $$;
revoke all on function public.profile_defaults() from public, anon, authenticated;
drop trigger if exists profile_defaults on public.profiles;
create trigger profile_defaults before insert on public.profiles for each row execute function public.profile_defaults();

-- Sign-up: the nickname typed on the sign-up form becomes the display name (if it's allowed and free), otherwise
-- a meme name. Names from Google or Apple are never used, so real names don't leak.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare nick text := btrim(regexp_replace(coalesce(new.raw_user_meta_data->>'nickname', ''), '\s+', ' ', 'g'));
begin
  if char_length(nick) not between 2 and 40
     or nick ~* '(admin|moderator|\ymod\y|official|autistik|support team|hub team|\yteam\y|\ystaff\y|\ydev\y|founder|@)'
     or exists (select 1 from public.profiles where lower(alias) = lower(nick)) then
    nick := public.random_alias();
  end if;
  insert into public.profiles (id, alias, confirmed_adult)
  values (new.id, nick, coalesce((new.raw_user_meta_data->>'confirmed_adult')::boolean, false))
  on conflict (id) do nothing;
  return new;
end; $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Members can change their @handle on their profile; it has to be free, 3-20 letters, digits or _, and team
-- words are kept for team accounts.
create or replace function public.handle_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or new.handle is not distinct from old.handle then return new; end if;
  new.handle := lower(btrim(coalesce(new.handle, '')));
  if new.handle !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Your @handle needs 3 to 20 letters, numbers or _.' using errcode = 'P0001';
  end if;
  if not public.is_admin() and not old.is_team and new.handle ~ '(admin|moderator|official|autistik|team|staff|founder)' then
    raise exception 'That @handle is reserved for the Hub team. Please pick another.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where handle = new.handle and id <> new.id) then
    raise exception 'That @handle is taken. Please pick another.' using errcode = 'P0001';
  end if;
  return new;
end; $$;
revoke all on function public.handle_guard() from public, anon, authenticated;
drop trigger if exists handle_guard on public.profiles;
create trigger handle_guard before update of handle on public.profiles for each row execute function public.handle_guard();

-- ---------- 8. Sharing holdings ----------
alter table public.profiles add column if not exists holdings_share text not null default 'private';
do $$ begin
  alter table public.profiles add constraint profiles_holdings_share check (holdings_share in ('private', 'followers', 'public'));
exception when duplicate_object then null; end $$;

-- Private share links live in their own table, so nobody can read another member's link.
create table if not exists public.holdings_links (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  key text not null unique,
  created_at timestamptz not null default now()
);
alter table public.holdings_links enable row level security;
drop policy if exists "own link" on public.holdings_links;
create policy "own link" on public.holdings_links for select to authenticated using (user_id = auth.uid());
drop policy if exists "remove own link" on public.holdings_links;
create policy "remove own link" on public.holdings_links for delete to authenticated using (user_id = auth.uid());

-- A new private link (the old one stops working).
create or replace function public.new_holdings_link() returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare k text := encode(gen_random_bytes(16), 'hex');
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'P0001'; end if;
  insert into public.holdings_links (user_id, key) values (auth.uid(), k)
  on conflict (user_id) do update set key = excluded.key, created_at = now();
  return k;
end; $$;
revoke all on function public.new_holdings_link() from public, anon;
grant execute on function public.new_holdings_link() to authenticated;

-- The wallet whose holdings a viewer may see on a profile, or null. Only the website's server can call this (it
-- passes who is looking); it uses the address to look up balances and shows the balances, never the address.
drop function if exists public.holdings_wallet(uuid, text);
create or replace function public.holdings_wallet(p_id uuid, p_viewer uuid, p_key text default null) returns text
language sql stable security definer set search_path = public as $$
  select w.address from public.wallets w join public.profiles p on p.id = w.user_id
  where w.user_id = p_id and p_viewer is not null and (
    p_id = p_viewer
    or p.holdings_share = 'public'
    or (p.holdings_share = 'followers' and exists (select 1 from public.follows f where f.follower_id = p_viewer and f.followee_id = p_id))
    or (p_key is not null and exists (select 1 from public.holdings_links l where l.user_id = p_id and l.key = p_key))
  );
$$;
revoke all on function public.holdings_wallet(uuid, uuid, text) from public, anon, authenticated;

-- ---------- 2-step verification rules on the new tables (same as user-2fa.sql) ----------
do $$
declare t text;
begin
  if to_regprocedure('public.has_2fa()') is null then return; end if;
  foreach t in array array['follows', 'session_joins', 'airdrop_sends'] loop
    execute format('drop policy if exists "2-step: add" on public.%I', t);
    execute format('drop policy if exists "2-step: remove" on public.%I', t);
    execute format('create policy "2-step: add" on public.%I as restrictive for insert to authenticated with check ((select public.has_2fa()))', t);
    execute format('create policy "2-step: remove" on public.%I as restrictive for delete to authenticated using ((select public.has_2fa()))', t);
  end loop;
end $$;

-- ---------- Check it worked ----------
select public.random_alias() as sample_name_1, public.random_alias() as sample_name_2, public.random_alias() as sample_name_3;

-- ---------- Optional: give existing members a meme name too ----------
-- Members who still have their original automatic name (like "Quiet Otter") get a meme name. Names members typed
-- themselves are left alone. Remove the two dashes at the start of the next line and run it on its own:
--   update public.profiles set alias = public.random_alias() where alias ~ '^(Quiet|Bright|Steady|Curious|Gentle|Brave|Calm|Clever|Kind|Patient|Cosmic|Sunny) (Otter|Comet|Fern|Owl|River|Lantern|Fox|Pebble|Heron|Maple|Nova|Tide)$';

-- ---------- Optional: make an account team by email (or use Admin page → Team) ----------
--   update public.profiles set is_team = true, team_title = 'Founder' where id = (select id from auth.users where email = lower('you@example.com'));
