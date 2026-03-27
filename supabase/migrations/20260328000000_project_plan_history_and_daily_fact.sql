-- Audit history for monthly plan saves + daily plan/fact snapshots.

CREATE TABLE IF NOT EXISTS public.project_plan_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.project_monthly_plans(id) ON DELETE SET NULL,
  month smallint NOT NULL CHECK (month >= 1 AND month <= 12),
  year smallint NOT NULL,
  sales_plan_count integer,
  sales_plan_budget numeric(20, 6),
  repeat_sales_count integer,
  repeat_sales_budget numeric(20, 6),
  planned_revenue numeric(20, 6),
  primary_avg_check numeric(20, 6),
  repeat_avg_check numeric(20, 6),
  plan_roas numeric(20, 6),
  plan_cac numeric(20, 6),
  plan_cpr numeric(20, 6),
  source text NOT NULL DEFAULT 'manual_save',
  saved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_plan_history_project_saved_at
  ON public.project_plan_history(project_id, saved_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_plan_history_project_month_year
  ON public.project_plan_history(project_id, year, month);

ALTER TABLE public.project_plan_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_plan_history_select
  ON public.project_plan_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_plan_history.project_id
        AND (
          EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = p.organization_id
              AND om.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = p.id
              AND pm.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY project_plan_history_insert
  ON public.project_plan_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      LEFT JOIN public.organization_members om
        ON om.organization_id = p.organization_id
       AND om.user_id = auth.uid()
      LEFT JOIN public.project_members pm
        ON pm.project_id = p.id
       AND pm.user_id = auth.uid()
      WHERE p.id = project_plan_history.project_id
        AND (
          om.role IN ('owner', 'admin')
          OR pm.role = 'project_admin'
        )
    )
  );

CREATE TABLE IF NOT EXISTS public.project_plan_fact_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  month smallint NOT NULL CHECK (month >= 1 AND month <= 12),
  year smallint NOT NULL,
  sales_plan_count integer,
  sales_plan_budget numeric(20, 6),
  repeat_sales_count integer,
  repeat_sales_budget numeric(20, 6),
  planned_revenue numeric(20, 6),
  primary_avg_check numeric(20, 6),
  repeat_avg_check numeric(20, 6),
  fact_sales numeric(20, 6),
  fact_spend numeric(20, 6),
  fact_revenue numeric(20, 6),
  fact_roas numeric(20, 6),
  fact_cac numeric(20, 6),
  fact_cpr numeric(20, 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_project_plan_fact_daily_project_date
  ON public.project_plan_fact_daily(project_id, snapshot_date DESC);

ALTER TABLE public.project_plan_fact_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_plan_fact_daily_select
  ON public.project_plan_fact_daily FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_plan_fact_daily.project_id
        AND (
          EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = p.organization_id
              AND om.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = p.id
              AND pm.user_id = auth.uid()
          )
        )
    )
  );
