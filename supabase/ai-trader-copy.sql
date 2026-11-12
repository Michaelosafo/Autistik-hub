-- AI trader copy-trading (owner only): the owner links their Telegram and X, picks Telegram groups and X accounts,
-- Lists and Communities to follow, and every coin (contract address) posted there is bought, then sold at the
-- copy take profit (default +100%, i.e. 2x) or copy stop-loss (default -5%). Only a honeypot / extreme-tax check
-- runs before these buys. The engine uses the service role; admins can read settings and sources, nobody can read
-- the X tokens.

alter table public.ai_trader_settings
  add column if not exists copy_on boolean not null default true,
  add column if not exists copy_tp numeric not null default 100 check (copy_tp between 10 and 2000),
  add column if not exists copy_sl numeric not null default 5 check (copy_sl between 1 and 90),
  add column if not exists tg_user_id bigint,
  add column if not exists tg_username text,
  add column if not exists tg_link_code text,
  add column if not exists tg_link_until timestamptz,
  add column if not exists x_user_id text,
  add column if not exists x_username text;

-- What the trader follows. kind: tg (a Telegram group / channel the bot is in), x_account (@handle), x_list, x_community.
create table if not exists public.ai_trader_sources (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('tg', 'x_account', 'x_list', 'x_community')),
  ref text not null,                     -- Telegram chat id, X handle, X list id or X community id
  title text,
  enabled boolean not null default false,
  polled_at timestamptz not null default 'epoch',  -- X lists / communities: last time they were read
  last_post_at timestamptz,
  added_at timestamptz not null default now(),
  unique (kind, ref)
);

-- The owner's X sign-in (OAuth 2.0). Service role only: no policies, so nobody else can read it.
create table if not exists public.ai_trader_x_auth (
  id int primary key default 1 check (id = 1),
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  pkce_verifier text,
  state text,
  state_at timestamptz
);
insert into public.ai_trader_x_auth (id) values (1) on conflict do nothing;

alter table public.ai_trader_sources enable row level security;
alter table public.ai_trader_x_auth enable row level security;
drop policy if exists "ai trader admin sources" on public.ai_trader_sources;
create policy "ai trader admin sources" on public.ai_trader_sources for select using (public.is_admin());
