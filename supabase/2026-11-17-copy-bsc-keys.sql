-- Copy desk (BNB Chain): up to 2 of your own wallets (private keys in Vault) that buy whatever the copied wallets buy.
-- Slot 1 and 2 per Copy desk id. Keys never leave the database except to the server (service_role only).

alter table public.ai_futures_positions add column if not exists copy_slot smallint;

create or replace function public.ai_copy_key_get(p_id integer, p_slot integer) returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ai_copy_key_' || p_id || '_' || p_slot order by created_at desc limit 1;
$$;

create or replace function public.ai_copy_key_set(p_id integer, p_slot integer, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_slot not in (1, 2) then raise exception 'slot must be 1 or 2'; end if;
  if p_key !~ '^0x[0-9a-fA-F]{64}$' then raise exception 'bad key'; end if;
  delete from vault.secrets where name = 'ai_copy_key_' || p_id || '_' || p_slot;
  perform vault.create_secret(p_key, 'ai_copy_key_' || p_id || '_' || p_slot, 'Copy desk BSC wallet ' || p_slot);
end $$;

create or replace function public.ai_copy_key_del(p_id integer, p_slot integer) returns void
language sql security definer set search_path = '' as $$
  delete from vault.secrets where name = 'ai_copy_key_' || p_id || '_' || p_slot;
$$;

revoke all on function public.ai_copy_key_get(integer, integer) from public, anon, authenticated;
revoke all on function public.ai_copy_key_set(integer, integer, text) from public, anon, authenticated;
revoke all on function public.ai_copy_key_del(integer, integer) from public, anon, authenticated;
grant execute on function public.ai_copy_key_get(integer, integer) to service_role;
grant execute on function public.ai_copy_key_set(integer, integer, text) to service_role;
grant execute on function public.ai_copy_key_del(integer, integer) to service_role;
