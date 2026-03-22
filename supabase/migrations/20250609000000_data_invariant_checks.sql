CREATE TABLE IF NOT EXISTS public.data_invariant_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  check_code text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_invariant_checks_project_checked_at
  ON public.data_invariant_checks(project_id, checked_at DESC);
