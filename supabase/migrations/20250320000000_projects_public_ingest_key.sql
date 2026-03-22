-- Public ingest key for browser conversion events (project-level, unique).
-- Nullable until generated; one project = one active key.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS public_ingest_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_public_ingest_key
  ON public.projects(public_ingest_key)
  WHERE public_ingest_key IS NOT NULL;

COMMENT ON COLUMN public.projects.public_ingest_key IS 'Project-level public key for POST /api/tracking/conversion (X-BoardIQ-Key). Do not use admin/service tokens on frontend.';
