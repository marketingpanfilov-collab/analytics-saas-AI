-- Shared auth storage for all platforms (Meta, Google, TikTok, etc.).
-- One row per integration; token and optional refresh/expiry live here.
-- integrations_meta remains for backward compatibility; integrations_auth is the primary auth layer.

CREATE TABLE IF NOT EXISTS public.integrations_auth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id)
);

CREATE INDEX IF NOT EXISTS idx_integrations_auth_integration_id ON public.integrations_auth(integration_id);

-- Backfill: copy token from integrations_meta into integrations_auth for existing Meta connections.
INSERT INTO public.integrations_auth (
  integration_id,
  access_token,
  token_expires_at,
  meta,
  updated_at
)
SELECT
  im.integrations_id,
  im.access_token,
  im.expires_at,
  jsonb_build_object('source', 'integrations_meta_backfill', 'token_source', im.token_source),
  now()
FROM public.integrations_meta im
WHERE im.integrations_id IS NOT NULL
  AND im.access_token IS NOT NULL
ON CONFLICT (integration_id) DO NOTHING;
