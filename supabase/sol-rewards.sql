-- Solana holder rewards (lib/solana-rewards.ts). A coin's fee is collected by the AUTISTIK rewards wallet, split
-- (AUTISTIK, holders, creator) and the holders' part is shared by balance. What each holder is owed lives here.

create table if not exists public.sol_reward_coins (
  mint text primary key,
  creator text not null,
  user_id uuid references auth.users(id) on delete set null,
  reward text not null check (reward in ('sol', 'btc', 'eth')),
  fee_bps integer not null check (fee_bps between 1 and 1000),          -- the creator's fee on every transfer
  platform_bps integer not null check (platform_bps between 0 and 100), -- the AUTISTIK fee on every transfer
  holder_bps integer not null check (holder_bps between 1 and 10000),   -- share of the creator's fee that goes to holders
  tax_wallet text not null,
  pool text,
  active boolean not null default false,
  pending_tokens numeric not null default 0, -- holders' part collected but not yet swapped into the reward
  collected numeric not null default 0,      -- coin units collected so far
  distributed numeric not null default 0,    -- reward units credited to holders so far
  last_run timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.sol_reward_owed (
  mint text not null references public.sol_reward_coins(mint) on delete cascade,
  holder text not null,
  owed numeric not null default 0, -- everything credited (reward base units)
  paid numeric not null default 0, -- everything sent (or being sent right now)
  updated_at timestamptz not null default now(),
  primary key (mint, holder)
);
create index if not exists sol_reward_owed_due on public.sol_reward_owed (mint, ((owed - paid)) desc);
alter table public.sol_reward_coins enable row level security;
alter table public.sol_reward_owed enable row level security;
revoke all on public.sol_reward_coins from public, anon, authenticated;
revoke all on public.sol_reward_owed from public, anon, authenticated;
grant all on public.sol_reward_coins, public.sol_reward_owed to service_role;

create or replace function public.sol_rewards_credit(p_mint text, p_rows jsonb) returns void language sql security definer set search_path to 'public' as $$
  insert into public.sol_reward_owed (mint, holder, owed)
  select p_mint, r->>'h', (r->>'a')::numeric from jsonb_array_elements(p_rows) r
  on conflict (mint, holder) do update set owed = public.sol_reward_owed.owed + excluded.owed, updated_at = now();
$$;

-- Marks what's due as paid BEFORE it's sent, so a holder is never paid twice (sol_rewards_refund undoes a failed send).
create or replace function public.sol_rewards_take(p_mint text, p_holder text, p_min numeric) returns numeric language sql security definer set search_path to 'public' as $$
  with due as (
    select o.holder, o.owed - o.paid as amount from public.sol_reward_owed o
    where o.mint = p_mint and o.holder = p_holder and o.owed - o.paid >= p_min for update
  )
  update public.sol_reward_owed o set paid = o.paid + due.amount, updated_at = now() from due
  where o.mint = p_mint and o.holder = due.holder
  returning due.amount;
$$;
create or replace function public.sol_rewards_take_many(p_mint text, p_min numeric, p_limit integer) returns table (holder text, amount numeric) language sql security definer set search_path to 'public' as $$
  with due as (
    select o.holder, o.owed - o.paid as amount from public.sol_reward_owed o
    where o.mint = p_mint and o.owed - o.paid >= p_min order by o.owed - o.paid desc limit p_limit for update skip locked
  )
  update public.sol_reward_owed o set paid = o.paid + due.amount, updated_at = now() from due
  where o.mint = p_mint and o.holder = due.holder
  returning due.holder, due.amount;
$$;
create or replace function public.sol_rewards_refund(p_mint text, p_holder text, p_amount numeric) returns void language sql security definer set search_path to 'public' as $$
  update public.sol_reward_owed set paid = greatest(0, paid - p_amount), updated_at = now() where mint = p_mint and holder = p_holder;
$$;

create table if not exists public.sol_rewards_state (id int primary key default 1 check (id = 1), last_run timestamptz not null default 'epoch');
insert into public.sol_rewards_state (id) values (1) on conflict do nothing;
alter table public.sol_rewards_state enable row level security;
revoke all on public.sol_rewards_state from public, anon, authenticated;
create or replace function public.sol_rewards_lease(p_seconds integer) returns boolean language sql security definer set search_path to 'public' as $$
  update public.sol_rewards_state set last_run = now() where id = 1 and last_run < now() - make_interval(secs => p_seconds) returning true;
$$;

revoke all on function public.sol_rewards_credit(text, jsonb) from public, anon, authenticated;
revoke all on function public.sol_rewards_take(text, text, numeric) from public, anon, authenticated;
revoke all on function public.sol_rewards_take_many(text, numeric, integer) from public, anon, authenticated;
revoke all on function public.sol_rewards_refund(text, text, numeric) from public, anon, authenticated;
revoke all on function public.sol_rewards_lease(integer) from public, anon, authenticated;
grant execute on function public.sol_rewards_credit(text, jsonb), public.sol_rewards_take(text, text, numeric),
  public.sol_rewards_take_many(text, numeric, integer), public.sol_rewards_refund(text, text, numeric), public.sol_rewards_lease(integer) to service_role;

select cron.schedule('autistik-sol-rewards', '*/10 * * * *', $$ select net.http_get('https://autistik.io/api/launchpad/solana-rewards') $$);
