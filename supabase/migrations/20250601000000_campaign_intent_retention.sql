-- Campaign intent (acquisition | retention) for UTM Builder and LTV.
-- Source of truth: normalized field; retention links add campaign_intent=retention to URL and it flows through pipeline.
-- Backward compatible: all new columns nullable; existing rows remain acquisition/default.

ALTER TABLE public.redirect_links
  ADD COLUMN IF NOT EXISTS campaign_intent text;

ALTER TABLE public.redirect_click_events
  ADD COLUMN IF NOT EXISTS campaign_intent text;

ALTER TABLE public.visit_source_events
  ADD COLUMN IF NOT EXISTS campaign_intent text;

ALTER TABLE public.conversion_events
  ADD COLUMN IF NOT EXISTS campaign_intent text;

COMMENT ON COLUMN public.redirect_links.campaign_intent IS 'Set in UTM Builder: acquisition (default) or retention. Flows to click events and destination URL.';
COMMENT ON COLUMN public.redirect_click_events.campaign_intent IS 'From redirect_links or URL param; used for retention spend / LTV.';
COMMENT ON COLUMN public.visit_source_events.campaign_intent IS 'From landing URL (campaign_intent param) or pixel; used for attribution.';
COMMENT ON COLUMN public.conversion_events.campaign_intent IS 'From pixel or resolved via click_id -> redirect_click_events; used for LTV retention metrics.';

CREATE INDEX IF NOT EXISTS idx_redirect_click_events_campaign_intent
  ON public.redirect_click_events(project_id, campaign_intent) WHERE campaign_intent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversion_events_campaign_intent
  ON public.conversion_events(project_id, campaign_intent) WHERE campaign_intent IS NOT NULL;
