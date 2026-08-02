-- Phase 2: 즐겨찾기와 읽음/미확인 표시.
--
-- 즐겨찾기는 개인 북마크다. reactions(❤️)가 이미 "다 같이 보는 반응"을 맡고 있으므로
-- 여기서는 남의 즐겨찾기를 볼 이유가 없다. 그래서 select도 본인 것만 열어 준다.

create table if not exists favorites (
  space_id   uuid not null references spaces(id) on delete cascade,
  asset_id   uuid not null references assets(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (asset_id, user_id)
);

create index if not exists favorites_space_user_created_idx
  on favorites (space_id, user_id, created_at desc);

-- 읽음 표시는 에셋마다 행을 만들지 않는다. 스페이스별 "마지막으로 본 시각" 하나면
-- 미확인 = 그 시각 이후에 올라온 것으로 계산할 수 있고, 행이 멤버당 1개로 끝난다.
-- 사진이 몇 만 장이 되어도 이 테이블은 멤버 수만큼만 커진다.
create table if not exists space_read_state (
  space_id     uuid not null references spaces(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

alter table favorites        enable row level security;
alter table space_read_state enable row level security;

-- for all은 select/insert/update/delete 전부에 적용된다.
-- 본인 행이면서 그 스페이스의 멤버일 때만 허용한다 — 나간 뒤에는 즉시 막힌다.
create policy favorites_all on favorites for all
  using (user_id = auth.uid() and public.is_space_member(space_id))
  with check (user_id = auth.uid() and public.is_space_member(space_id));

create policy space_read_state_all on space_read_state for all
  using (user_id = auth.uid() and public.is_space_member(space_id))
  with check (user_id = auth.uid() and public.is_space_member(space_id));

-- 기본 권한(alter default privileges)에 기대지 않고 명시한다.
-- 이 마이그레이션은 대시보드에서 손으로 적용하므로 왕복을 만들지 않는 편이 낫다.
grant select, insert, update, delete on favorites        to authenticated;
grant select, insert, update, delete on space_read_state to authenticated;
revoke all on favorites        from anon;
revoke all on space_read_state from anon;
