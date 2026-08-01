-- INSERT ... RETURNING is evaluated before the AFTER INSERT owner-membership
-- trigger, so the creator must be able to select the new space as its owner.
drop policy spaces_select on spaces;
create policy spaces_select on spaces for select
  using (
    deleted_at is null
    and (owner_id = auth.uid() or public.is_space_member(id))
  );
