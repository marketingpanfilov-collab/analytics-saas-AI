-- Email-first organization ownership transfer (pending → completed).

CREATE TABLE IF NOT EXISTS public.organization_transfer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  to_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_transfer_one_pending_per_org
  ON public.organization_transfer_requests (organization_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_organization_transfer_requests_token
  ON public.organization_transfer_requests (token);

CREATE INDEX IF NOT EXISTS idx_organization_transfer_requests_organization_id
  ON public.organization_transfer_requests (organization_id);

ALTER TABLE public.organization_transfer_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.organization_transfer_requests IS 'Owner-initiated org transfer; recipient accepts via token link.';
