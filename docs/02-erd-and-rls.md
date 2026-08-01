# 02 — ERD & RLS 설계 (Supabase / Postgres)

전제: [01 PRD](./01-prd-and-flows.md), [Phase 0 선체크](./phase0-storage-feasibility.md).

---

## 0. 선행 결정 — 썸네일 저장 위치

지시서에 명시되지 않은 구멍이라 여기서 결정한다.

**문제:** 그리드 화면은 한 번에 수십 장의 썸네일을 그린다. 이걸 매번 Drive에서 받아오면
① 요청마다 백엔드 프록시를 거쳐 느리고 ② Drive API 레이트리밋을 잡아먹고 ③ 오프라인에서 아무것도 안 보인다.

**결정: 썸네일(최대 512px, JPEG 품질 70, 약 30~60KB)만 Supabase Storage에 저장한다. 원본은 절대 저장하지 않는다.**

| 항목 | 원본 | 썸네일 |
|---|---|---|
| 저장 위치 | 사용자 Drive/NAS **전용** | Supabase Storage (`thumbs` 버킷, private) |
| 크기 | 3~10MB | 30~60KB (약 1/100) |
| 생성 | — | 업로드 시 기기에서 생성 후 함께 전송 |
| 삭제 | Drive 휴지통 | asset 삭제 시 즉시 삭제 |

**근거:** 사진 1만 장 = 원본 약 50GB vs 썸네일 약 500MB. 썸네일은 "메타데이터 규모"에 속한다. 이게 없으면 제품이 사용 불가능할 만큼 느려진다.

**단, 개인정보처리방침에 이 사실을 정직하게 명시한다:**
> "원본 사진은 회원님이 연결한 클라우드에만 저장됩니다. 빠른 목록 표시를 위해 축소된 미리보기 이미지(최대 512px)는 저희 서버에 암호화되어 보관되며, 사진을 삭제하면 함께 삭제됩니다."

UI 카피(`docs/01`)의 "저희 서버에는 저장되지 않습니다"는 **"원본 사진은 저희 서버에 저장되지 않습니다"**로 수정한다.

---

## 1. ERD

```
                          auth.users (Supabase)
                                │
                                │ 1:N
                                ↓
  spaces ──1:N──→ space_members ←──N:1── profiles
    │  │                                    │
    │  └──1:1──→ storage_connections         │ 1:N
    │  │                                    ↓
    │  └──1:N──→ invites                 devices
    │
    ├──1:N──→ folders ──self FK(parent_id)──┐
    │             │ ↑─────────────────────── ┘
    │             │ 1:N
    │             ↓
    └──1:N──→ assets ──1:N──→ comments
                  │
                  └──1:N──→ reactions
```

핵심 규칙: **모든 테이블이 `space_id`를 직접 보유한다.** 정규화상 `assets`는 `folder_id`만 있어도 되지만, RLS 정책이 매번 폴더 트리를 거슬러 올라가면 쿼리가 느려진다. `space_id` 비정규화는 의도적이다.

---

## 2. DDL

### 2.1 열거형

```sql
create type member_role   as enum ('owner', 'admin', 'member', 'viewer');
create type storage_kind  as enum ('google_drive', 'webdav', 's3_compatible', 'naver_mybox');
create type asset_status  as enum ('pending', 'uploading', 'ready', 'failed', 'trashed', 'orphaned');
create type asset_kind    as enum ('image', 'video');
```

`naver_mybox`는 값만 미리 넣어둔다(마이그레이션 회피). Provider 구현은 없다.

### 2.2 profiles

```sql
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url  text,
  created_at  timestamptz not null default now()
);
```

### 2.3 spaces

```sql
create table spaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 50),
  owner_id    uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index on spaces (owner_id);
```

### 2.4 space_members

```sql
create table space_members (
  space_id   uuid not null references spaces(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       member_role not null default 'member',
  joined_at  timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index on space_members (user_id);

-- Owner는 스페이스당 정확히 1명
create unique index one_owner_per_space
  on space_members (space_id) where role = 'owner';
```

### 2.5 folders — 중첩 폴더

