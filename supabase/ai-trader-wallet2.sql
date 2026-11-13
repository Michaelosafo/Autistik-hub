-- Wallet 2 (already applied): see migration ai_trader_wallet2. A second trading wallet per network, kept in Vault.
alter table public.ai_trader_positions add column if not exists wallet smallint not null default 1 check (wallet in (1, 2));
create or replace function private.ai_trader_w2_name(p_trader integer, p_kind text) returns text language sql immutable as $$
  select case when p_kind = 'sol' then 'ai_trader_sol_key2_' else 'ai_trader_key2_' end || p_trader;
$$;
create or replace function public.ai_trader_w2_get(p_trader integer, p_kind text) returns text
language sql stable security definer set search_path to '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = private.ai_trader_w2_name(p_trader, p_kind) order by created_at desc limit 1;
$$;
create or replace function public.ai_trader_w2_set(p_trader integer, p_kind text, p_key text) returns void
language plpgsql security definer set search_path to '' as $$
declare nm text := private.ai_trader_w2_name(p_trader, p_kind);
begin
  if p_kind not in ('evm', 'sol') then raise exception 'bad kind'; end if;
  if not exists (select 1 from public.ai_trader_settings where id = p_trader) then raise exception 'no such trader'; end if;
  if p_key is not null then
    if p_kind = 'evm' and p_key !~ '^0x[0-9a-fA-F]{64}$' then raise exception 'bad key'; end if;
    if p_kind = 'sol' and p_key !~ '^\[(\d{1,3},){63}\d{1,3}\]$' then raise exception 'bad key'; end if;
  end if;
  delete from vault.secrets where name = nm;
  if p_key is not null then perform vault.create_secret(p_key, nm, 'AI trader wallet 2 (' || p_kind || ') for trader ' || p_trader); end if;
end $$;
revoke all on function private.ai_trader_w2_name(integer, text) from public, anon, authenticated;
revoke all on function public.ai_trader_w2_get(integer, text) from public, anon, authenticated;
revoke all on function public.ai_trader_w2_set(integer, text, text) from public, anon, authenticated;
grant execute on function public.ai_trader_w2_get(integer, text) to service_role;
grant execute on function public.ai_trader_w2_set(integer, text, text) to service_role;
