-- AUTISTIK Dice: a play-chips dice game (no real money). One shared round every 30 seconds: players put chips
-- in the pot, everyone rolls two dice when the round closes, the highest total takes the pot (ties split it).
-- A lone player faces the House, which matches their stake. All chips, bets and rolls are handled here on the
-- server (random rolls from gen_random_bytes), called only by the site's API with the service role.
create table if not exists public.dice_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  alias text,
  chips bigint not null default 1000 check (chips >= 0),
  won bigint not null default 0,
  played integer not null default 0,
  refilled_at timestamptz not null default now()
);
create table if not exists public.dice_rounds (
  id bigint primary key,            -- floor(epoch seconds / 30)
  pot bigint not null default 0,
  settled_at timestamptz,
  winners text[]
);
create table if not exists public.dice_bets (
  round_id bigint not null references public.dice_rounds(id) on delete cascade,
  user_id uuid,                     -- null for the House
  alias text not null,
  stake bigint not null check (stake > 0),
  d1 smallint, d2 smallint,
  payout bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (round_id, alias)
);
create unique index if not exists dice_bets_one_per_user on public.dice_bets (round_id, user_id) where user_id is not null;
alter table public.dice_wallets enable row level security;
alter table public.dice_rounds enable row level security;
alter table public.dice_bets enable row level security;
revoke all on public.dice_wallets, public.dice_rounds, public.dice_bets from anon, authenticated;

create extension if not exists pgcrypto with schema extensions;

create or replace function public.dice_roll() returns smallint language sql volatile set search_path = '' as $$
  select (1 + (get_byte(extensions.gen_random_bytes(1), 0) % 6))::smallint;  -- 256 % 6 bias is tiny for play chips
$$;

-- Put chips into the current round (one bet per player per round; the stake comes out of their chips).
create or replace function public.dice_bet(p_user uuid, p_alias text, p_round bigint, p_stake bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare left_ bigint;
begin
  if p_stake < 1 or p_stake > 100000 then raise exception 'Stake 1 to 100,000 chips.'; end if;
  insert into public.dice_wallets (user_id, alias) values (p_user, p_alias) on conflict (user_id) do update set alias = excluded.alias;
  update public.dice_wallets set chips = chips - p_stake where user_id = p_user and chips >= p_stake returning chips into left_;
  if left_ is null then raise exception 'Not enough chips.'; end if;
  insert into public.dice_rounds (id) values (p_round) on conflict (id) do nothing;
  if exists (select 1 from public.dice_rounds where id = p_round and settled_at is not null) then raise exception 'That round is over.'; end if;
  begin
    insert into public.dice_bets (round_id, user_id, alias, stake) values (p_round, p_user, left(coalesce(nullif(btrim(p_alias), ''), 'Player'), 24), p_stake);
  exception when unique_violation then
    raise exception 'You are already in this round.';
  end;
  update public.dice_rounds set pot = pot + p_stake where id = p_round;
  return left_;
end $$;

-- Roll a closed round: everyone rolls two dice, highest total takes the pot (ties split). Runs once.
create or replace function public.dice_settle(p_round bigint) returns void language plpgsql security definer set search_path = '' as $$
declare r record; n int; best int; wins int; share bigint; pot_ bigint;
begin
  select * into r from public.dice_rounds where id = p_round for update;
  if r is null or r.settled_at is not null then return; end if;
  select count(*) into n from public.dice_bets where round_id = p_round;
  if n = 0 then update public.dice_rounds set settled_at = now() where id = p_round; return; end if;
  if n = 1 then
    insert into public.dice_bets (round_id, user_id, alias, stake) select p_round, null, '🤖 House', stake from public.dice_bets where round_id = p_round;
  end if;
  update public.dice_bets set d1 = public.dice_roll(), d2 = public.dice_roll() where round_id = p_round;
  select max(d1 + d2) into best from public.dice_bets where round_id = p_round;
  select count(*) into wins from public.dice_bets where round_id = p_round and d1 + d2 = best;
  select sum(stake) into pot_ from public.dice_bets where round_id = p_round;
  share := pot_ / wins;
  update public.dice_bets set payout = share where round_id = p_round and d1 + d2 = best;
  update public.dice_wallets w set chips = w.chips + b.payout, won = w.won + greatest(b.payout - b.stake, 0), played = w.played + 1
    from public.dice_bets b where b.round_id = p_round and b.user_id = w.user_id;
  update public.dice_rounds set pot = pot_, settled_at = now(),
    winners = (select array_agg(alias) from public.dice_bets where round_id = p_round and d1 + d2 = best) where id = p_round;
end $$;

-- Free top-up: back to 1,000 chips once a day when you're under 100.
create or replace function public.dice_refill(p_user uuid) returns bigint language plpgsql security definer set search_path = '' as $$
declare c bigint;
begin
  update public.dice_wallets set chips = 1000, refilled_at = now()
    where user_id = p_user and chips < 100 and refilled_at < now() - interval '24 hours' returning chips into c;
  if c is null then raise exception 'Free chips come back once a day when you have under 100.'; end if;
  return c;
end $$;

revoke all on function public.dice_roll(), public.dice_bet(uuid, text, bigint, bigint), public.dice_settle(bigint), public.dice_refill(uuid) from public, anon, authenticated;
