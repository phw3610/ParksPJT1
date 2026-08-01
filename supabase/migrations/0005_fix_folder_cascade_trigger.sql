-- UPDATE OF path does not fire when folders_guard changes path from a name or
-- parent_id update, so let the function's path-change guard decide instead.
-- Descendant writes re-fire this trigger, but they only walk further down the
-- acyclic tree and same-value follow-up writes fail the IS DISTINCT FROM guard.
drop trigger folders_cascade_path_trg on folders;
create trigger folders_cascade_path_trg
  after update on folders
  for each row execute function public.folders_cascade_path();
