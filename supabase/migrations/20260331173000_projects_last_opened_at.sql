ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS last_opened_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_projects_last_opened_at
  ON public.projects(last_opened_at);
