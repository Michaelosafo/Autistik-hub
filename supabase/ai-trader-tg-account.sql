-- AI trader: log in with your own Telegram account (lib/tg-account.ts). Each trader can sign in with their Telegram
-- account; the signed-in session is kept in Vault (ai_trader_tg_session_<trader id>), only the server can read it.
-- Followed chats are sources of kind 'tg_chat' (ref "c:<id>:<accessHash>" or "g:<id>"), read every minute from the
-- last message id seen. Run after ai-trader-multi.sql.

alter table public.ai_trader_sources drop constraint if exists ai_trader_sources_kind_check;
alter table public.ai_trader_sources add constraint ai_trader_sources_kind_check check (kind in ('tg', 'tg_chat', 'x_account', 'x_list', 'x_community'));
alter table public.ai_trader_sources add column if not exists handle text;        -- public @username of a chat, for links
alter table public.ai_trader_sources add column if not exists last_msg_id bigint; -- tg_chat: last message read

-- Sign-in in progress and who is signed in. Service role only (no policies). The half-finished session is cleared
-- as soon as the sign-in completes; the real session lives in Vault.
create table if not exists public.ai_trader_tg_auth (
  id int primary key references public.ai_trader_settings (id) on delete cascade,
  phone text,
  code_hash text,
  pending_session text,
  pending_at timestamptz,
  account_name text,
  signed_in_at timestamptz
);
alter table public.ai_trader_tg_auth enable row level security;
revoke all on public.ai_trader_tg_auth from anon, authenticated;

create or replace function public.ai_trader_tg_session_get_for(p_trader integer) returns text
language sql stable security definer set search_path to '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ai_trader_tg_session_' || p_trader order by created_at desc limit 1;
$$;
create or replace function public.ai_trader_tg_session_set_for(p_trader integer, p_session text) returns void
language plpgsql security definer set search_path to '' as $$
declare nm text := 'ai_trader_tg_session_' || p_trader;
begin
  if not exists (select 1 from public.ai_trader_settings where id = p_trader) then raise exception 'no such trader'; end if;
  delete from vault.secrets where name = nm;
  if p_session is not null and length(p_session) > 0 then
    perform vault.create_secret(p_session, nm, 'AI trader Telegram account session for trader ' || p_trader);
  end if;
end $$;
revoke all on function public.ai_trader_tg_session_get_for(integer) from public, anon, authenticated;
revoke all on function public.ai_trader_tg_session_set_for(integer, text) from public, anon, authenticated;
grant execute on function public.ai_trader_tg_session_get_for(integer) to service_role;
grant execute on function public.ai_trader_tg_session_set_for(integer, text) to service_role;
