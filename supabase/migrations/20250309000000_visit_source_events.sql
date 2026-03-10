-- First-party source tracking: visit/source attribution events
-- MVP: capture landing, referrer, UTM, click IDs; classify source

CREATE TABLE IF NOT EXISTS public.visit_source_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text NOT NULL,
  site_id text NOT NULL,
  landing_url text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  gclid text,
  fbclid text,
  yclid text,
  ttclid text,
  source_classification text NOT NULL CHECK (source_classification IN ('paid', 'organic_search', 'organic_social', 'referral', 'direct', 'unknown')),
  touch_type text NOT NULL DEFAULT 'last' CHECK (touch_type IN ('first', 'last')),
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visit_source_events_visitor_id ON public.visit_source_events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_visit_source_events_site_id ON public.visit_source_events(site_id);
CREATE INDEX IF NOT EXISTS idx_visit_source_events_created_at ON public.visit_source_events(created_at);
CREATE INDEX IF NOT EXISTS idx_visit_source_events_visitor_site ON public.visit_source_events(visitor_id, site_id);

COMMENT ON TABLE public.visit_source_events IS 'First-party source tracking: each row = one visit with attribution data. First-touch = earliest event per visitor+site; last-touch = latest.';
