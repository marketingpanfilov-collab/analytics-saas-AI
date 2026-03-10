-- Add external_campaign_id for Google (and other non-Meta) campaign identity.
-- Meta uses meta_campaign_id; Google uses external_campaign_id scoped by ad_accounts_id.
-- Unique (ad_accounts_id, external_campaign_id) so one canonical campaign per external id per ad account.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS external_campaign_id text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_ad_accounts_external_campaign
  ON public.campaigns (ad_accounts_id, external_campaign_id)
  WHERE external_campaign_id IS NOT NULL;

COMMENT ON COLUMN public.campaigns.external_campaign_id IS 'Platform campaign id for non-Meta (e.g. Google Ads campaign id). Meta uses meta_campaign_id.';
