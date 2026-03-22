-- Add archived flag to projects (hidden from default list; can be restored later)
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_projects_archived ON public.projects(archived) WHERE archived = false;

-- Short-lived reauth tokens for sensitive actions (e.g. transfer ownership)
CREATE TABLE IF NOT EXISTS public.reauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reauth_tokens_user_expires ON public.reauth_tokens(user_id, expires_at);

-- Only backend (service role) should read/write reauth_tokens; no policies for authenticated
ALTER TABLE public.reauth_tokens ENABLE ROW LEVEL SECURITY;
