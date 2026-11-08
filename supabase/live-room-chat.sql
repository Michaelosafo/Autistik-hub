-- Live rooms: comments (text, pictures, emoji) during a live, kept so people can read them after it ends,
-- and the host's list of speakers saved on the room so it survives the host reloading the page.

alter table public.live_rooms add column if not exists speakers uuid[] not null default '{}'::uuid[];

create table if not exists public.live_room_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.live_rooms(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text check (body is null or char_length(body) between 1 and 500),
  image_url text check (image_url is null or image_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/chat-images/'),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  constraint live_room_messages_check check (deleted or body is not null or image_url is not null)
);
create index if not exists live_room_messages_room on public.live_room_messages (room_id, id desc);

alter table public.live_room_messages enable row level security;

drop policy if exists "live msgs read" on public.live_room_messages;
create policy "live msgs read" on public.live_room_messages for select using (true);

drop policy if exists "live msgs add own" on public.live_room_messages;
create policy "live msgs add own" on public.live_room_messages for insert with check (
  user_id = auth.uid() and deleted = false
  and exists (select 1 from public.live_rooms r where r.id = room_id and r.ended_at is null)
);

-- Slow down floods: at most 20 comments a minute per person per room.
create or replace function public.live_msg_rate() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.live_room_messages m where m.room_id = new.room_id and m.user_id = new.user_id and m.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Slow down a little.';
  end if;
  return new;
end $$;
drop trigger if exists live_msg_rate on public.live_room_messages;
create trigger live_msg_rate before insert on public.live_room_messages for each row execute function public.live_msg_rate();

-- Remove a comment: your own, or any comment in a room you host or co-host.
create or replace function public.delete_live_message(mid bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.live_room_messages m set deleted = true, body = null, image_url = null
  where m.id = mid and (m.user_id = auth.uid() or exists (
    select 1 from public.live_rooms r where r.id = m.room_id and (r.host_id = auth.uid() or auth.uid() = any(r.cohosts))));
end $$;
revoke all on function public.delete_live_message(bigint) from public, anon;
grant execute on function public.delete_live_message(bigint) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.live_room_messages;
exception when duplicate_object then null; end $$;
