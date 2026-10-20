-- AI Pass: 15 free messages a day per account, then a paid pass ($5 of BNB = 30 days) to keep using Believer and Purity.
-- Safe to run more than once. Supabase → SQL Editor → New query → paste all of this → Run.

-- Paid passes. Each BNB payment can only be used once (tx_hash is unique).
create table if not exists public.ai_passes (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tx_hash text not null unique,
  payer text not null,
  amount_wei text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_passes_user on public.ai_passes (user_id, ends_at desc);
alter table public.ai_passes enable row level security;
drop policy if exists "own passes" on public.ai_passes;
create policy "own passes" on public.ai_passes for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- No insert/update/delete policies: only the server (after checking the payment on BNB Chain) can add a pass.

-- Free messages used per account today (resets every day at midnight UTC).
create table if not exists public.ai_trials (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  used int not null default 0
);
alter table public.ai_trials add column if not exists day date not null default current_date;
alter table public.ai_trials enable row level security;
-- No policies: only the server can touch it.

-- One call per AI request. Checks today's limit, then the pass or today's free messages, all in the database so
-- it can't be raced. p_free = free messages per day. Returns {ok, reason ('limit' | 'pay'), free_left, pass_until}.
create or replace function public.ai_spend(p_user uuid, p_free int, p_limit int, p_cost int default 1, p_needs_pass boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n int; t int; until timestamptz; adm boolean;
begin
  insert into public.ai_usage (user_id, day, count) values (p_user, current_date, p_cost)
  on conflict (user_id, day) do update set count = public.ai_usage.count + p_cost
  returning count into n;
  if n > p_limit then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;

  select max(ends_at) into until from public.ai_passes where user_id = p_user and starts_at <= now() and ends_at > now();
  select is_admin into adm from public.profiles where id = p_user;
  if not p_needs_pass or coalesce(adm, false) or until is not null then
    return jsonb_build_object('ok', true, 'pass_until', until);
  end if;

  -- Today's free messages (a new day starts again from zero).
  if p_free > 0 then
    insert into public.ai_trials as tr (user_id, used, day) values (p_user, p_cost, current_date)
    on conflict (user_id) do update set
      used = case when tr.day = current_date then tr.used + p_cost else p_cost end,
      day = current_date
    where (case when tr.day = current_date then tr.used + p_cost else p_cost end) <= p_free
    returning used into t;
    if t is not null and t > p_free then t := null; end if;  -- a first request bigger than the allowance
  end if;
  if t is null then
    -- Not allowed: give back today's count so it isn't wasted.
    update public.ai_usage set count = greatest(count - p_cost, 0) where user_id = p_user and day = current_date;
    return jsonb_build_object('ok', false, 'reason', 'pay', 'free_left',
      greatest(p_free - coalesce((select used from public.ai_trials where user_id = p_user and day = current_date), 0), 0));
  end if;
  return jsonb_build_object('ok', true, 'free_left', greatest(p_free - t, 0));
end; $$;
revoke all on function public.ai_spend(uuid, int, int, int, boolean) from public, anon, authenticated;
