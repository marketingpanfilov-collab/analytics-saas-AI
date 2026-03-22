-- Auto-detected traffic source and platform for attribution (from click IDs / UTM / referrer).
-- Raw params (fbclid, gclid, utm_source, etc.) stay unchanged; these columns hold normalized detection.

ALTER TABLE public.redirect_click_events
  ADD COLUMN IF NOT EXISTS traffic_source text,
  ADD COLUMN IF NOT EXISTS traffic_platform text;

ALTER TABLE public.visit_source_events
  ADD COLUMN IF NOT EXISTS traffic_source text,
  ADD COLUMN IF NOT EXISTS traffic_platform text;

ALTER TABLE public.conversion_events
  ADD COLUMN IF NOT EXISTS traffic_source text,
  ADD COLUMN IF NOT EXISTS traffic_platform text;

CREATE INDEX IF NOT EXISTS idx_redirect_click_events_traffic_source ON public.redirect_click_events(traffic_source);
CREATE INDEX IF NOT EXISTS idx_visit_source_events_traffic_source ON public.visit_source_events(traffic_source);
CREATE INDEX IF NOT EXISTS idx_conversion_events_traffic_source ON public.conversion_events(traffic_source);

COMMENT ON COLUMN public.redirect_click_events.traffic_source IS 'Auto-detected source (meta, google, tiktok, yandex, or from utm_source).';
COMMENT ON COLUMN public.redirect_click_events.traffic_platform IS 'Auto-detected platform (facebook_ads, google_ads, tiktok_ads, yandex_ads).';
COMMENT ON COLUMN public.visit_source_events.traffic_source IS 'Auto-detected source from click IDs / UTM / referrer.';
COMMENT ON COLUMN public.visit_source_events.traffic_platform IS 'Auto-detected platform.';
COMMENT ON COLUMN public.conversion_events.traffic_source IS 'Auto-detected source for attribution.';
COMMENT ON COLUMN public.conversion_events.traffic_platform IS 'Auto-detected platform for attribution.';
