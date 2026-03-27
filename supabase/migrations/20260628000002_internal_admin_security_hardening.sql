-- Security hardening:
-- 1) allow users to read ONLY their own system role rows (required for role-check functions in RLS)
-- 2) enforce search_path for helper functions

CREATE OR REPLACE FUNCTION public.has_system_role(_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.system_user_roles r
    WHERE r.user_id = auth.uid()
      AND r.role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_system_role(_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.system_user_roles r
    WHERE r.user_id = auth.uid()
      AND r.role = ANY(_roles)
  );
$$;

DROP POLICY IF EXISTS p_system_user_roles_self_select ON public.system_user_roles;
CREATE POLICY p_system_user_roles_self_select
ON public.system_user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

