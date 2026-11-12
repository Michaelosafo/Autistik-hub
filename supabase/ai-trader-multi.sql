-- AI trader for every admin: the owner and each admin they add get their own trader (settings row), with their own
-- wallet (Vault secret ai_trader_key for trader 1, the owner's; ai_trader_key_<id> for the others), Telegram / X
-- logins, followed sources, positions, signals and log. Trader 1 keeps everything from before and belongs to the owner.
-- Run after ai-trader-copy.sql. The engine (service role) always filters by trader_id.

-- Settings: one row per admin.
alter table public.ai_trader_settings drop constraint if exists ai_trader_settings_id_check;
create sequence if not exists public.ai_trader_settings_id_seq owned by public.ai_trader_settings.id;
select setval('public.ai_trader_settings_id_seq', greatest(1, (select max(id) from public.ai_trader_settings)), true);
alter table public.ai_trader_settings alter column id set default nextval('public.ai_trader_settings_id_seq');
alter table public.ai_trader_settings add column if not exists user_id uuid unique references auth.users (id) on delete cascade;
-- Trader 1 is the owner's (the account on the owner email list).
update public.ai_trader_settings set user_id = (
  select u.id from auth.users u join private.admin_emails a on a.email = lower(u.email) order by a.added_at limit 1
) where id = 1 and user_id is null;
create unique index if not exists ai_trader_settings_tg_user on public.ai_trader_settings (tg_user_id) where tg_user_id is not null;
create unique index if not exists ai_trader_settings_tg_code on public.ai_trader_settings (tg_link_code) where tg_link_code is not null;

-- Every per-trader table gets trader_id (existing rows are the owner's).
alter table public.ai_trader_positions add column if not exists trader_id int not null default 1 references public.ai_trader_settings (id) on delete cascade;
alter table public.ai_trader_log add column if not exists trader_id int not null default 1 references public.ai_trader_settings (id) on delete cascade;
alter table public.ai_trader_signals add column if not exists trader_id int not null default 1 references public.ai_trader_settings (id) on delete cascade;
alter table public.ai_trader_sources add column if not exists trader_id int not null default 1 references public.ai_trader_settings (id) on delete cascade;
create index if not exists ai_trader_positions_trader on public.ai_trader_positions (trader_id, status);
create index if not exists ai_trader_log_trader on public.ai_trader_log (trader_id, at desc);
create index if not exists ai_trader_signals_trader on public.ai_trader_signals (trader_id, at desc);

-- Uniqueness is per trader.
drop index if exists public.ai_trader_one_open_per_token;
create unique index if not exists ai_trader_one_open_per_token_t on public.ai_trader_positions (trader_id, mode, chain, lower(token)) where status <> 'closed';
create unique index if not exists ai_trader_signals_once_t on public.ai_trader_signals (trader_id, source, chain, token, url);
alter table public.ai_trader_sources drop constraint if exists ai_trader_sources_kind_ref_key;
create unique index if not exists ai_trader_sources_once_t on public.ai_trader_sources (trader_id, kind, ref);

-- X sign-in: one row per trader (its id is the trader id).
alter table public.ai_trader_x_auth drop constraint if exists ai_trader_x_auth_id_check;
alter table public.ai_trader_x_auth drop constraint if exists ai_trader_x_auth_trader_fk;
alter table public.ai_trader_x_auth add constraint ai_trader_x_auth_trader_fk foreign key (id) references public.ai_trader_settings (id) on delete cascade;

-- Run leases per trader.
create or replace function public.ai_trader_lease_for(p_trader integer, p_seconds integer) returns boolean
language sql security definer set search_path to '' as $$
  update public.ai_trader_settings set last_run = now() where id = p_trader and last_run < now() - make_interval(secs => p_seconds) returning true;
$$;
create or replace function public.ai_trader_fast_lease_for(p_trader integer, p_seconds integer) returns boolean
language plpgsql security definer set search_path to '' as $$
declare ok boolean;
begin
  update public.ai_trader_settings set fast_until = now() + make_interval(secs => p_seconds)
   where id = p_trader and (fast_until is null or fast_until < now()) returning true into ok;
  return coalesce(ok, false);
end $$;

-- Wallet keys per trader, kept in Vault. Trader 1 keeps the original secret name.
create or replace function private.ai_trader_key_name(p_trader integer) returns text language sql immutable as $$
  select case when p_trader = 1 then 'ai_trader_key' else 'ai_trader_key_' || p_trader end;
$$;
create or replace function public.ai_trader_key_get_for(p_trader integer) returns text
language sql stable security definer set search_path to '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = private.ai_trader_key_name(p_trader) order by created_at desc limit 1;
$$;
create or replace function public.ai_trader_key_set_for(p_trader integer, p_key text, p_replace boolean default false) returns void
language plpgsql security definer set search_path to '' as $$
declare nm text := private.ai_trader_key_name(p_trader);
begin
  if p_key !~ '^0x[0-9a-fA-F]{64}$' then raise exception 'bad key'; end if;
  if not exists (select 1 from public.ai_trader_settings where id = p_trader) then raise exception 'no such trader'; end if;
  if exists (select 1 from vault.secrets where name = nm) then
    if not p_replace then raise exception 'This trader already has a wallet.'; end if;
    delete from vault.secrets where name = nm;
  end if;
  perform vault.create_secret(p_key, nm, 'AI trader wallet for trader ' || p_trader);
end $$;
revoke all on function public.ai_trader_lease_for(integer, integer) from public, anon, authenticated;
revoke all on function public.ai_trader_fast_lease_for(integer, integer) from public, anon, authenticated;
revoke all on function public.ai_trader_key_get_for(integer) from public, anon, authenticated;
revoke all on function public.ai_trader_key_set_for(integer, text, boolean) from public, anon, authenticated;
revoke all on function private.ai_trader_key_name(integer) from public, anon, authenticated;
grant execute on function public.ai_trader_lease_for(integer, integer) to service_role;
grant execute on function public.ai_trader_fast_lease_for(integer, integer) to service_role;
grant execute on function public.ai_trader_key_get_for(integer) to service_role;
grant execute on function public.ai_trader_key_set_for(integer, text, boolean) to service_role;

-- After the new code is live: the old cross-trader signal index goes, and trader_id must always be given.
-- (Run as the follow-up step: ai-trader-multi-finish.)