```sql
create table folders (
  id               uuid primary key default gen_random_uuid(),
  space_id         uuid not null references spaces(id) on delete cascade,
  parent_id        uuid references folders(id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 100),
  path             text not null,              -- 표시·검색용 캐시: '2026/여름휴가/제주'
  depth            int  not null default 0,
  drive_folder_id  text,                       -- provider의 폴더 식별자
  cover_asset_id   uuid,                        -- 커버 썸네일 (FK는 아래에서 추가)
  created_by       uuid not null references profiles(id),
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index on folders (space_id, parent_id);
create index on folders (space_id, path text_pattern_ops);   -- 경로 prefix 검색

-- 같은 부모 아래 같은 이름 금지 (루트는 parent_id가 null이라 별도 인덱스)
create unique index folders_unique_name_in_parent
  on folders (space_id, parent_id, lower(name)) where deleted_at is null and parent_id is not null;
create unique index folders_unique_name_at_root
  on folders (space_id, lower(name)) where deleted_at is null and parent_id is null;
```

**`path`를 캐시하는 이유:** 브레드크럼과 검색을 매번 recursive CTE로 계산하면 화면 진입마다 트리를 다 탄다. 대신 폴더를 **이동/이름변경할 때 하위 트리의 `path`를 일괄 갱신**한다(아래 트리거).

**순환 참조 방지 트리거:**

```sql
create or replace function folders_guard() returns trigger
language plpgsql as $$
declare
  new_path text;
  new_depth int;
begin
  if new.parent_id is not null then
    -- 자기 자신 또는 자기 하위를 부모로 지정하는 것을 차단
    if exists (
      with recursive sub as (
        select id from folders where id = new.id
        union all
        select f.id from folders f join sub on f.parent_id = sub.id
      ) select 1 from sub where id = new.parent_id
    ) then
      raise exception '폴더를 자기 하위로 이동할 수 없습니다';
    end if;

    select f.path || '/' || new.name, f.depth + 1 into new_path, new_depth
      from folders f where f.id = new.parent_id;
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

-- 부모의 path가 바뀌면 하위 전체 갱신
create or replace function folders_cascade_path() returns trigger
language plpgsql as $$
begin
  if new.path is distinct from old.path then
    -- CTE가 노드별 **완성된** path를 들고 내려간다. UPDATE에서 다시 이름을 붙이면
    -- 손자가 `부모path/손자명/손자명`이 되고 depth도 한 단계 모자란다 (체크 #13 실패).
    with recursive sub as (
      select f.id, new.path || '/' || f.name as p, new.depth + 1 as d
        from folders f where f.parent_id = new.id
      union all
      select c.id, sub.p || '/' || c.name, sub.d + 1
        from folders c join sub on c.parent_id = sub.id
    )
    update folders f set path = sub.p, depth = sub.d
      from sub where f.id = sub.id;
  end if;
  return null;
end $$;

create trigger folders_cascade_path_trg
  after update of path on folders
  for each row execute function folders_cascade_path();
```

### 2.6 assets

```sql
create table assets (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references spaces(id) on delete cascade,
  folder_id     uuid references folders(id) on delete set null,
  uploader_id   uuid not null references profiles(id),

  kind          asset_kind not null,
  original_name text not null,
  mime_type     text not null,
  byte_size     bigint not null,
  width         int,
  height        int,
  duration_ms   int,
  captured_at   timestamptz,                 -- EXIF 촬영일 (없으면 업로드 시각)

  -- 원본 위치 (사용자 스토리지)
  storage_provider storage_kind not null,
  remote_file_id   text,                     -- Drive fileId / S3 key / WebDAV path
  remote_path      text not null,            -- 사람이 읽는 경로 (표시·디버깅용)

  -- 서버 보관 (썸네일만)
  thumb_path    text,                        -- Supabase Storage 'thumbs' 버킷 경로
  content_hash  text,                        -- sha256, 중복 감지 (Phase 2)

  status        asset_status not null default 'pending',
  error_code    text,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index on assets (space_id, folder_id, captured_at desc);
create index on assets (space_id, captured_at desc);          -- 타임라인
create index on assets (space_id, content_hash);              -- 중복 감지
create index on assets (space_id, status) where status <> 'ready';

alter table folders
  add constraint folders_cover_fk
  foreign key (cover_asset_id) references assets(id) on delete set null;
```

`folder_id`가 `on delete set null`인 이유: 폴더를 지워도 사진 레코드가 사라지면 Drive의 원본과 DB가 어긋난다. 폴더 삭제 시 하위 사진은 "미분류"로 남기고, 사용자가 명시적으로 "하위 사진도 함께 삭제"를 고르면 별도로 처리한다.

### 2.7 storage_connections

