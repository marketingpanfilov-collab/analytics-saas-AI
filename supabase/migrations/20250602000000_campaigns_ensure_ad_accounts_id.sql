-- Ensure campaigns.ad_accounts_id exists (required for Google sync).
-- Idempotent: safe to run if 20250307000004 was skipped or schema cache is out of date.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS ad_accounts_id uuid REFERENCES public.ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_ad_accounts_id ON public.campaigns(ad_accounts_id);

COMMENT ON COLUMN public.campaigns.ad_accounts_id IS 'Canonical link to ad_accounts.id. Required for Google campaign upsert (ad_accounts_id, external_campaign_id).';

-- Non-partial UNIQUE constraint so Supabase upsert ON CONFLICT (ad_accounts_id, external_campaign_id) works.
-- (Partial unique index from 20250307500000 is not matched by PostgREST ON CONFLICT.)
-- In PostgreSQL, UNIQUE treats NULLs as distinct, so multiple (ad_accounts_id, NULL) for Meta campaigns remain allowed.
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
