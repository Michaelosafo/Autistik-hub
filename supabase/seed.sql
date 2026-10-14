-- Optional: three example sessions so the Sessions page isn't empty on day one.
-- Edit titles, hosts and dates, then run in Supabase → SQL Editor. Delete them anytime from the site.
insert into public.sessions (title, host, kind, starts_at, description) values
  ('Autistic burnout: spotting it early', 'Verified practitioner (to be confirmed)', 'Talk show', now() + interval '7 days',
   'What burnout feels like, early warning signs, and ways to recover. Live Q&A at the end.'),
  ('Sunday support circle', 'Community moderator (to be confirmed)', 'Support circle', now() + interval '12 days',
   'A small, text-friendly circle. Cameras off is fine. Share or just listen.'),
  ('Asking for adjustments at work or school', 'Verified practitioner (to be confirmed)', 'Q&A', now() + interval '20 days',
   'How to ask for sensory, schedule and communication adjustments, with example wording.');
