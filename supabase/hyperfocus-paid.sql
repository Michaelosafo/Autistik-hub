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

-- Added after review: live input count, and the checked queue for every transfer out of the game wallet.
alter table public.hf_entries add column if not exists steps integer not null default 0;
create table if not exists public.hf_transfers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('prize', 'marketing', 'refund')),
  room_id uuid references public.hf_rooms(id) on delete set null,
  entry_id uuid references public.hf_entries(id) on delete set null,
  to_wallet text not null,
  amount text not null,
  status text not null default 'queued' check (status in ('queued', 'signed', 'confirmed', 'failed')),
  nonce bigint, hash text, raw text, error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists hf_transfers_once on public.hf_transfers (kind, coalesce(entry_id, room_id));
create index if not exists hf_transfers_open on public.hf_transfers (status) where status in ('queued', 'signed');
alter table public.hf_transfers enable row level security;
create table if not exists public.hf_sender_lock (id integer primary key check (id = 1), holder text, until timestamptz not null default 'epoch');
insert into public.hf_sender_lock (id) values (1) on conflict do nothing;
alter table public.hf_sender_lock enable row level security;

-- Added after the second review: transfer retry count; one seat per wallet checked inside hf_join (see migration
-- hyperfocus_paid_review2 for the current hf_join body: a duplicate entry is marked 'left' and refunded).
alter table public.hf_transfers add column if not exists attempts integer not null default 0;

-- Current hf_join (one seat per wallet, checked under the advisory lock). A second paid entry from a wallet already in
-- a waiting or running race is marked 'left' in this same transaction and returned as 'duplicate'; the server refunds it.
create or replace function public.hf_join(p_entry uuid)
returns table (room_id uuid, players integer, room_status text)
language plpgsql security definer set search_path = public as $$
declare r uuid; n integer; w text;
begin
  perform pg_advisory_xact_lock(hashtext('hf_rooms'));
  select e.room_id, lower(e.wallet) into r, w from hf_entries e where e.id = p_entry and e.status = 'paid';
  if not found then raise exception 'entry not paid'; end if;
  if r is null then
    if exists (select 1 from hf_entries x join hf_rooms h on h.id = x.room_id
               where lower(x.wallet) = w and x.status = 'paid' and x.id <> p_entry and h.status in ('waiting', 'racing')) then
      update hf_entries set status = 'left' where id = p_entry;
      return query select null::uuid, 0, 'duplicate'::text;
      return;
    end if;
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
revoke all on function public.hf_join(uuid) from public, anon, authenticated;
grant execute on function public.hf_join(uuid) to service_role;
