-- Ensure ON CONFLICT targets used by sync routes have matching unique indexes.
-- These are partial by design because daily_ad_metrics stores both:
-- 1) account-level rows (campaign_id IS NULL), and
-- 2) campaign-level rows (campaign_id IS NOT NULL).

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_ad_metrics_account_date
  ON public.daily_ad_metrics (ad_account_id, date)
  WHERE campaign_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_ad_metrics_campaign_date
  ON public.daily_ad_metrics (ad_account_id, campaign_id, date)
  WHERE campaign_id IS NOT NULL;

-- Campaign upsert key used by Google/TikTok sync.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.campaigns'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(ad_accounts_id, external_campaign_id)%'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'campaigns'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
      AND indexdef ILIKE '%(ad_accounts_id, external_campaign_id)%'
  ) THEN
    -- Add named unique constraint only when neither equivalent UNIQUE constraint
    -- nor UNIQUE index exists yet.
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'campaigns_ad_accounts_external_campaign_unique'
      AND conrelid = 'public.campaigns'::regclass
    ) THEN
    ALTER TABLE public.campaigns
      ADD CONSTRAINT campaigns_ad_accounts_external_campaign_unique
      UNIQUE (ad_accounts_id, external_campaign_id);
    END IF;
  END IF;
END $$;
