-- Fix duplicate Google campaign-level metrics: one external campaign was mapped to two internal campaign IDs.
-- Cause: duplicate rows in campaigns for same (ad_accounts_id, external_campaign_id) before UNIQUE constraint,
-- or differing external_campaign_id (e.g. trim) leading to two rows for same external campaign.
--
-- 1) For each (ad_accounts_id, normalized external_campaign_id) with multiple campaign rows: pick canonical = min(id).
-- 2) Remap daily_ad_metrics: set campaign_id = canonical where campaign_id IN (duplicate ids).
-- 3) Dedupe daily_ad_metrics: keep one row per (ad_account_id, campaign_id, date), delete duplicate rows.
-- 4) Delete duplicate campaign rows from campaigns (keep canonical).
-- 5) Ensure UNIQUE constraint exists so future upserts cannot create duplicates.

DO $$
DECLARE
  v_dup RECORD;
  v_canonical_id uuid;
  v_ad_accounts_id uuid;
  v_ext_norm text;
BEGIN
  FOR v_dup IN
    SELECT
      c.ad_accounts_id AS ad_accounts_id,
      trim(coalesce(c.external_campaign_id, '')) AS ext_norm,
      array_agg(c.id ORDER BY c.id) AS campaign_ids
    FROM public.campaigns c
    WHERE c.platform = 'google'
      AND c.ad_accounts_id IS NOT NULL
      AND c.external_campaign_id IS NOT NULL
      AND trim(c.external_campaign_id) <> ''
    GROUP BY c.ad_accounts_id, trim(coalesce(c.external_campaign_id, ''))
    HAVING count(*) > 1
  LOOP
    v_ad_accounts_id := v_dup.ad_accounts_id;
    v_ext_norm := v_dup.ext_norm;
    v_canonical_id := v_dup.campaign_ids[1];

    -- Remap daily_ad_metrics: all duplicate campaign_ids -> canonical (for this ad_account)
    UPDATE public.daily_ad_metrics
    SET campaign_id = v_canonical_id
    WHERE ad_account_id = v_ad_accounts_id
      AND campaign_id = ANY(v_dup.campaign_ids)
      AND campaign_id <> v_canonical_id;

    -- Delete duplicate campaign rows (keep canonical)
    DELETE FROM public.campaigns
    WHERE ad_accounts_id = v_ad_accounts_id
      AND platform = 'google'
      AND trim(coalesce(external_campaign_id, '')) = v_ext_norm
      AND id <> v_canonical_id;
  END LOOP;
END $$;

-- Dedupe daily_ad_metrics: keep one row per (ad_account_id, campaign_id, date); delete duplicate rows (e.g. after remap)
DELETE FROM public.daily_ad_metrics d
WHERE d.campaign_id IS NOT NULL
  AND d.id NOT IN (
    SELECT min(id)
    FROM public.daily_ad_metrics
    WHERE campaign_id IS NOT NULL
    GROUP BY ad_account_id, campaign_id, date
  );

-- Ensure UNIQUE constraint exists so future upserts cannot create duplicates (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.campaigns'::regclass
      AND conname = 'campaigns_ad_accounts_external_campaign_key'
      AND contype = 'u'
  ) THEN
    ALTER TABLE public.campaigns
      ADD CONSTRAINT campaigns_ad_accounts_external_campaign_key
      UNIQUE (ad_accounts_id, external_campaign_id);
  END IF;
END $$;
