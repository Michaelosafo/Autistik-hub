-- Desks: Futures = id, Forex = 100000 + id, Earn = 200000 + id. desk_owner is the admin's AI trader id for all of them.
alter table public.ai_futures_settings add column if not exists desk_owner integer generated always as (id % 100000) stored;
alter table public.ai_futures_settings add constraint ai_futures_settings_desk_owner_fkey foreign key (desk_owner) references public.ai_trader_settings(id) on delete cascade;
alter table public.ai_futures_settings drop constraint if exists ai_futures_settings_owner_id_fkey;
