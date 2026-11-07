-- Live rooms: listeners' private wallets for drops, and the drops sent (applied as migration live_room_wallets).
-- See app/api/rooms/[id]/drop and components/rooms/RoomDrops.tsx.
create table if not exists public.live_room_wallets (
  room_id uuid not null references public.live_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  address text not null check (address ~ '^0x[0-9a-fA-F]{40}$'),
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.live_room_wallets enable row level security;
create policy "own wallet read" on public.live_room_wallets for select using (user_id = auth.uid());
create policy "own wallet add" on public.live_room_wallets for insert with check (user_id = auth.uid());
create policy "own wallet change" on public.live_room_wallets for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own wallet remove" on public.live_room_wallets for delete using (user_id = auth.uid());
create table if not exists public.live_room_drops (
  id bigserial primary key,
  room_id uuid not null references public.live_rooms(id) on delete cascade,
  host_id uuid not null references auth.users(id) on delete cascade,
  chain text not null, token text not null, symbol text, total text not null, recipients int not null, tx_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.live_room_drops enable row level security;
create policy "drops public read" on public.live_room_drops for select using (true);
