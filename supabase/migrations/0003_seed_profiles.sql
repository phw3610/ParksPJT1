-- Profiles are created by the auth lifecycle rather than direct client INSERTs.
-- This keeps profile creation available even while profiles has no INSERT policy.
create or replace function public.profiles_seed_from_auth_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
      '사용자'
    ),
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), '')
  )
  on conflict (id) do nothing;

  return new;
end $$;

create trigger profiles_seed_from_auth_user_trg
  after insert on auth.users
  for each row execute function public.profiles_seed_from_auth_user();

-- Backfill users that existed before the auth.users trigger was installed.
insert into public.profiles (id, display_name, avatar_url)
select
  u.id,
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(split_part(coalesce(u.email, ''), '@', 1)), ''),
    '사용자'
  ),
  nullif(btrim(u.raw_user_meta_data ->> 'avatar_url'), '')
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
)
on conflict (id) do nothing;
