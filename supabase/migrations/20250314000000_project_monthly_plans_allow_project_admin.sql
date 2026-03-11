-- Allow project_admin (via project_members) to insert/update/delete project_monthly_plans.
-- API already allows owner/admin/project_admin; RLS previously only allowed org owner/admin.

DROP POLICY IF EXISTS project_monthly_plans_insert ON public.project_monthly_plans;
CREATE POLICY project_monthly_plans_insert
  ON public.project_monthly_plans FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      LEFT JOIN public.organization_members om ON om.organization_id = p.organization_id AND om.user_id = auth.uid()
      LEFT JOIN public.project_members pm ON pm.project_id = p.id AND pm.user_id = auth.uid()
      WHERE p.id = project_monthly_plans.project_id
      AND (
        (om.role IN ('owner', 'admin'))
        OR (pm.role = 'project_admin')
      )
    )
  );

DROP POLICY IF EXISTS project_monthly_plans_update ON public.project_monthly_plans;
CREATE POLICY project_monthly_plans_update
  ON public.project_monthly_plans FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      LEFT JOIN public.organization_members om ON om.organization_id = p.organization_id AND om.user_id = auth.uid()
      LEFT JOIN public.project_members pm ON pm.project_id = p.id AND pm.user_id = auth.uid()
      WHERE p.id = project_monthly_plans.project_id
      AND (
        (om.role IN ('owner', 'admin'))
        OR (pm.role = 'project_admin')
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      LEFT JOIN public.organization_members om ON om.organization_id = p.organization_id AND om.user_id = auth.uid()
      LEFT JOIN public.project_members pm ON pm.project_id = p.id AND pm.user_id = auth.uid()
      WHERE p.id = project_monthly_plans.project_id
      AND (
        (om.role IN ('owner', 'admin'))
        OR (pm.role = 'project_admin')
      )
    )
  );

DROP POLICY IF EXISTS project_monthly_plans_delete ON public.project_monthly_plans;
CREATE POLICY project_monthly_plans_delete
  ON public.project_monthly_plans FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      LEFT JOIN public.organization_members om ON om.organization_id = p.organization_id AND om.user_id = auth.uid()
      LEFT JOIN public.project_members pm ON pm.project_id = p.id AND pm.user_id = auth.uid()
      WHERE p.id = project_monthly_plans.project_id
      AND (
        (om.role IN ('owner', 'admin'))
        OR (pm.role = 'project_admin')
      )
    )
  );
