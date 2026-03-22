-- Index on conversion_events(click_id) for attribution and join performance.
-- Used by: attribution debugger, click → conversion linkage, data quality / attribution reports.
-- Safe: IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_conversion_events_click_id
  ON public.conversion_events(click_id);

COMMENT ON INDEX idx_conversion_events_click_id IS 'Attribution: link conversions to redirect_click_events via bqcid.';
