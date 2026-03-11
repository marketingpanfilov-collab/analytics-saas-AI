-- Fix infinite recursion in organization_members RLS.
-- Replace any policy that subqueries organization_members with minimal non-recursive policies.
-- Client: read/insert only own row (user_id = auth.uid()). Org admin writes go through API (service role).

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies to remove any recursive one
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'organization_members'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.organization_members', r.policyname);
  END LOOP;
END $$;

-- SELECT: authenticated users can read only their own membership row(s)
CREATE POLICY organization_members_select_own
  ON public.organization_members
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- INSERT: users can insert only a row for themselves (e.g. bootstrap first-user flow)
CREATE POLICY organization_members_insert_own
  ON public.organization_members
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- No UPDATE/DELETE policy for authenticated: org member management is done via API (service role).
