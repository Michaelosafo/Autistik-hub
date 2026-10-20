-- =====================================================================
-- AUTISTIK Hub: AI budget. Safe to run more than once.
-- Supabase → SQL Editor → New query → paste all of this → Run.
--   1. Records what every AI request uses (tokens per model per day), so the Admin page can show the AI's real
--      cost next to AI Pass income.
--   2. Limits the Launch Pad's AI guide (Autistik) to 2 launch sessions per member per day, and 30 messages
--      per session. The quick launch form has no limit.
-- =====================================================================

-- ---------- 1. AI usage per model per day ----------
create table if not exists public.ai_costs (
  day date not null default current_date,
  model text not null,
  feature text not null,
  requests int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (day, model, feature)
);
alter table public.ai_costs enable row level security;
-- No policies: only the server writes it; the Admin page reads it on the server after checking the owner.

create or replace function public.log_ai_cost(p_model text, p_feature text, p_in bigint, p_out bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.ai_costs (day, model, feature, requests, input_tokens, output_tokens)
  values (current_date, left(p_model, 60), left(p_feature, 30), 1, greatest(p_in, 0), greatest(p_out, 0))
  on conflict (day, model, feature) do update set
    requests = public.ai_costs.requests + 1,
    input_tokens = public.ai_costs.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_costs.output_tokens + excluded.output_tokens;
$$;
revoke all on function public.log_ai_cost(text, text, bigint, bigint) from public, anon, authenticated;

-- ---------- 2. AI launch sessions ----------
create table if not exists public.launch_ai_sessions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id text not null,
  day date not null default current_date,
  messages int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, session_id)
);
create index if not exists launch_ai_sessions_day on public.launch_ai_sessions (user_id, day);
alter table public.launch_ai_sessions enable row level security;
-- No policies: only the server can touch it.

-- Counts one message in an AI launch session. A new session is only allowed while the member has started
-- fewer than p_max today. Returns {ok, reason ('sessions' | 'messages'), sessions_left}.
create or replace function public.launch_ai_turn(p_user uuid, p_session text, p_max int, p_max_messages int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare used int; m int; adm boolean;
begin
  select coalesce(is_admin, false) into adm from public.profiles where id = p_user;
  select count(*) into used from public.launch_ai_sessions where user_id = p_user and day = current_date;

  update public.launch_ai_sessions set messages = messages + 1
  where user_id = p_user and session_id = p_session and day = current_date
  returning messages into m;

  if m is null then
    if used >= p_max and not adm then
      return jsonb_build_object('ok', false, 'reason', 'sessions', 'sessions_left', 0);
    end if;
    insert into public.launch_ai_sessions (user_id, session_id, day, messages) values (p_user, p_session, current_date, 1)
    on conflict (user_id, session_id) do update set day = current_date, messages = 1  -- a session from an earlier day starts again today
    returning messages into m;
    used := used + 1;
  end if;

  if m > p_max_messages and not adm then
    return jsonb_build_object('ok', false, 'reason', 'messages', 'sessions_left', greatest(p_max - used, 0));
  end if;
  return jsonb_build_object('ok', true, 'sessions_left', case when adm then p_max else greatest(p_max - used, 0) end);
end; $$;
revoke all on function public.launch_ai_turn(uuid, text, int, int) from public, anon, authenticated;
