-- Ensure integrations has a unique constraint on (project_id, platform) for upsert ON CONFLICT.
-- Fixes: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- when using .upsert(..., { onConflict: "project_id,platform" }) in the Meta OAuth callback.
-- Idempotent: if the table was created with UNIQUE(project_id, platform), this adds a redundant
-- index (harmless); if the table existed without it, this adds the required unique index.

CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_project_id_platform
  ON public.integrations (project_id, platform);
