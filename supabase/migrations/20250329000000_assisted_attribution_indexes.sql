-- Assisted Attribution: index visits by visitor and time (path before conversion)
CREATE INDEX IF NOT EXISTS idx_visit_source_events_visitor_id_created_at
  ON public.visit_source_events(visitor_id, created_at);

-- Conversion events: index by visitor and time for assisted attribution queries
CREATE INDEX IF NOT EXISTS idx_conversion_events_visitor_id_created_at
  ON public.conversion_events(visitor_id, created_at);

COMMENT ON INDEX idx_visit_source_events_visitor_id_created_at IS 'Assisted Attribution: all visits per visitor ordered by time.';
COMMENT ON INDEX idx_conversion_events_visitor_id_created_at IS 'Assisted Attribution: conversions per visitor by time.';