```sql
create table storage_connections (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references spaces(id) on delete cascade,
  provider      storage_kind not null,
  connected_by  uuid not null references profiles(id),

  account_label text,          -- 'park○○@gmail.com' — UI 표시용, 비민감
  root_folder_id text,         -- /FamilyShare/{spaceId} 의 provider 식별자

  -- 시크릿은 여기에 두지 않는다. Supabase Vault 참조만 보관.
  vault_secret_id uuid not null,

  is_active     boolean not null default true,
  last_error    text,          -- 'token_expired' | 'quota_exceeded' | 'revoked'
  last_verified_at timestamptz,
  created_at    timestamptz not null default now()
);

-- 스페이스당 활성 연결 1개
create unique index one_active_connection_per_space
  on storage_connections (space_id) where is_active;
```

**`vault_secret_id`만 두는 이유:** refresh token / NAS 비밀번호가 이 테이블에 평문으로 들어가면, RLS를 한 줄 잘못 써도 전 가족의 Drive가 열린다. 실제 값은 Supabase Vault에 두고 **Edge Function(service_role)만** 복호화한다. 이 테이블에는 어떤 RLS 정책으로도 시크릿이 노출될 수 없다.

### 2.8 invites

```sql
create table invites (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces(id) on delete cascade,
  token_hash   text not null unique,        -- 원문 토큰은 저장하지 않는다 (sha256만)
  role         member_role not null default 'member',
  created_by   uuid not null references profiles(id),
  expires_at   timestamptz not null,
  max_uses     int not null default 1,       -- 0 = 무제한
  used_count   int not null default 0,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index on invites (space_id) where revoked_at is null;
```

**토큰 원문을 저장하지 않는 이유:** DB가 유출돼도 초대 링크가 살아 있으면 안 된다. 링크의 토큰은 발급 시 한 번만 클라이언트에 반환하고, 서버는 해시만 비교한다.

### 2.9 devices (푸시)

```sql
create table devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  push_token   text not null unique,
  platform     text not null check (platform in ('ios','android')),
  last_seen_at timestamptz not null default now()
);
create index on devices (user_id);
```

### 2.10 comments / reactions (Phase 2, 스키마는 지금 확정)

```sql
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
  space_id   uuid not null references spaces(id) on delete cascade,
  asset_id   uuid not null references assets(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  emoji      text not null default '❤️',
  created_at timestamptz not null default now(),
  primary key (asset_id, user_id, emoji)
);
```

### 2.11 notification_batches — 푸시 debounce 상태 (내부 전용)

`docs/03` §2.7의 "10분 창 debounce"는 Edge Function만으로는 구현할 수 없다.
Edge Function은 호출 간 상태가 없으므로 배치 상태를 DB에 둔다.

```sql
create table notification_batches (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces(id) on delete cascade,
  asset_count    int not null default 1 check (asset_count > 0),
  first_asset_at timestamptz not null default now(),
  ...
);
-- 스페이스당 열린 배치는 1건. 동시 웹훅의 중복 생성을 이 제약으로 막는다.
create unique index one_open_notification_batch_per_space
  on notification_batches (space_id) where sent_at is null;
```

**클라이언트는 이 테이블을 절대 읽지 않는다.** RLS는 켜되 정책을 하나도 만들지 않고
(`= anon/authenticated에게 0행`), 추가로 `revoke all on notification_batches from anon, authenticated`를 건다.
적재·소진은 `enqueue_notification_batch` / `claim_due_notification_batches`
SECURITY DEFINER 함수로만 하고 실행 권한은 `service_role`에만 준다.

10분 창이 지난 배치를 실제로 **발송**하는 주체(pg_cron / Scheduled Function)는 Phase 1 범위 밖이다.
`notify` 함수의 `mode=flush`를 호출할 외부 스케줄러 설정이 남아 있다.

---

## 3. RLS 정책

### 3.1 헬퍼 함수 — 무한 재귀 회피

Supabase RLS의 대표적 함정: `space_members`에 "멤버만 조회 가능" 정책을 걸면, 그 정책이 다시 `space_members`를 조회해 **무한 재귀**가 난다. `security definer` 함수로 RLS를 우회해 끊는다.

```sql
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
  select public.space_role(p_space) in ('owner','admin');
$$;

create or replace function public.can_write(p_space uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.space_role(p_space) in ('owner','admin','member');
$$;

revoke execute on function public.is_space_member(uuid) from anon;
revoke execute on function public.space_role(uuid)      from anon;
revoke execute on function public.can_manage(uuid)      from anon;
revoke execute on function public.can_write(uuid)       from anon;
```

