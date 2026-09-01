-- The key store behind the purchase order feed.
--
-- Row level security is on and there are NO policies, which means no anon or
-- signed-in caller can read this table through PostgREST at all. Only the edge
-- function reaches it, using the service key Supabase injects into it — so the
-- key exists in no config file, no environment variable and no repository.
-- Same arrangement as the scheduled sync's cron_auth.

create table if not exists public.api_keys (
  name       text primary key,          -- who holds it, e.g. 'Eagle Labs'
  secret     text not null,
  scope      text not null,             -- which endpoint it opens
  created_at timestamptz not null default now(),
  last_seen  timestamptz
);

alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;

-- Generated in the database rather than chosen, so nobody has to invent one and
-- it never passes through a chat window or an email on the way in.
insert into public.api_keys (name, secret, scope)
select 'Eagle Labs', encode(gen_random_bytes(32), 'hex'), 'po-feed'
where not exists (select 1 from public.api_keys where name = 'Eagle Labs' and scope = 'po-feed');

-- Read the key once, to hand to them over whatever channel you trust:
--
--   select secret from public.api_keys where name = 'Eagle Labs' and scope = 'po-feed';
--
-- To rotate it (their old key stops working the moment this runs):
--
--   update public.api_keys set secret = encode(gen_random_bytes(32), 'hex')
--    where name = 'Eagle Labs' and scope = 'po-feed';
--
-- To revoke it outright:
--
--   delete from public.api_keys where name = 'Eagle Labs' and scope = 'po-feed';
