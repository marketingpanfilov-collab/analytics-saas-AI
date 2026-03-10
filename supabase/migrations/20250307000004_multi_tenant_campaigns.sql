-- Multi-tenant: link campaigns to ad_accounts (canonical hierarchy)
-- Phase 4: campaigns belong to ad_accounts

-- 1. Add ad_accounts_id to campaigns (nullable for backward compat)
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS ad_accounts_id uuid REFERENCES public.ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_ad_accounts_id ON public.campaigns(ad_accounts_id);

-- 2. Backfill: set campaigns.ad_accounts_id from ad_accounts via meta_ad_accounts
UPDATE public.campaigns c
SET ad_accounts_id = aa.id
FROM public.meta_ad_accounts ma
JOIN public.integrations_meta im ON im.id = ma.integration_id AND im.project_id = ma.project_id
JOIN public.ad_accounts aa ON aa.integration_id = im.integrations_id AND aa.platform_account_id = ma.ad_account_id
WHERE c.project_id = ma.project_id
  AND c.ad_account_id = ma.ad_account_id
  AND c.ad_accounts_id IS NULL
  AND im.integrations_id IS NOT NULL;
