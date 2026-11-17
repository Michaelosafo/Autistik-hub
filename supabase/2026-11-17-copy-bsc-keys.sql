-- Copy desk (BNB Chain): up to 5 of your own wallets (private keys in Vault) that buy whatever the copied wallets buy.
-- Slots 1–5 per Copy desk id. Keys never leave the database except to the server (service_role only).

alter table public.ai_futures_positions add column if not exists copy_slot smallint;

create or replace function public.ai_copy_key_get(p_id integer, p_slot integer) returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ai_copy_key_' || p_id || '_' || p_slot order by created_at desc limit 1;
$$;

create or replace function public.ai_copy_key_set(p_id integer, p_slot integer, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_slot < 1 or p_slot > 10 then raise exception 'slot must be 1 to 10'; end if;
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

-- Copy: switch the automatic stop-loss / take profit off (you sell yourself). On open trades, 0 = no stop / no target.
alter table public.ai_futures_settings add column if not exists copy_sl_on boolean not null default true;
alter table public.ai_futures_settings add column if not exists copy_tp_on boolean not null default true;

-- Copy: what each copy buy was paid with (BNB, USDT or USDC); it sells back into the same.
alter table public.ai_futures_positions add column if not exists copy_pay text;

-- Copy: speed and MEV protection.
alter table public.ai_futures_settings add column if not exists copy_gwei numeric not null default 0.3;
alter table public.ai_futures_settings add column if not exists copy_slip numeric not null default 12;
alter table public.ai_futures_settings add column if not exists copy_mev boolean not null default true;

-- BSC Sniper (desk 550000 + id): tokens to snipe and when to sell.
alter table public.ai_futures_settings add column if not exists liq_targets jsonb not null default '[]'::jsonb;
alter table public.ai_futures_settings add column if not exists liq_x numeric not null default 2;
alter table public.ai_futures_settings add column if not exists liq_sell_pct numeric not null default 100;
alter table public.ai_futures_settings add column if not exists liq_slip numeric not null default 20;
alter table public.ai_futures_settings add column if not exists liq_tp_on boolean not null default true;

-- Copy / Sniper: $ each of your wallets spends per buy (slot -> dollars). Missing = the normal buy amount.
alter table public.ai_futures_settings add column if not exists copy_key_usd jsonb not null default '{}'::jsonb;
