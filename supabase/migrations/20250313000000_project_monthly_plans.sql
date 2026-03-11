-- Monthly sales plan per project (sidebar "Сегодня" / planning feature).
-- One row per (project_id, month, year). Edit only for org owner/admin.

CREATE TABLE IF NOT EXISTS public.project_monthly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  month smallint NOT NULL CHECK (month >= 1 AND month <= 12),
  year smallint NOT NULL,
  sales_plan_count integer,
  sales_plan_budget numeric,
  repeat_sales_count integer,
  repeat_sales_budget numeric,
  planned_revenue numeric,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (project_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_project_monthly_plans_project_month_year
  ON public.project_monthly_plans(project_id, year, month);

COMMENT ON TABLE public.project_monthly_plans IS 'Monthly sales plan per project; used in sidebar and planning modal.';

ALTER TABLE public.project_monthly_plans ENABLE ROW LEVEL SECURITY;

-- Read: any user who can access the project (org member or project member)
CREATE POLICY project_monthly_plans_select
  ON public.project_monthly_plans FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_monthly_plans.project_id
      AND (
        EXISTS (
          SELECT 1 FROM public.organization_members om
          WHERE om.organization_id = p.organization_id AND om.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
        )
      )
    )
  );

-- Write (insert/update/delete): only org owner or admin for the project's organization
CREATE POLICY project_monthly_plans_insert
  ON public.project_monthly_plans FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.organization_members om ON om.organization_id = p.organization_id AND om.user_id = auth.uid()
      WHERE p.id = project_monthly_plans.project_id
      AND om.role IN ('owner', 'admin')
    )
  );

CREATE POLICY project_monthly_plans_update
  ON public.project_monthly_plans FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.organization_members om ON om.organization_id = p.organization_id AND om.user_id = auth.uid()
      WHERE p.id = project_monthly_plans.project_id
      AND om.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.organization_members om ON om.organization_id = p.organization_id AND om.user_id = auth.uid()
      WHERE p.id = project_monthly_plans.project_id
      AND om.role IN ('owner', 'admin')
    )
  );

CREATE POLICY project_monthly_plans_delete
  ON public.project_monthly_plans FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.organization_members om ON om.organization_id = p.organization_id AND om.user_id = auth.uid()
      WHERE p.id = project_monthly_plans.project_id
      AND om.role IN ('owner', 'admin')
    )
  );
