-- TIK mood stickers (applied 2026-11-15)
alter table public.tiks drop constraint if exists tiks_mood_check;
alter table public.tiks add constraint tiks_mood_check check (mood is null or mood = any (array['happy','calm','excited','proud','grateful','tired','anxious','sad','overwhelmed','focused','buffering','goblin','lowbatt','stimmy','noodle','potato','bigfeels','zoomies','dnd','mainchar']));
