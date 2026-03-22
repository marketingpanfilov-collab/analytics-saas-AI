-- Add session_id, fbp, fbc to visit_source_events for pixel payload (audit fix).

ALTER TABLE public.visit_source_events
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS fbp text,
  ADD COLUMN IF NOT EXISTS fbc text;

CREATE INDEX IF NOT EXISTS idx_visit_source_events_session_id
  ON public.visit_source_events(session_id);
