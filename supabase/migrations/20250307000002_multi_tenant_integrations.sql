-- Multi-tenant: canonical integrations table
-- Phase 2: Canonical integrations

-- 1. Create integrations table (one per platform per project)
CREATE TABLE IF NOT EXISTS public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta', 'google', 'tiktok')),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (project_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_integrations_project_id ON public.integrations(project_id);

-- 2. Add integrations_id to integrations_meta (nullable for backward compat)
ALTER TABLE public.integrations_meta
  ADD COLUMN IF NOT EXISTS integrations_id uuid REFERENCES public.integrations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_integrations_meta_integrations_id ON public.integrations_meta(integrations_id);

-- 3. Backfill: create integrations row for each project with Meta token, link integrations_meta
INSERT INTO public.integrations (project_id, platform, created_at, updated_at)
SELECT DISTINCT im.project_id, 'meta', now(), now()
FROM public.integrations_meta im
WHERE im.account_id = 'primary'
  AND NOT EXISTS (
    SELECT 1 FROM public.integrations i
    WHERE i.project_id = im.project_id AND i.platform = 'meta'
  );

UPDATE public.integrations_meta im
SET integrations_id = i.id
FROM public.integrations i
WHERE i.project_id = im.project_id
  AND i.platform = 'meta'
  AND im.account_id = 'primary'
  AND im.integrations_id IS NULL;
