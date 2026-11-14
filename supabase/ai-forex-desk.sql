-- The Forex trader has its own id (100000 + the admin's AI trader id). Tie every futures/forex trader to its
-- admin's AI trader through owner_id instead of the id itself, so Forex rows are allowed and still cascade.
alter table public.ai_futures_settings
  add column if not exists owner_id integer generated always as (case when id >= 100000 then id - 100000 else id end) stored;
alter table public.ai_futures_settings drop constraint if exists ai_futures_settings_id_fkey;
alter table public.ai_futures_settings
  add constraint ai_futures_settings_owner_id_fkey foreign key (owner_id) references public.ai_trader_settings(id) on delete cascade;
