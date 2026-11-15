-- AUTISTIK stickers as verified badges 11-20 and as reactions (applied 2026-11-15)
alter table public.profiles drop constraint if exists profiles_verified_badge_check;
alter table public.profiles add constraint profiles_verified_badge_check check (verified_badge >= 1 and verified_badge <= 20);
-- set_verified_badge now accepts 1..20 (see function in the database)
alter table public.tik_likes drop constraint if exists tik_likes_kind_check;
alter table public.tik_likes add constraint tik_likes_kind_check check (kind in ('love','haha','fire','100','wow','sad','pray','clap','buffering','goblin','lowbatt','stimmy','noodle','potato','bigfeels','zoomies','dnd','mainchar'));
