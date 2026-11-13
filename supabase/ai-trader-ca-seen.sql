-- First call only (already applied as migration ai_trader_ca_first_seen): every CA a trader has seen in a call.
create table if not exists public.ai_trader_ca_seen (
  trader_id int not null references public.ai_trader_settings (id) on delete cascade,
  token text not null,
  first_at timestamptz not null default now(),
  first_from text,
  primary key (trader_id, token)
);
alter table public.ai_trader_ca_seen enable row level security;