### 3.2 정책

```sql
alter table profiles             enable row level security;
alter table spaces               enable row level security;
alter table space_members        enable row level security;
alter table folders              enable row level security;
alter table assets               enable row level security;
alter table storage_connections  enable row level security;
alter table invites              enable row level security;
alter table devices              enable row level security;
alter table comments             enable row level security;
alter table reactions            enable row level security;

-- profiles: 본인 + 같은 스페이스 멤버의 프로필만
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

-- spaces
create policy spaces_select on spaces for select
  using (deleted_at is null and public.is_space_member(id));
create policy spaces_insert on spaces for insert
  with check (owner_id = auth.uid());
create policy spaces_update on spaces for update
  using (public.can_manage(id)) with check (public.can_manage(id));
create policy spaces_delete on spaces for delete
  using (owner_id = auth.uid());

-- space_members
create policy members_select on space_members for select
  using (public.is_space_member(space_id));
create policy members_update on space_members for update
  using (
    public.can_manage(space_id)
    and role <> 'owner'                       -- Owner 행은 건드릴 수 없음
  )
  with check (
    public.can_manage(space_id)
    and role <> 'owner'                       -- Owner로 승격 불가 (이양은 RPC로만)
  );
create policy members_delete on space_members for delete
  using (
    user_id = auth.uid()                      -- 스스로 나가기
    or (public.can_manage(space_id) and role <> 'owner')
  );
-- INSERT 정책 없음: 멤버 추가는 accept_invite RPC(security definer)로만 가능

-- folders
create policy folders_select on folders for select
  using (deleted_at is null and public.is_space_member(space_id));
create policy folders_insert on folders for insert
  with check (public.can_write(space_id) and created_by = auth.uid());
create policy folders_update on folders for update
  using (public.can_write(space_id)) with check (public.can_write(space_id));
create policy folders_delete on folders for delete
  using (public.can_manage(space_id));

-- assets
create policy assets_select on assets for select
  using (deleted_at is null and public.is_space_member(space_id));
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
create policy assets_delete on assets for delete
  using (
    public.can_manage(space_id)
    or (public.can_write(space_id) and uploader_id = auth.uid())
  );

-- storage_connections: 조회는 멤버 전체(연결 상태 표시용), 변경은 Owner만
-- vault_secret_id 컬럼은 아래 뷰로 가린다
create policy sc_select on storage_connections for select
  using (public.is_space_member(space_id));
create policy sc_all on storage_connections for all
  using (public.space_role(space_id) = 'owner')
  with check (public.space_role(space_id) = 'owner');

-- invites: 관리자만. token_hash는 아래 뷰로 가린다
create policy invites_select on invites for select
  using (public.can_manage(space_id));
create policy invites_all on invites for all
  using (public.can_manage(space_id)) with check (public.can_manage(space_id));

-- devices: 본인 것만
create policy devices_all on devices for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- comments
create policy comments_select on comments for select
  using (deleted_at is null and public.is_space_member(space_id));
create policy comments_insert on comments for insert
  with check (public.is_space_member(space_id) and author_id = auth.uid());
create policy comments_update on comments for update
  using (author_id = auth.uid() or public.can_manage(space_id));
create policy comments_delete on comments for delete
  using (author_id = auth.uid() or public.can_manage(space_id));

-- reactions
create policy reactions_select on reactions for select
  using (public.is_space_member(space_id));
create policy reactions_all on reactions for all
  using (user_id = auth.uid() and public.is_space_member(space_id))
  with check (user_id = auth.uid() and public.is_space_member(space_id));
```

### 3.3 민감 컬럼 차단

RLS는 행 단위라 컬럼을 가리지 못한다. `vault_secret_id`와 `token_hash`는 **컬럼 권한**으로 막는다.

```sql
revoke select on storage_connections from authenticated;
grant select (id, space_id, provider, connected_by, account_label,
              root_folder_id, is_active, last_error, last_verified_at, created_at)
  on storage_connections to authenticated;

revoke select on invites from authenticated;
grant select (id, space_id, role, created_by, expires_at,
              max_uses, used_count, revoked_at, created_at)
  on invites to authenticated;
```

이렇게 하면 클라이언트가 `select *`를 해도 시크릿 참조와 토큰 해시를 받을 수 없다. Edge Function은 `service_role`이라 영향받지 않는다.

