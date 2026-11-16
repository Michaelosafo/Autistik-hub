-- Big lives (1,000+ people): listeners check in every 30 seconds instead of each one sending live updates to the
-- whole room. The room count and the listener list come from these check-ins. Safe to run more than once.
alter table public.live_room_attendance add column if not exists last_seen timestamptz not null default now();
alter table public.live_room_attendance add column if not exists hidden boolean not null default false;
create index if not exists live_room_attendance_seen on public.live_room_attendance (room_id, last_seen desc);
