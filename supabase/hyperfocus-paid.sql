-- Hyperfocus GP paid races: $0.50 of $AUTISTIK to enter, rooms of 10, top 5 paid automatically.
-- Only the server (service role) reads or writes these tables.

create table if not exists public.hf_rooms (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'waiting' check (status in ('waiting', 'racing', 'settling', 'paid', 'failed')),
  seed integer not null,
  start_at timestamptz,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  pot text,
  marketing_tx text,
  error text
);
create index if not exists hf_rooms_status_idx on public.hf_rooms (status, created_at);

create table if not exists public.hf_entries (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.hf_rooms(id) on delete set null,
  wallet text not null,
  name text not null,
  car text not null default 'street',
  color text,
  nonce text not null unique,
  secret_hash text not null,
  amount text not null,
  received text,
  tx_hash text unique,
  status text not null default 'quoted' check (status in ('quoted', 'paid', 'left', 'refunded')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  inputs text,
  pos double precision,
  finished boolean,
  ft integer,
  submitted_at timestamptz,
  place integer,
  payout text,
  payout_tx text,
  refund_tx text
);
create index if not exists hf_entries_room_idx on public.hf_entries (room_id);
create index if not exists hf_entries_wallet_idx on public.hf_entries (lower(wallet));

alter table public.hf_rooms enable row level security;
alter table public.hf_entries enable row level security;

-- Puts a paid entry in the oldest room with space (or a new one). The 10th player starts the race in 20 seconds.
create or replace function public.hf_join(p_entry uuid)
returns table (room_id uuid, players integer, room_status text)
language plpgsql security definer set search_path = public as $$
declare r uuid; n integer;
begin
  perform pg_advisory_xact_lock(hashtext('hf_rooms'));
  select e.room_id into r from hf_entries e where e.id = p_entry and e.status = 'paid';
  if not found then raise exception 'entry not paid'; end if;
  if r is null then
    select h.id into r from hf_rooms h
      where h.status = 'waiting' and (select count(*) from hf_entries x where x.room_id = h.id and x.status = 'paid') < 10
      order by h.created_at limit 1;
    if r is null then
      insert into hf_rooms (status, seed) values ('waiting', floor(random() * 2147483646)::integer + 1) returning id into r;
    end if;
    update hf_entries set room_id = r where id = p_entry;
  end if;
  select count(*) into n from hf_entries x where x.room_id = r and x.status = 'paid';
  if n >= 10 then
    update hf_rooms set status = 'racing', start_at = now() + interval '20 seconds' where id = r and status = 'waiting';
  end if;
  return query select r, n, (select h.status from hf_rooms h where h.id = r);
end $$;

-- Leaving is only allowed while the room is still waiting. Returns true when the entry left (and is due a refund).
create or replace function public.hf_leave(p_entry uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  perform pg_advisory_xact_lock(hashtext('hf_rooms'));
  update hf_entries e set status = 'left'
    where e.id = p_entry and e.status = 'paid'
      and (e.room_id is null or exists (select 1 from hf_rooms h where h.id = e.room_id and h.status = 'waiting'))
    returning true into ok;
  return coalesce(ok, false);
end $$;

revoke all on function public.hf_join(uuid) from public, anon, authenticated;
revoke all on function public.hf_leave(uuid) from public, anon, authenticated;
grant execute on function public.hf_join(uuid) to service_role;
grant execute on function public.hf_leave(uuid) to service_role;
