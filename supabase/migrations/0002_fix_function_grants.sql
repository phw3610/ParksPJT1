-- Remove the implicit PUBLIC execution path while preserving RLS policy calls
-- made by authenticated users.
revoke all on function public.is_space_member(uuid) from public, anon;
revoke all on function public.space_role(uuid) from public, anon;
revoke all on function public.can_manage(uuid) from public, anon;
revoke all on function public.can_write(uuid) from public, anon;

grant execute on function public.is_space_member(uuid) to authenticated;
grant execute on function public.space_role(uuid) to authenticated;
grant execute on function public.can_manage(uuid) to authenticated;
grant execute on function public.can_write(uuid) to authenticated;

-- Authenticate before reading the token hash so anonymous callers cannot use
-- success/failure differences as an invitation-token oracle.
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_invite invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_invite from invites
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
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
