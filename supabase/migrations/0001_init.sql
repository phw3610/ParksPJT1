-- ParksPJT1 Phase 1 initial schema.
-- Source of truth: docs/02-erd-and-rls.md sections 2-6.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;

create type member_role as enum ('owner', 'admin', 'member', 'viewer');
create type storage_kind as enum ('google_drive', 'webdav', 's3_compatible', 'naver_mybox');
create type asset_status as enum ('pending', 'uploading', 'ready', 'failed', 'trashed', 'orphaned');
create type asset_kind as enum ('image', 'video');

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

create table spaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 50),
  owner_id   uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on spaces (owner_id);

create table space_members (
  space_id  uuid not null references spaces(id) on delete cascade,
  user_id   uuid not null references profiles(id) on delete cascade,
  role      member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index on space_members (user_id);

create unique index one_owner_per_space
  on space_members (space_id) where role = 'owner';

create table folders (
  id              uuid primary key default gen_random_uuid(),
  space_id        uuid not null references spaces(id) on delete cascade,
  parent_id       uuid references folders(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 100),
  path            text not null,
  depth           int not null default 0,
  drive_folder_id text,
  cover_asset_id  uuid,
  created_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index on folders (space_id, parent_id);
create index on folders (space_id, path text_pattern_ops);

create unique index folders_unique_name_in_parent
  on folders (space_id, parent_id, lower(name))
  where deleted_at is null and parent_id is not null;
create unique index folders_unique_name_at_root
  on folders (space_id, lower(name))
  where deleted_at is null and parent_id is null;

create or replace function folders_guard() returns trigger
language plpgsql as $$
declare
  new_path text;
  new_depth int;
begin
  if new.parent_id is not null then
    -- Checklist #12: moving a folder under itself or a descendant is rejected.
    if exists (
      with recursive sub as (
        select id from folders where id = new.id
        union all
        select f.id from folders f join sub on f.parent_id = sub.id
      )
      select 1 from sub where id = new.parent_id
    ) then
      raise exception '폴더를 자기 하위로 이동할 수 없습니다';
    end if;

    select f.path || '/' || new.name, f.depth + 1
      into new_path, new_depth
      from folders f
     where f.id = new.parent_id;
  else
    new_path := new.name;
    new_depth := 0;
  end if;

  new.path := new_path;
  new.depth := new_depth;
  return new;
end $$;

create trigger folders_guard_trg
  before insert or update of parent_id, name on folders
  for each row execute function folders_guard();

-- The design document's original recursive terms duplicated a grandchild's name
-- and skipped its parent. This approved form carries each node's completed path.
create or replace function folders_cascade_path() returns trigger
language plpgsql as $$
begin
  if new.path is distinct from old.path then
    -- Checklist #13: descendants at every depth inherit the renamed path and depth.
    with recursive sub as (
      select f.id, new.path || '/' || f.name as p, new.depth + 1 as d
        from folders f where f.parent_id = new.id
      union all
      select c.id, sub.p || '/' || c.name, sub.d + 1
        from folders c join sub on c.parent_id = sub.id
    )
    update folders f
       set path = sub.p,
           depth = sub.d
      from sub
     where f.id = sub.id;
  end if;
  return null;
end $$;

create trigger folders_cascade_path_trg
  after update of path on folders
  for each row execute function folders_cascade_path();

create table assets (
  id               uuid primary key default gen_random_uuid(),
  space_id         uuid not null references spaces(id) on delete cascade,
  folder_id        uuid references folders(id) on delete set null,
  uploader_id      uuid not null references profiles(id),
  kind             asset_kind not null,
  original_name    text not null,
  mime_type        text not null,
  byte_size        bigint not null,
  width            int,
  height           int,
  duration_ms      int,
  captured_at      timestamptz,
  storage_provider storage_kind not null,
  remote_file_id   text,
  remote_path      text not null,
  thumb_path       text,
  content_hash     text,
  status           asset_status not null default 'pending',
  error_code       text,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index on assets (space_id, folder_id, captured_at desc);
create index on assets (space_id, captured_at desc);
create index on assets (space_id, content_hash);
create index on assets (space_id, status) where status <> 'ready';

alter table folders
  add constraint folders_cover_fk
  foreign key (cover_asset_id) references assets(id) on delete set null;

create table storage_connections (
  id               uuid primary key default gen_random_uuid(),
  space_id         uuid not null references spaces(id) on delete cascade,
  provider         storage_kind not null,
  connected_by     uuid not null references profiles(id),
  account_label    text,
  root_folder_id   text,
  vault_secret_id  uuid not null,
  is_active        boolean not null default true,
  last_error       text,
  last_verified_at timestamptz,
  created_at       timestamptz not null default now()
);

create unique index one_active_connection_per_space
  on storage_connections (space_id) where is_active;

create table invites (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references spaces(id) on delete cascade,
  token_hash text not null unique,
  role       member_role not null default 'member',
  created_by uuid not null references profiles(id),
  expires_at timestamptz not null,
  max_uses   int not null default 1,
  used_count int not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on invites (space_id) where revoked_at is null;

create table devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  push_token   text not null unique,
  platform     text not null check (platform in ('ios', 'android')),
  last_seen_at timestamptz not null default now()
);
create index on devices (user_id);

create table comments (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references spaces(id) on delete cascade,
  asset_id   uuid not null references assets(id) on delete cascade,
  author_id  uuid not null references profiles(id),
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on comments (asset_id, created_at);

create table reactions (
  space_id  uuid not null references spaces(id) on delete cascade,
  asset_id  uuid not null references assets(id) on delete cascade,
  user_id   uuid not null references profiles(id) on delete cascade,
  emoji     text not null default '❤️',
  created_at timestamptz not null default now(),
  primary key (asset_id, user_id, emoji)
);

-- Internal-only state for the notify Edge Function. A scheduled flush caller is
-- intentionally outside Phase 1; webhook invocations only enqueue/update batches.
create table notification_batches (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces(id) on delete cascade,
  asset_count    int not null default 1 check (asset_count > 0),
  first_asset_at timestamptz not null default now(),
  last_asset_at  timestamptz not null default now(),
  scheduled_for  timestamptz not null default (now() + interval '10 minutes'),
  sent_at        timestamptz,
  delivery_error text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index one_open_notification_batch_per_space
  on notification_batches (space_id) where sent_at is null;
create index on notification_batches (scheduled_for) where sent_at is null;

-- RLS helpers use SECURITY DEFINER to avoid space_members policy recursion.
create or replace function public.is_space_member(p_space uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from space_members
    where space_id = p_space and user_id = auth.uid()
  );
$$;

create or replace function public.space_role(p_space uuid)
returns member_role
language sql stable security definer set search_path = public
as $$
  select role from space_members
  where space_id = p_space and user_id = auth.uid();
$$;

create or replace function public.can_manage(p_space uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.space_role(p_space) in ('owner', 'admin');
$$;

create or replace function public.can_write(p_space uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.space_role(p_space) in ('owner', 'admin', 'member');
$$;

revoke execute on function public.is_space_member(uuid) from anon;
revoke execute on function public.space_role(uuid) from anon;
revoke execute on function public.can_manage(uuid) from anon;
revoke execute on function public.can_write(uuid) from anon;

alter table profiles enable row level security;
alter table spaces enable row level security;
alter table space_members enable row level security;
alter table folders enable row level security;
alter table assets enable row level security;
alter table storage_connections enable row level security;
alter table invites enable row level security;
alter table devices enable row level security;
alter table comments enable row level security;
alter table reactions enable row level security;
alter table notification_batches enable row level security;

create policy profiles_select on profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1 from space_members m1
      join space_members m2 on m1.space_id = m2.space_id
      where m1.user_id = auth.uid() and m2.user_id = profiles.id
    )
  );
create policy profiles_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Checklist #2: knowing a UUID is insufficient; membership is required.
create policy spaces_select on spaces for select
  using (deleted_at is null and public.is_space_member(id));
create policy spaces_insert on spaces for insert
  with check (owner_id = auth.uid());
create policy spaces_update on spaces for update
  using (public.can_manage(id)) with check (public.can_manage(id));
create policy spaces_delete on spaces for delete
  using (owner_id = auth.uid());

create policy members_select on space_members for select
  using (public.is_space_member(space_id));
-- Checklist #6: admins cannot delete or modify the owner row.
-- Checklist #7: the WITH CHECK clause prevents promotion to owner.
create policy members_update on space_members for update
  using (public.can_manage(space_id) and role <> 'owner')
  with check (public.can_manage(space_id) and role <> 'owner');
create policy members_delete on space_members for delete
  using (
    user_id = auth.uid()
    or (public.can_manage(space_id) and role <> 'owner')
  );

create policy folders_select on folders for select
  using (deleted_at is null and public.is_space_member(space_id));
create policy folders_insert on folders for insert
  with check (public.can_write(space_id) and created_by = auth.uid());
create policy folders_update on folders for update
  using (public.can_write(space_id)) with check (public.can_write(space_id));
create policy folders_delete on folders for delete
  using (public.can_manage(space_id));

-- Checklist #1: non-members see no assets.
create policy assets_select on assets for select
  using (deleted_at is null and public.is_space_member(space_id));
-- Checklist #3: viewer is excluded by can_write.
create policy assets_insert on assets for insert
  with check (public.can_write(space_id) and uploader_id = auth.uid());
create policy assets_update on assets for update
  using (
    public.can_manage(space_id)
    or (public.can_write(space_id) and uploader_id = auth.uid())
  )
  with check (
    public.can_manage(space_id)
    or (public.can_write(space_id) and uploader_id = auth.uid())
  );
-- Checklist #4: members can delete only their own assets.
-- Checklist #5: admins can delete any asset in their space.
create policy assets_delete on assets for delete
  using (
    public.can_manage(space_id)
    or (public.can_write(space_id) and uploader_id = auth.uid())
  );

create policy sc_select on storage_connections for select
  using (public.is_space_member(space_id));
create policy sc_all on storage_connections for all
  using (public.space_role(space_id) = 'owner')
  with check (public.space_role(space_id) = 'owner');

create policy invites_select on invites for select
  using (public.can_manage(space_id));
create policy invites_all on invites for all
  using (public.can_manage(space_id)) with check (public.can_manage(space_id));

create policy devices_all on devices for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy comments_select on comments for select
  using (deleted_at is null and public.is_space_member(space_id));
create policy comments_insert on comments for insert
  with check (public.is_space_member(space_id) and author_id = auth.uid());
create policy comments_update on comments for update
  using (author_id = auth.uid() or public.can_manage(space_id));
create policy comments_delete on comments for delete
  using (author_id = auth.uid() or public.can_manage(space_id));

create policy reactions_select on reactions for select
  using (public.is_space_member(space_id));
create policy reactions_all on reactions for all
  using (user_id = auth.uid() and public.is_space_member(space_id))
  with check (user_id = auth.uid() and public.is_space_member(space_id));

-- No notification_batches policy is intentional: anon/authenticated must see 0 rows.
revoke all on notification_batches from anon, authenticated;

-- Checklist #8: vault_secret_id is never selectable by authenticated clients.
revoke select on storage_connections from authenticated;
grant select (
  id, space_id, provider, connected_by, account_label,
  root_folder_id, is_active, last_error, last_verified_at, created_at
) on storage_connections to authenticated;

-- Checklist #9: token_hash is never selectable by authenticated clients.
revoke select on invites from authenticated;
grant select (
  id, space_id, role, created_by, expires_at,
  max_uses, used_count, revoked_at, created_at
) on invites to authenticated;

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_invite invites%rowtype;
begin
  select * into v_invite from invites
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and revoked_at is null
     and expires_at > now()
     and (max_uses = 0 or used_count < max_uses)
   for update;

  -- Checklist #10: expired invitations fail uniformly.
  -- Checklist #11: exhausted one-use invitations fail uniformly.
  if not found then
    raise exception 'INVITE_INVALID' using errcode = 'P0001';
  end if;

  insert into space_members (space_id, user_id, role)
  values (v_invite.space_id, auth.uid(), v_invite.role)
  on conflict (space_id, user_id) do nothing;

  update invites set used_count = used_count + 1 where id = v_invite.id;
  return v_invite.space_id;
end $$;

revoke execute on function public.accept_invite(text) from anon;

create or replace function public.preview_invite(p_token text)
returns table (space_name text, inviter_name text, member_count int, asset_count int)
language sql security definer set search_path = public
as $$
  select s.name,
         p.display_name,
         (select count(*)::int from space_members where space_id = s.id),
         (select count(*)::int from assets where space_id = s.id and deleted_at is null)
    from invites i
    join spaces s on s.id = i.space_id
    join profiles p on p.id = i.created_by
   where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and i.revoked_at is null
     and i.expires_at > now()
     and (i.max_uses = 0 or i.used_count < i.max_uses);
$$;

-- Vault access is exposed only through service_role-only RPCs so the private
-- vault schema never needs to be added to PostgREST's exposed schemas.
create or replace function public.create_vault_secret(p_secret text)
returns uuid
language sql security definer set search_path = public, vault
as $$
  select vault.create_secret(p_secret);
$$;

create or replace function public.read_vault_secret(p_secret_id uuid)
returns text
language sql security definer set search_path = public, vault
as $$
  select decrypted_secret
    from vault.decrypted_secrets
   where id = p_secret_id;
$$;

create or replace function public.delete_vault_secret(p_secret_id uuid)
returns void
language sql security definer set search_path = public, vault
as $$
  delete from vault.secrets where id = p_secret_id;
$$;

revoke all on function public.create_vault_secret(text) from public, anon, authenticated;
revoke all on function public.read_vault_secret(uuid) from public, anon, authenticated;
revoke all on function public.delete_vault_secret(uuid) from public, anon, authenticated;
grant execute on function public.create_vault_secret(text) to service_role;
grant execute on function public.read_vault_secret(uuid) to service_role;
grant execute on function public.delete_vault_secret(uuid) to service_role;

create or replace function public.enqueue_notification_batch(p_space_id uuid)
returns notification_batches
language plpgsql security definer set search_path = public
as $$
declare
  v_batch notification_batches;
begin
  insert into notification_batches (space_id)
  values (p_space_id)
  on conflict (space_id) where sent_at is null
  do update set
    asset_count = notification_batches.asset_count + 1,
    last_asset_at = now(),
    updated_at = now()
  returning * into v_batch;

  return v_batch;
end $$;

create or replace function public.claim_due_notification_batches(p_limit int default 20)
returns setof notification_batches
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with due as (
    select id
      from notification_batches
     where sent_at is null and scheduled_for <= now()
     order by scheduled_for
     for update skip locked
     limit greatest(1, least(p_limit, 100))
  )
  update notification_batches b
     set sent_at = now(), updated_at = now()
    from due
   where b.id = due.id
  returning b.*;
end $$;

revoke all on function public.enqueue_notification_batch(uuid) from public, anon, authenticated;
revoke all on function public.claim_due_notification_batches(int) from public, anon, authenticated;
grant execute on function public.enqueue_notification_batch(uuid) to service_role;
grant execute on function public.claim_due_notification_batches(int) to service_role;

-- Checklist #14: Realtime observes RLS; removal from space_members revokes delivery.
alter publication supabase_realtime add table assets;
alter publication supabase_realtime add table folders;
alter publication supabase_realtime add table space_members;

insert into storage.buckets (id, name, public)
values
  ('thumbs', 'thumbs', false),
  ('avatars', 'avatars', false)
on conflict (id) do update set public = excluded.public;

-- Checklist #15: non-members cannot read thumbs objects.
create policy thumbs_read on storage.objects for select
  using (
    bucket_id = 'thumbs'
    and public.is_space_member(((storage.foldername(name))[1])::uuid)
  );

create policy thumbs_write on storage.objects for insert
  with check (
    bucket_id = 'thumbs'
    and public.can_write(((storage.foldername(name))[1])::uuid)
  );

create policy thumbs_delete on storage.objects for delete
  using (
    bucket_id = 'thumbs'
    and public.can_write(((storage.foldername(name))[1])::uuid)
  );
