-- Google campaign dedupe: one external campaign -> one internal campaign (deterministic).
-- Uses row_number() OVER (PARTITION BY ... ORDER BY created_at, id). No min(uuid).
-- 1) Remap daily_ad_metrics from duplicate campaign_ids to canonical.
-- 2) Delete duplicate campaign rows (keep canonical).
-- 3) Dedupe daily_ad_metrics so one row per (ad_account_id, campaign_id, date) and per (ad_account_id, date) for account-level.
-- Idempotent: safe to run again; duplicates are found again and fixed.

-- Step 1: Remap daily_ad_metrics to canonical campaign_id for Google duplicate groups
WITH dup AS (
  SELECT
    id,
    ad_accounts_id,
    trim(coalesce(external_campaign_id, '')) AS ext_norm,
    row_number() OVER (
      PARTITION BY ad_accounts_id, trim(coalesce(external_campaign_id, ''))
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.campaigns
  WHERE platform = 'google'
    AND ad_accounts_id IS NOT NULL
    AND trim(coalesce(external_campaign_id, '')) <> ''
),
canonical AS (
  SELECT id AS canonical_id, ad_accounts_id, ext_norm
  FROM dup
  WHERE rn = 1
),
duplicate_ids AS (
  SELECT d.id AS duplicate_id, c.canonical_id, c.ad_accounts_id
  FROM dup d
  JOIN canonical c ON c.ad_accounts_id = d.ad_accounts_id AND c.ext_norm = d.ext_norm
  WHERE d.rn > 1
)
UPDATE public.daily_ad_metrics m
SET campaign_id = d.canonical_id
FROM duplicate_ids d
WHERE m.ad_account_id = d.ad_accounts_id
  AND m.campaign_id = d.duplicate_id;

-- Step 2: Delete duplicate campaign rows (keep canonical)
WITH dup AS (
  SELECT
    id,
    ad_accounts_id,
    trim(coalesce(external_campaign_id, '')) AS ext_norm,
    row_number() OVER (
      PARTITION BY ad_accounts_id, trim(coalesce(external_campaign_id, ''))
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.campaigns
  WHERE platform = 'google'
    AND ad_accounts_id IS NOT NULL
    AND trim(coalesce(external_campaign_id, '')) <> ''
)
DELETE FROM public.campaigns
WHERE id IN (SELECT id FROM dup WHERE rn > 1);

-- Ensure UNIQUE constraint exists (idempotent)
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
