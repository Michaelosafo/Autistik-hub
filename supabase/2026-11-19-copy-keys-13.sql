-- Copy / BSC Sniper: up to 13 of your own wallets (was 10). Applied to production 2026-11-19.
create or replace function public.ai_copy_key_set(p_id integer, p_slot integer, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_slot < 1 or p_slot > 13 then raise exception 'slot must be 1 to 13'; end if;
  if p_key !~ '^0x[0-9a-fA-F]{64}$' then raise exception 'bad key'; end if;
  delete from vault.secrets where name = 'ai_copy_key_' || p_id || '_' || p_slot;
  perform vault.create_secret(p_key, 'ai_copy_key_' || p_id || '_' || p_slot, 'Copy desk BSC wallet ' || p_slot);
end $$;
revoke all on function public.ai_copy_key_set(integer, integer, text) from public, anon, authenticated;
grant execute on function public.ai_copy_key_set(integer, integer, text) to service_role;
