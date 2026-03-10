-- Multi-tenant: canonical daily_ad_metrics table
-- Phase 5: daily metrics per ad_account (and optionally per campaign)
-- Hierarchy: ad_accounts -> campaigns -> daily_ad_metrics

-- 1. Create daily_ad_metrics table (canonical, platform-agnostic)
CREATE TABLE IF NOT EXISTS public.daily_ad_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
  date date NOT NULL,
  platform text NOT NULL CHECK (platform IN ('meta', 'google', 'tiktok')),
  spend numeric(14, 4) DEFAULT 0 NOT NULL,
  impressions bigint DEFAULT 0 NOT NULL,
  clicks bigint DEFAULT 0 NOT NULL,
  reach bigint DEFAULT 0,
  cpm numeric(10, 4) DEFAULT 0,
  cpc numeric(10, 4) DEFAULT 0,
  ctr numeric(10, 4) DEFAULT 0,
  leads bigint DEFAULT 0,
  purchases bigint DEFAULT 0,
  revenue numeric(14, 4) DEFAULT 0,
  roas numeric(10, 4) DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Account-level: one row per (ad_account_id, date) when campaign_id IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_ad_metrics_account_date
  ON public.daily_ad_metrics (ad_account_id, date) WHERE campaign_id IS NULL;

-- Campaign-level: one row per (ad_account_id, campaign_id, date)
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_ad_metrics_campaign_date
  ON public.daily_ad_metrics (ad_account_id, campaign_id, date) WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_ad_metrics_ad_account_id ON public.daily_ad_metrics(ad_account_id);
CREATE INDEX IF NOT EXISTS idx_daily_ad_metrics_campaign_id ON public.daily_ad_metrics(campaign_id);
CREATE INDEX IF NOT EXISTS idx_daily_ad_metrics_date ON public.daily_ad_metrics(date);

-- 2. Backfill from meta_insights (account-level: campaign_id = null)
INSERT INTO public.daily_ad_metrics (
  ad_account_id,
  campaign_id,
  date,
  platform,
  spend,
  impressions,
  clicks,
  reach,
  cpm,
  cpc,
  ctr,
  leads,
  purchases,
  revenue,
  roas,
  created_at
)
SELECT
  aa.id,
  NULL,
  mi.date_start::date,
  'meta',
  COALESCE(mi.spend, 0),
  COALESCE(mi.impressions, 0),
  COALESCE(mi.clicks, 0),
  COALESCE(mi.reach, 0),
  COALESCE(mi.cpm, 0),
  COALESCE(mi.cpc, 0),
  COALESCE(mi.ctr, 0),
  COALESCE(mi.leads, 0),
  COALESCE(mi.purchases, 0),
  COALESCE(mi.revenue, 0),
  COALESCE(mi.roas, 0),
  now()
FROM public.meta_insights mi
JOIN public.meta_ad_accounts ma ON ma.project_id = mi.project_id AND ma.ad_account_id = mi.ad_account_id
JOIN public.integrations_meta im ON im.id = ma.integration_id AND im.project_id = ma.project_id
JOIN public.ad_accounts aa ON aa.integration_id = im.integrations_id AND aa.platform_account_id = ma.ad_account_id
WHERE mi.level = 'account'
  AND mi.date_start IS NOT NULL
  AND im.integrations_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.daily_ad_metrics dam
    WHERE dam.ad_account_id = aa.id AND dam.campaign_id IS NULL AND dam.date = mi.date_start::date
  );

-- 3. Backfill from meta_insights (campaign-level: campaign_id set)
INSERT INTO public.daily_ad_metrics (
  ad_account_id,
  campaign_id,
  date,
  platform,
  spend,
  impressions,
  clicks,
  reach,
  cpm,
  cpc,
  ctr,
  leads,
  purchases,
  revenue,
  roas,
  created_at
)
SELECT
  aa.id,
  c.id,
  mi.date_start::date,
  'meta',
  COALESCE(mi.spend, 0),
  COALESCE(mi.impressions, 0),
  COALESCE(mi.clicks, 0),
  COALESCE(mi.reach, 0),
  COALESCE(mi.cpm, 0),
  COALESCE(mi.cpc, 0),
  COALESCE(mi.ctr, 0),
  COALESCE(mi.leads, 0),
  COALESCE(mi.purchases, 0),
  COALESCE(mi.revenue, 0),
  COALESCE(mi.roas, 0),
  now()
FROM public.meta_insights mi
JOIN public.campaigns c ON c.project_id = mi.project_id
  AND c.ad_account_id = mi.ad_account_id
  AND c.meta_campaign_id = mi.entity_id
JOIN public.meta_ad_accounts ma ON ma.project_id = mi.project_id AND ma.ad_account_id = mi.ad_account_id
JOIN public.integrations_meta im ON im.id = ma.integration_id AND im.project_id = ma.project_id
JOIN public.ad_accounts aa ON aa.integration_id = im.integrations_id AND aa.platform_account_id = ma.ad_account_id
WHERE mi.level = 'campaign'
  AND mi.entity_id IS NOT NULL
  AND mi.date_start IS NOT NULL
  AND im.integrations_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.daily_ad_metrics dam
    WHERE dam.ad_account_id = aa.id AND dam.campaign_id = c.id AND dam.date = mi.date_start::date
  );
