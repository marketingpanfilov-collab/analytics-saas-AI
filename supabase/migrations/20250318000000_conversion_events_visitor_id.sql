-- Conversion events: ensure visitor_id exists for attribution link with visit_source_events.
-- Table may already exist; we only add visitor_id and index if missing.

-- Ensure table exists with required columns (for fresh installs; no-op if already present)
CREATE TABLE IF NOT EXISTS public.conversion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  source text,
  event_name text NOT NULL,
  event_time timestamptz NOT NULL DEFAULT now(),
  external_event_id text,
  user_external_id text,
  visitor_id text,
  click_id text,
  fbp text,
  fbc text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  value numeric(14, 4),
  currency text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add visitor_id if table existed without it
ALTER TABLE public.conversion_events
  ADD COLUMN IF NOT EXISTS visitor_id text;

CREATE INDEX IF NOT EXISTS idx_conversion_events_visitor_id
  ON public.conversion_events(visitor_id);

CREATE INDEX IF NOT EXISTS idx_conversion_events_project_id
  ON public.conversion_events(project_id);

CREATE INDEX IF NOT EXISTS idx_conversion_events_event_time
  ON public.conversion_events(event_time);

COMMENT ON TABLE public.conversion_events IS 'First-party conversion events (registration, purchase). Link to visit_source_events via visitor_id for CAC/ROAS attribution.';
