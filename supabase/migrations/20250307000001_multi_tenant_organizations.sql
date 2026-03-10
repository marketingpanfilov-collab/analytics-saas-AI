-- Multi-tenant: organizations and organization_members
-- Phase 1: Organizations and project binding

-- 1. Create organizations table
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- 2. Create organization_members table
CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_user_id ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_organization_id ON public.organization_members(organization_id);

-- 3. Add organization_id to projects (nullable for backward compat)
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_organization_id ON public.projects(organization_id);

-- 4. Create default organization and backfill existing projects
INSERT INTO public.organizations (id, name, slug, created_at, updated_at)
SELECT
  gen_random_uuid(),
  'Default Organization',
  'default',
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.organizations WHERE slug = 'default')
LIMIT 1;

-- Assign all projects without organization to the default org
UPDATE public.projects p
SET organization_id = (SELECT id FROM public.organizations WHERE slug = 'default' LIMIT 1)
WHERE p.organization_id IS NULL;
