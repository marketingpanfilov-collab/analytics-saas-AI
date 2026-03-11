-- Align project_members.role with app and project_invites: allow project_admin, marketer, viewer.
-- Fixes: "new row for relation project_members violates check constraint project_members_role_check"
-- (table may have been created elsewhere with a different role set, e.g. admin/member/viewer).

ALTER TABLE public.project_members
  DROP CONSTRAINT IF EXISTS project_members_role_check;

ALTER TABLE public.project_members
  ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('project_admin', 'marketer', 'viewer'));
