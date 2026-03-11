-- Project invites: email and shareable link (30 min expiry)
-- project_members is created only after invite acceptance.

CREATE TABLE IF NOT EXISTS public.project_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email text,
  role text NOT NULL CHECK (role IN ('project_admin', 'marketer', 'viewer')),
  invite_type text NOT NULL CHECK (invite_type IN ('email', 'link')),
  token text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_invites_token ON public.project_invites(token);
CREATE INDEX IF NOT EXISTS idx_project_invites_project_id ON public.project_invites(project_id);
CREATE INDEX IF NOT EXISTS idx_project_invites_status_expires ON public.project_invites(status, expires_at);

COMMENT ON TABLE public.project_invites IS 'Invites to projects; project_members created only on acceptance. Links expire after 30 minutes.';
