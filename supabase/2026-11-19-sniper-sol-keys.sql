-- Solana address for each sniper/copy wallet slot. The secret stays in Vault, next to the EVM key
-- (ai_copy_key_<desk>_<slot>). Run once in the Supabase SQL editor.

create or replace function public.ai_copy_sol_key_get(p_id integer, p_slot integer) returns text
language sql security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'ai_copy_sol_' || p_id || '_' || p_slot order by created_at desc limit 1;
$$;

create or replace function public.ai_copy_sol_key_set(p_id integer, p_slot integer, p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_slot < 1 or p_slot > 13 then raise exception 'bad slot'; end if;
  if p_key is null or length(p_key) < 64 then raise exception 'bad key'; end if;
  delete from vault.secrets where name = 'ai_copy_sol_' || p_id || '_' || p_slot;
  perform vault.create_secret(p_key, 'ai_copy_sol_' || p_id || '_' || p_slot, 'Sniper wallet ' || p_slot || ' Solana key');
end;
$$;

revoke all on function public.ai_copy_sol_key_get(integer, integer) from public, anon, authenticated;
revoke all on function public.ai_copy_sol_key_set(integer, integer, text) from public, anon, authenticated;
grant execute on function public.ai_copy_sol_key_get(integer, integer) to service_role;
grant execute on function public.ai_copy_sol_key_set(integer, integer, text) to service_role;
