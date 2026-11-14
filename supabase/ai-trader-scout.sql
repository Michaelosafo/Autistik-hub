-- AI trader: the Caller scout (already applied to the Autistik-hub project).
alter table public.ai_trader_settings
  add column if not exists scout_on boolean not null default false,
  add column if not exists scout_budget numeric not null default 40,
  add column if not exists scout_trade_usd numeric not null default 5,
  add column if not exists scout_min_win numeric not null default 97,
  add column if not exists scout_min_calls int not null default 5,
  add column if not exists scout_multiple numeric not null default 3,
  add column if not exists scout_fast_min int not null default 30,
  add column if not exists scout_group_rate numeric not null default 60,
  add column if not exists scout_trust_skip boolean not null default true,
  add column if not exists scout_honeypot_trusted boolean not null default true;
create table if not exists public.ai_scout_chats (
  trader_id int not null default 1, ref text not null, title text, kind text, username text,
  last_msg_id bigint, scanned_at timestamptz, enabled boolean not null default true, added_at timestamptz not null default now(),
  primary key (trader_id, ref)
);
alter table public.ai_scout_chats enable row level security;
create table if not exists public.ai_scout_calls (
  id bigserial primary key, trader_id int not null default 1, platform text not null, chat_ref text not null, chat_title text, who text,
  chain text not null, token text not null, symbol text, called_at timestamptz not null,
  price0 numeric, peak numeric, peak_at timestamptz, last numeric, x2_at timestamptz, rugged boolean, final boolean not null default false, checked_at timestamptz,
  unique (trader_id, platform, chat_ref, token)
);
create index if not exists ai_scout_calls_open on public.ai_scout_calls (trader_id, final, called_at);
create index if not exists ai_scout_calls_who on public.ai_scout_calls (trader_id, platform, who);
alter table public.ai_scout_calls enable row level security;
alter table public.ai_trader_sources add column if not exists scout boolean not null default false;
alter table public.ai_trader_sources add column if not exists scout_kind text;
alter table public.ai_trader_callers add column if not exists scout boolean not null default false;
alter table public.ai_trader_callers add column if not exists trusted boolean not null default false;
alter table public.ai_trader_positions add column if not exists pot text;
alter table public.ai_trader_pending add column if not exists pot text;