---

## 4. 초대 수락 RPC

멤버 추가는 RLS로 표현할 수 없다(아직 멤버가 아닌 사람이 자기 행을 삽입해야 하므로). `security definer` RPC로만 허용한다.

```sql
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_invite invites%rowtype;
begin
  select * into v_invite from invites
   where token_hash = encode(digest(p_token, 'sha256'), 'hex')
     and revoked_at is null
     and expires_at > now()
     and (max_uses = 0 or used_count < max_uses)
   for update;

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
```

**초대 미리보기(수락 전)** — 스페이스 이름·초대자·멤버 수·사진 수만 반환하고 썸네일·폴더명은 **응답에 담지 않는다**.

```sql
create or replace function public.preview_invite(p_token text)
returns table (space_name text, inviter_name text, member_count int, asset_count int)
language sql security definer set search_path = public
as $$
  select s.name,
         p.display_name,
         (select count(*)::int from space_members where space_id = s.id),
         (select count(*)::int from assets where space_id = s.id and deleted_at is null)
    from invites i
    join spaces   s on s.id = i.space_id
    join profiles p on p.id = i.created_by
   where i.token_hash = encode(digest(p_token, 'sha256'), 'hex')
     and i.revoked_at is null
     and i.expires_at > now()
     and (i.max_uses = 0 or i.used_count < i.max_uses);
$$;
```

`pgcrypto` 확장이 필요하다: `create extension if not exists pgcrypto;`

---

## 5. Realtime

```sql
alter publication supabase_realtime add table assets;
alter publication supabase_realtime add table folders;
alter publication supabase_realtime add table space_members;
```

**Realtime은 RLS를 존중한다** — 멤버가 아닌 사용자에게는 이벤트가 전달되지 않는다. 클라이언트는 `space_id=eq.{id}` 필터로 구독한다.

```ts
supabase.channel(`space:${spaceId}`)
  .on('postgres_changes',
      { event: '*', schema: 'public', table: 'assets', filter: `space_id=eq.${spaceId}` },
      handleAssetChange)
  .subscribe()
```

**강퇴 시 즉시 차단:** `space_members` DELETE 이벤트를 받은 클라이언트는 즉시 스페이스를 이탈시킨다. 동시에 서버 측 RLS가 이미 막고 있으므로 클라이언트 처리가 늦어도 데이터는 새지 않는다.

---

## 6. Supabase Storage 버킷

| 버킷 | 공개 여부 | 내용 | 정책 |
|---|---|---|---|
| `thumbs` | private | `{spaceId}/{assetId}.jpg` — 최대 512px | 스페이스 멤버만 읽기, 업로더만 쓰기 |
| `avatars` | private | `{userId}.jpg` | 본인 쓰기, 같은 스페이스 멤버 읽기 |

```sql
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
```

---

## 7. 검증 체크리스트 (마이그레이션 후 반드시 실행)

| # | 테스트 | 기대 |
|---|---|---|
| 1 | 비멤버가 `select * from assets` | 0행 |
| 2 | 비멤버가 스페이스 UUID를 알고 조회 | 0행 |
| 3 | Viewer가 asset insert | 정책 위반 오류 |
| 4 | Member가 남의 asset 삭제 | 정책 위반 오류 |
| 5 | Admin이 남의 asset 삭제 | 성공 |
| 6 | Admin이 Owner를 강퇴 | 정책 위반 오류 |
| 7 | Admin이 자신을 owner로 update | 정책 위반 오류 |
| 8 | 멤버가 `select vault_secret_id from storage_connections` | 컬럼 권한 오류 |
| 9 | 멤버가 `select token_hash from invites` | 컬럼 권한 오류 |
| 10 | 만료된 토큰으로 `accept_invite` | `INVITE_INVALID` |
| 11 | 1회용 토큰 2회 사용 | 두 번째 `INVITE_INVALID` |
| 12 | 폴더를 자기 하위로 이동 | "폴더를 자기 하위로 이동할 수 없습니다" |
| 13 | 부모 폴더 이름 변경 후 손자 폴더 `path` 확인 | 하위 전체 갱신됨 |
| 14 | 강퇴 직후 Realtime 이벤트 수신 | 더 이상 수신 안 됨 |
| 15 | 비멤버가 `thumbs` 버킷 객체 요청 | 403 |

이 15개는 Phase 1 완료 게이트다. 하나라도 실패하면 배포하지 않는다.
