-- Dev watch: members follow a token's deployer (automatically when they scan it); the analytics cron checks each
-- followed dev about every 30 minutes and alerts followers when the same deployer creates a new token.
-- Server (service role) only.
create table if not exists public.dev_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  chain text not null,
  wallet text not null,
  from_token text,
  created_at timestamptz not null default now(),
  primary key (user_id, chain, wallet)
);
create index if not exists dev_follows_dev on public.dev_follows (chain, wallet);
create table if not exists public.dev_watch (
  chain text not null,
  wallet text not null,
  known text[] not null default '{}',
  checked_at timestamptz,
  primary key (chain, wallet)
);
alter table public.dev_follows enable row level security;
alter table public.dev_watch enable row level security;
revoke all on public.dev_follows, public.dev_watch from anon, authenticated;
