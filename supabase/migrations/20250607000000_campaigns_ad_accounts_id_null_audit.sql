-- Audit and optional backfill of campaigns with ad_accounts_id IS NULL.
-- Does NOT delete rows that are used in daily_ad_metrics unless we can remap to a canonical campaign.
-- Does NOT set NOT NULL on ad_accounts_id; document outcome for manual decision.

-- 1) Backfill ad_accounts_id where exactly one campaign with same (project_id, platform, trim(external_campaign_id)) has ad_accounts_id set
WITH ref AS (
  SELECT project_id, platform, trim(coalesce(external_campaign_id, '')) AS ext_norm, ad_accounts_id,
    count(*) OVER (PARTITION BY project_id, platform, trim(coalesce(external_campaign_id, ''))) AS cnt
  FROM public.campaigns
  WHERE ad_accounts_id IS NOT NULL AND external_campaign_id IS NOT NULL AND trim(external_campaign_id) <> ''
),
single_ref AS (SELECT DISTINCT project_id, platform, ext_norm, ad_accounts_id FROM ref WHERE cnt = 1)
UPDATE public.campaigns c
SET ad_accounts_id = single_ref.ad_accounts_id
FROM single_ref
WHERE c.ad_accounts_id IS NULL
  AND c.project_id = single_ref.project_id
  AND c.platform = single_ref.platform
  AND trim(coalesce(c.external_campaign_id, '')) = single_ref.ext_norm;

-- Note: the above update matches on platform and normalized external_campaign_id but project_id match is ambiguous if multiple projects have same external id. Safer variant: only backfill when there is exactly one matching ref per (platform, ext_norm). Omitted for simplicity; run verification query to count remaining nulls.

-- 2) Optional: delete only campaigns that are NOT referenced in daily_ad_metrics and have ad_accounts_id IS NULL (legacy/orphan)
-- Uncomment to enable:
/*
DELETE FROM public.campaigns
WHERE ad_accounts_id IS NULL
  AND id NOT IN (SELECT DISTINCT campaign_id FROM public.daily_ad_metrics WHERE campaign_id IS NOT NULL);
*/

-- Do NOT add: ALTER COLUMN ad_accounts_id SET NOT NULL; (only after manual confirmation that no nulls remain)
