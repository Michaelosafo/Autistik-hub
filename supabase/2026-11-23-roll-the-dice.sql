-- Roll the Dice: real AUTISTIK dice rounds (see lib/roll-dice.ts). Server only (service role).
create table if not exists public.roll_rounds (
  id bigserial primary key,
  status text not null default 'open' check (status in ('open','settling','settled','refunding','refunded')),
  created_at timestamptz not null default now(),
  closes_at timestamptz,
  pot_raw numeric not null default 0,
  winner_user uuid,
  winner_alias text,
  winner_addr text,
  payout_tx text,
  settled_at timestamptz,
  note text
);
create unique index if not exists roll_one_open on public.roll_rounds ((true)) where status = 'open';
create table if not exists public.roll_entries (
  round_id bigint not null references public.roll_rounds(id) on delete cascade,
  user_id uuid not null,
  alias text not null,
  address text not null,
  tx_hash text not null unique,
  amount_raw numeric not null,
  d1 smallint, d2 smallint,
  refund_tx text,
  created_at timestamptz not null default now(),
  primary key (round_id, user_id)
);
alter table public.roll_rounds enable row level security;
alter table public.roll_entries enable row level security;
revoke all on public.roll_rounds, public.roll_entries from anon, authenticated;
