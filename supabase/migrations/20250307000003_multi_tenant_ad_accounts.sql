-- Multi-tenant: canonical ad_accounts table
-- Phase 3: Canonical ad_accounts

-- 1. Create ad_accounts table (canonical, platform-agnostic)
CREATE TABLE IF NOT EXISTS public.ad_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta', 'google', 'tiktok')),
  platform_account_id text NOT NULL,
  name text,
  currency text,
  account_status int,
  is_enabled boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (integration_id, platform_account_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_accounts_integration_id ON public.ad_accounts(integration_id);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_platform_account_id ON public.ad_accounts(platform_account_id);

-- 2. Backfill from meta_ad_accounts via integrations_meta.integrations_id
INSERT INTO public.ad_accounts (
  integration_id,
  platform,
  platform_account_id,
  name,
  currency,
  account_status,
  is_enabled,
  created_at,
  updated_at
)
SELECT
  im.integrations_id,
  'meta',
  ma.ad_account_id,
  ma.name,
  ma.currency,
  ma.account_status,
  COALESCE(ma.is_enabled, true),
  now(),
  now()
FROM public.meta_ad_accounts ma
JOIN public.integrations_meta im ON im.id = ma.integration_id AND im.project_id = ma.project_id
WHERE im.integrations_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.ad_accounts aa
    WHERE aa.integration_id = im.integrations_id AND aa.platform_account_id = ma.ad_account_id
  );
