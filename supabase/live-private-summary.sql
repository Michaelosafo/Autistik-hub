-- Live rooms: public or private, who attended, and the after-call summary. Run once in Supabase SQL Editor.
-- Public (the default, as before): every signed-in member sees it in "Live now" and can choose to join.
-- Private: not listed anywhere; only people with the host's invite link (and the host, co-hosts, speakers and staff)
-- can open it, its comments, recording and drops.

alter table public.live_rooms add column if not exists visibility text not null default 'public';
do $$ begin
  alter table public.live_rooms add constraint live_rooms_visibility check (visibility in ('public','private'));
exception when duplicate_object then null; end $$;

-- The invite code of a private room. Only its host can read it (to share the link); the server checks it.
create table if not exists public.live_room_keys (
  room_id uuid primary key references public.live_rooms(id) on delete cascade,
  code text not null unique check (char_length(code) between 12 and 64),
  created_at timestamptz not null default now()
);
alter table public.live_room_keys enable row level security;
drop policy if exists "host reads key" on public.live_room_keys;
create policy "host reads key" on public.live_room_keys for select using (exists (select 1 from public.live_rooms r where r.id = room_id and r.host_id = auth.uid()));
drop policy if exists "host adds key" on public.live_room_keys;
create policy "host adds key" on public.live_room_keys for insert with check (exists (select 1 from public.live_rooms r where r.id = room_id and r.host_id = auth.uid()));

-- Everyone who opened a live while it was on (written by the server only). Used for the count and private access.
create table if not exists public.live_room_attendance (
  room_id uuid not null references public.live_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  first_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.live_room_attendance enable row level security;

-- Who may see a room.
create or replace function public.can_see_room(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from live_rooms r where r.id = rid and (
      r.visibility = 'public' or r.host_id = auth.uid() or auth.uid() = any(r.cohosts) or auth.uid() = any(r.speakers)
      or exists (select 1 from live_room_attendance a where a.room_id = r.id and a.user_id = auth.uid())
      or exists (select 1 from live_room_members m where m.room_id = r.id and m.user_id = auth.uid())
      or is_staff()));
$$;
grant execute on function public.can_see_room(uuid) to anon, authenticated;

drop policy if exists "read rooms" on public.live_rooms;
create policy "read rooms" on public.live_rooms for select using (visibility = 'public' or public.can_see_room(id));
drop policy if exists "live msgs read" on public.live_room_messages;
create policy "live msgs read" on public.live_room_messages for select using (public.can_see_room(room_id));
drop policy if exists "recordings public" on public.live_recordings;
create policy "recordings public" on public.live_recordings for select using (room_id is null or public.can_see_room(room_id));
drop policy if exists "drops public read" on public.live_room_drops;
create policy "drops public read" on public.live_room_drops for select using (public.can_see_room(room_id));

-- The after-call summary: how many people joined (not counting the host), comments, and tokens sent.
create or replace function public.live_room_summary(rid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not can_see_room(rid) then null else jsonb_build_object(
    'attended', (select count(*) from (
        select user_id from live_room_attendance where room_id = rid
        union select user_id from live_room_members where room_id = rid) x
      where x.user_id <> (select host_id from live_rooms where id = rid)),
    'comments', (select count(*) from live_room_messages where room_id = rid and not deleted),
    'commenters', (select count(distinct user_id) from live_room_messages where room_id = rid and not deleted),
    'drops', coalesce((select jsonb_agg(jsonb_build_object('chain', chain, 'token', token, 'symbol', symbol, 'total', total,
        'recipients', recipients, 'tx', tx_hash) order by created_at) from live_room_drops where room_id = rid), '[]'::jsonb)
  ) end;
$$;
grant execute on function public.live_room_summary(uuid) to anon, authenticated;
