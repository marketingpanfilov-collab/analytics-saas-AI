-- Classify campaigns for retention vs acquisition spend (LTV), derived from synced ad URLs (e.g. campaign_intent=retention).

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS marketing_intent text,
  ADD COLUMN IF NOT EXISTS marketing_intent_updated_at timestamptz;

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_marketing_intent_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_marketing_intent_check
  CHECK (marketing_intent IS NULL OR marketing_intent IN ('acquisition', 'retention'));

CREATE INDEX IF NOT EXISTS idx_campaigns_project_marketing_intent
  ON public.campaigns (project_id, marketing_intent)
  WHERE marketing_intent IS NOT NULL;

COMMENT ON COLUMN public.campaigns.marketing_intent IS 'acquisition | retention; set from ad/creative URLs during platform sync (e.g. campaign_intent=retention). NULL treated as acquisition in LTV.';
COMMENT ON COLUMN public.campaigns.marketing_intent_updated_at IS 'Last time marketing_intent was derived from ad sync.';
