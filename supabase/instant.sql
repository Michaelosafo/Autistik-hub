-- Instant launch (no liquidity, no bonding curve): the Instant Launch contract per chain, and which launches used it.
alter table public.launchpad_contracts add column if not exists instant text;
alter table public.launches add column if not exists style text not null default 'classic';
do $$ begin
  alter table public.launches add constraint launches_style_check check (style in ('classic','instant'));
exception when duplicate_object then null; end $$;
