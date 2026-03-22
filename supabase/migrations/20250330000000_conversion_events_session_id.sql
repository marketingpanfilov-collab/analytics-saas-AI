-- Conversion events: add session_id for session-level linkage (click → visit → registration → purchase).
-- Required for production-grade attribution.

ALTER TABLE public.conversion_events
  ADD COLUMN IF NOT EXISTS session_id text;

CREATE INDEX IF NOT EXISTS idx_conversion_events_session_id
  ON public.conversion_events(session_id);

CREATE INDEX IF NOT EXISTS idx_conversion_events_user_external_id
  ON public.conversion_events(user_external_id);

COMMENT ON COLUMN public.conversion_events.session_id IS 'Session ID from tracker (sessionStorage); links conversion to the same session as visit for attribution.';
